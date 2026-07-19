import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { MoveLeft, MoveRight } from "lucide-react";
import { fetchMyPredictions, fetchQuestions, submitPredictionBatch } from "../lib/api";
import { useAuth } from "../auth/auth-context";
import { usePrefersReducedMotion } from "../hooks/use-reduced-motion";
import { Button } from "@/components/ui/button";
import type { BatchAnswer, Question } from "../lib/types";
import { QuestionCard } from "./question-card";
import { SavePrompt } from "./save-prompt";
import { TxStatus } from "./tx-status";
import { capitalizeOutcome } from "../lib/outcome-labels";
import stadiumBg from "../assets/stadium-bg.jpg";

type Props = {
  onNavigateAuth(pending: BatchAnswer): void;
  initialAnswer?: BatchAnswer | null;
  onInitialAnswerConsumed?(): void;
};

type SubmitState = "idle" | "submitting" | "done" | "failed";

// Server error strings (src/api/routes/predictions.ts) mapped to friendlier
// client copy. Matched by stable substring — the API client throws Error with
// the server's error string verbatim.
const LOCKED_MATCH = "locked";
const WALLET_MATCH = "wallet is required";
const RATE_LIMIT_MATCH = "too many";

function isQuestionOpen(q: Question): boolean {
  return q.status === "open" && Date.parse(q.locksAt) > Date.now();
}

function prunedNotice(dropped: number, surviving: number): string {
  if (surviving === 0) {
    return "All picks locked before they were saved — new cards open closer to kickoff.";
  }
  const droppedPart =
    dropped === 1
      ? "1 pick locked before it was saved and was removed."
      : `${dropped} picks locked before they were saved and were removed.`;
  const survivingPart =
    surviving === 1
      ? "1 pick is still open — lock it in now."
      : `${surviving} picks are still open — lock them in now.`;
  return `${droppedPart} ${survivingPart}`;
}

// A committed answer's exit: which card left and which way it flew. Drives
// the removed card's exit variant (via AnimatePresence custom) and the
// stage-fixed commit streak. Direction mirrors outcomeFromDrag: outcomes[0]
// commits right, outcomes[1] commits left — for swipes and rail buttons alike.
type ExitCommit = { questionId: string; direction: 1 | -1 };

/* Night-stadium photo behind the deck only (brand toolkit phone mock). A
   fixed layer under the shell content; the CSS scrim keeps header, nav, and
   deck text on near-solid --bg. Fades in on load so there is no pop. */
function StadiumBackdrop() {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (imgRef.current?.complete) setLoaded(true);
  }, []);

  return (
    <div
      className={loaded ? "stadium-backdrop stadium-backdrop-loaded" : "stadium-backdrop"}
      aria-hidden="true"
    >
      <img ref={imgRef} src={stadiumBg} alt="" onLoad={() => setLoaded(true)} />
    </div>
  );
}

export function CardDeck(props: Props) {
  return (
    <>
      <StadiumBackdrop />
      <Deck {...props} />
    </>
  );
}

