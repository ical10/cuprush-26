import { useEffect, useRef, useState } from "react";
import { MoveLeft, MoveRight } from "lucide-react";
import { fetchQuestions, submitPredictionBatch } from "../lib/api";
import { useAuth } from "../auth/auth-context";
import { Button } from "@/components/ui/button";
import type { BatchAnswer, Question } from "../lib/types";
import { QuestionCard } from "./question-card";
import { SavePrompt } from "./save-prompt";
import { TxStatus } from "./tx-status";
import { capitalizeOutcome } from "../lib/outcome-labels";
import stadiumBg from "../assets/stadium-bg.jpg";

export type Props = {
  onNavigateAuth(after: () => void): void;
  /* Optional external state management for gamified simulator integration.
     When provided, the component delegates answer tracking and submission
     to the parent (App.tsx) instead of managing its own local state. */
  answers?: BatchAnswer[];
  onBetPlaced?: (question: Question, outcome: string) => void;
  onSkip?: (question: Question) => void;
  submitState?: "idle" | "submitting" | "done" | "failed";
  submitError?: string | null;
  onSubmit?: () => void | Promise<void>;
  onResetAnswers?: () => void;
};

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

type SubmitState = "idle" | "submitting" | "done" | "failed";

function Deck({
  onNavigateAuth,
  answers: externalAnswers,
  onBetPlaced,
  onSkip,
  submitState: externalSubmitState,
  submitError: externalSubmitError,
  onSubmit: externalOnSubmit,
  onResetAnswers,
}: Props) {
  const hasExternalState = externalAnswers !== undefined;
  const { isAuthenticated } = useAuth();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  // Answers accumulate locally per swipe — nothing hits the network until the
  // whole deck is submitted as one batch. A refresh before submit discards
  // them (accepted tradeoff); a submitted batch is durable.
  const [localAnswers, setLocalAnswers] = useState<BatchAnswer[]>([]);
  const [pendingOutcome, setPendingOutcome] = useState<string | null>(null);
  const [localSubmitState, setLocalSubmitState] = useState<SubmitState>("idle");
  const [localSubmitError, setLocalSubmitError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use external state if provided, otherwise fall back to local
  const answers = hasExternalState ? externalAnswers : localAnswers;
  const submitState = hasExternalState && externalSubmitState ? externalSubmitState : localSubmitState;
  const submitError = hasExternalState ? (externalSubmitError ?? null) : localSubmitError;

  useEffect(() => {
    fetchQuestions()
      .then((data) => setQuestions(data.filter((q) => q.status === "open")))
      .catch(() => setError("Could not load questions right now."));
  }, []);

  const current = questions?.[index] ?? null;

  function record(question: Question, outcome: string) {
    if (hasExternalState && onBetPlaced) {
      onBetPlaced(question, outcome);
    } else {
      setLocalAnswers((prev) => [...prev, { questionId: question.id, outcome }]);
    }
    setIndex((i) => i + 1);
  }

  function handleAnswer(outcome: string) {
    if (!current) return;
    if (!isAuthenticated) {
      // Sign-in gate stays at the first answer — guests browse and drag
      // freely, but must sign in before any pick is kept.
      setPendingOutcome(outcome);
      return;
    }
    record(current, outcome);
  }

  function handleSignIn() {
    if (!current || !pendingOutcome) return;
    const question = current;
    const outcome = pendingOutcome;
    onNavigateAuth(() => {
      setPendingOutcome(null);
      record(question, outcome);
    });
  }

  async function submit() {
    if (hasExternalState && externalOnSubmit) {
      await externalOnSubmit();
      return;
    }
    setLocalSubmitState("submitting");
    try {
      await submitPredictionBatch(localAnswers);
      setLocalSubmitState("done");
      setLocalSubmitError(null);
    } catch (err) {
      setLocalSubmitError(err instanceof Error ? err.message : "Submit failed.");
      setLocalSubmitState("failed");
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
            <TxStatus state="locked" />
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
          <QuestionCard question={current} onAnswer={handleAnswer} disabled={deckDisabled} />
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