function Deck({ onNavigateAuth, initialAnswer, onInitialAnswerConsumed }: Props) {
  const { isAuthenticated } = useAuth();
  const reducedMotion = usePrefersReducedMotion();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [lastCommit, setLastCommit] = useState<ExitCommit | null>(null);
  // Answers accumulate locally per swipe — nothing hits the network until the
  // whole deck is submitted as one batch. A refresh before submit discards
  // them (accepted tradeoff); a submitted batch is durable.
  const [answers, setAnswers] = useState<BatchAnswer[]>([]);
  const [pendingOutcome, setPendingOutcome] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Notice about picks pruned because their question locked before the batch
  // was saved (client pre-filter or server 409 recovery). Shown on the submit
  // screen with the button re-armed for the surviving answers.
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  // Notice about unanswered cards silently dropped mid-session because their
  // locksAt passed while the deck was open.
  const [deckNotice, setDeckNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consumedInitial = useRef(false);
  // Synchronous re-entrancy guard: submitState is set via async setState, so a
  // double-fire (double click, retry race) could slip through before React
  // re-renders. The ref flips synchronously and cannot.
  const submitInFlight = useRef(false);
  // Fresh values for the 30s lock-sweep interval, whose closure would
  // otherwise capture the mount-time state.
  const questionsRef = useRef<Question[] | null>(null);
  questionsRef.current = questions;
  const indexRef = useRef(0);
  indexRef.current = index;

  // Deck = open questions the user hasn't already answered. Predictions are
  // durable server-side, so on reload we subtract the ones this user already
  // locked in — otherwise answered cards reappear. Guests (unauthenticated)
  // have no predictions yet, so they see every open card.
  useEffect(() => {
    const minePromise: ReturnType<typeof fetchMyPredictions> = isAuthenticated
      ? fetchMyPredictions()
      : Promise.resolve([]);
    Promise.all([fetchQuestions(), minePromise])
      .then(([data, mine]) => {
        const answeredIds = new Set(mine.map((p) => p.questionId));
        setQuestions(data.filter((q) => q.status === "open" && !answeredIds.has(q.id)));
      })
      .catch(() => setError("Could not load questions right now."));
  }, [isAuthenticated]);

  // A guest's pending pick, lifted to the shell across the auth screen, replays
  // once into the remounted deck. It joins the same local accumulation as a
  // normal swipe (no network call) and is consumed upstream so a later remount
  // never re-records it.
  useEffect(() => {
    if (consumedInitial.current) return;
    if (!questions || !initialAnswer || !isAuthenticated) return;
    consumedInitial.current = true;
    onInitialAnswerConsumed?.();
    const pending = questions.find((q) => q.id === initialAnswer.questionId);
    if (!pending) return;
    setLastCommit({
      questionId: pending.id,
      direction: initialAnswer.outcome === pending.outcomes[0] ? 1 : -1,
    });
    setAnswers((prev) => [...prev, { questionId: pending.id, outcome: initialAnswer.outcome }]);
    setIndex((i) => i + 1);
  }, [questions, initialAnswer, isAuthenticated, onInitialAnswerConsumed]);

  // Lock sweep: every 30s, drop remaining (unanswered) cards whose locksAt has
  // passed so the user can't swipe into a server-side 409. Only positions at or
  // after the current index are removed — already-given answers stay and go
  // through the submit-time filter instead — so the index never needs to move:
  // no card is skipped or repeated.
  useEffect(() => {
    const sweep = () => {
      const qs = questionsRef.current;
      if (!qs) return;
      const idx = indexRef.current;
      const next = qs.filter((q, pos) => pos < idx || Date.parse(q.locksAt) > Date.now());
      const removed = qs.length - next.length;
      if (removed === 0) return;
      setQuestions(next);
      setDeckNotice(
        removed === 1
          ? "1 card locked at kickoff and was removed."
          : `${removed} cards locked at kickoff and were removed.`,
      );
    };
    const id = setInterval(sweep, 30_000);
    return () => clearInterval(id);
  }, []);

  // Answers are local-only until the batch submit; a refresh discards them.
  // While unsaved picks exist, arm the native "leave site?" confirm.
  const hasUnsavedPicks = answers.length > 0 && submitState !== "done";
  useEffect(() => {
    if (!hasUnsavedPicks) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedPicks]);

  const current = questions?.[index] ?? null;

  function record(question: Question, outcome: string) {
    setDeckNotice(null);
    setLastCommit({
      questionId: question.id,
      direction: outcome === question.outcomes[0] ? 1 : -1,
    });
    setAnswers((prev) => [...prev, { questionId: question.id, outcome }]);
    setIndex((i) => i + 1);
  }

  function handleAnswer(outcome: string): boolean {
    if (!current) return false;
    if (!isAuthenticated) {
      // Sign-in gate stays at the first answer — guests browse and drag
      // freely, but must sign in before any pick is kept. The deck doesn't
      // advance, so the card must not play its exit animation either.
      setPendingOutcome(outcome);
      return false;
    }
    record(current, outcome);
    return true;
  }

  function handleSignIn() {
    if (!current || !pendingOutcome) return;
    onNavigateAuth({ questionId: current.id, outcome: pendingOutcome });
  }

  // Drops locked answers, tells the user what happened, and re-arms the
  // submit button for the survivors. Shared by the submit-time pre-filter and
  // the 409 recovery path.
  function pruneLockedAnswers(surviving: BatchAnswer[], dropped: number) {
    setAnswers(surviving);
    setSubmitNotice(prunedNotice(dropped, surviving.length));
    setSubmitError(null);
    setSubmitState("idle");
  }

  // The server rejects the whole batch with 409 when ANY answer's question is
  // past locks_at — resubmitting the identical array is doomed forever.
  // Recover by refetching questions, dropping answers no longer open, and
  // re-arming submit with the survivors.
  async function recoverFromLockedBatch(serverMessage: string) {
    let stillOpen: (answer: BatchAnswer) => boolean;
    try {
      const fresh = await fetchQuestions();
      const openIds = new Set(fresh.filter(isQuestionOpen).map((q) => q.id));
      stillOpen = (answer) => openIds.has(answer.questionId);
    } catch {
      // Refetch failed: fall back to the locksAt we already have locally.
      const byId = new Map((questionsRef.current ?? []).map((q) => [q.id, q]));
      stillOpen = (answer) => {
        const q = byId.get(answer.questionId);
        return q !== undefined && Date.parse(q.locksAt) > Date.now();
      };
    }
    const surviving = answers.filter(stillOpen);
    if (surviving.length === answers.length) {
      // The server says locked but nothing looks locked client-side (clock
      // skew): keep the plain failure so Retry stays available.
      setSubmitError(serverMessage);
      setSubmitState("failed");
      return;
    }
    pruneLockedAnswers(surviving, answers.length - surviving.length);
  }

  async function submit() {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitNotice(null);
    setSubmitState("submitting");
    try {
      // Pre-filter answers already past locksAt so an obviously doomed batch
      // never leaves the client.
      const byId = new Map((questionsRef.current ?? []).map((q) => [q.id, q]));
      const surviving = answers.filter((answer) => {
        const q = byId.get(answer.questionId);
        return q !== undefined && Date.parse(q.locksAt) > Date.now();
      });
      if (surviving.length < answers.length) {
        pruneLockedAnswers(surviving, answers.length - surviving.length);
        return;
      }
      await submitPredictionBatch(answers);
      setSubmitState("done");
      setSubmitError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submit failed.";
      if (message.includes(LOCKED_MATCH)) {
        await recoverFromLockedBatch(message);
      } else if (message.includes(WALLET_MATCH)) {
        setSubmitError(
          "Your wallet is still being set up — this usually takes a few seconds. Retry in a moment.",
        );
        setSubmitState("failed");
      } else if (message.includes(RATE_LIMIT_MATCH)) {
        setSubmitError("Too many attempts — wait a minute and retry.");
        setSubmitState("failed");
      } else {
        setSubmitError(message);
        setSubmitState("failed");
      }
    } finally {
      submitInFlight.current = false;
    }
  }

  if (error) return <p className="empty-state">{error}</p>;
  if (!questions) return <p className="empty-state">Loading questions…</p>;
  const total = questions.length;

  // Deck exhausted: submit screen (or its success / retry states).
  if (!current) {
    if (total === 0) {
      return (
        <p className="empty-state">
          No open questions right now. Check back closer to kickoff.
        </p>
      );
    }

    if (submitState === "done") {
      return (
        <div className="screen deck-screen">
          <div className="deck-locked clip-cut">
            <TxStatus state="saved" />
            <p className="deck-progress">
              {answers.length} pick{answers.length === 1 ? "" : "s"} locked in.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="screen deck-screen submit-screen">
        <p className="submit-title">
          You've answered {answers.length} of {total}.
        </p>
        {submitNotice && (
          <p className="deck-progress" role="status">
            {submitNotice}
          </p>
        )}
        {submitState === "failed" && (
          <TxStatus state="failed" message={submitError} onRetry={() => void submit()} />
        )}
        <Button
          onClick={() => void submit()}
          disabled={submitState === "submitting" || answers.length === 0}
        >
          {submitState === "submitting" ? "Locking picks…" : "Lock my picks"}
        </Button>
      </div>
    );
  }

  const [primary, secondary] = current.outcomes;
  // Up to two upcoming questions peek out behind the active card as static
  // silhouettes — the active card alone owns pointer and keyboard input.
  const upcoming = questions.slice(index + 1, index + 3);
  const deckDisabled = pendingOutcome !== null;

  return (
    <div className="screen deck-screen">
      <p className="deck-progress">
        Card {index + 1} of {total}
      </p>
      {deckNotice && (
        <p className="deck-progress" role="status">
          {deckNotice}
        </p>
      )}

      <div className="deck-group">
        <div className="deck-stage">
          {upcoming
            .map((q, depth) => ({ id: q.id, depth: depth + 1 }))
            .reverse()
            .map(({ id, depth }) => (
              <div
                key={id}
                className={`deck-ghost deck-ghost-${depth} clip-cut-lg`}
                aria-hidden="true"
              />
            ))}
          {/*
            One card instance per question: the key remount means every card
            mounts centered at x=0 with fresh motion values, instead of the
            next question inheriting the previous swipe's drag offset and
            in-flight exit. AnimatePresence keeps the swiped card alive so
            its exit (direction via custom) actually plays while the next
            card is already presented centered (DESIGN.md § 05 Swipe deck).
          */}
          <AnimatePresence initial={false} custom={lastCommit?.direction ?? 1}>
            <QuestionCard
              key={current.id}
              question={current}
              onAnswer={handleAnswer}
              disabled={deckDisabled}
            />
          </AnimatePresence>
          {/*
            Commit streak: one short accent flash on the chosen side, fixed
            to the stage so it never travels with the exiting card. Keyed per
            committed question so each commit restarts the CSS animation; it
            self-finishes at opacity 0 (forwards).
          */}
          {lastCommit && !reducedMotion && (
            <span
              key={lastCommit.questionId}
              className={`card-streak ${lastCommit.direction > 0 ? "card-streak-right" : "card-streak-left"}`}
              aria-hidden="true"
            />
          )}
        </div>

        {/*
          Fixed action rail (DESIGN.md § 05 Swipe deck): the button fallback
          never moves, rotates, or exits with the card. Left = outcomes[1]
          (No/Lower), right = outcomes[0] (Yes/Higher) — same mapping as
          outcomeFromDrag's drag directions.
        */}
        <div className="action-rail" role="group" aria-label="Answer this question">
          <button
            type="button"
            className="btn btn-outcome"
            disabled={deckDisabled}
            onClick={() => handleAnswer(secondary ?? "")}
          >
            <MoveLeft size={16} strokeWidth={2} aria-hidden="true" />
            {capitalizeOutcome(secondary ?? "")}
          </button>
          <button
            type="button"
            className="btn btn-outcome"
            disabled={deckDisabled}
            onClick={() => handleAnswer(primary ?? "")}
          >
            {capitalizeOutcome(primary ?? "")}
            <MoveRight size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      {pendingOutcome && !isAuthenticated && (
        <SavePrompt
          outcome={pendingOutcome}
          onSignIn={handleSignIn}
          onDismiss={() => setPendingOutcome(null)}
        />
      )}
    </div>
  );
}
