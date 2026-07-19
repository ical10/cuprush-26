import { useCallback, useEffect, useState } from "react";
import { fetchMe, fetchMyPredictions } from "../lib/api";
import { buildShareText } from "../lib/share-text";
import { Flag } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { EmptyState } from "./empty-state";
import type { Me, Prediction, Question } from "../lib/types";

type MyPrediction = Prediction & { question: Question; correct: boolean | null };

const VOID_COPY = "Match cancelled — no points";

async function share(text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  await navigator.clipboard?.writeText(text);
  return "copied";
}

function resultPhrase(p: MyPrediction): { text: string; tone: string } {
  if (p.question.status === "void") return { text: VOID_COPY, tone: "result-pending" };
  if (p.question.result === "push") return { text: "It's a push", tone: "result-push" };
  if (p.correct === null) return { text: "Result on its way", tone: "result-pending" };
  return p.correct
    ? { text: "You called it", tone: "result-correct" }
    : { text: "Not this time", tone: "result-incorrect" };
}

/**
 * Latest first by the question's settledAt. Void questions never settle
 * (settledAt stays null), so they fall back to the server's order, which is
 * prediction createdAt desc.
 */
function sortResolved(resolved: MyPrediction[]): MyPrediction[] {
  return resolved
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const ta = a.p.question.settledAt ? Date.parse(a.p.question.settledAt) : 0;
      const tb = b.p.question.settledAt ? Date.parse(b.p.question.settledAt) : 0;
      if (ta !== tb) return tb - ta;
      return a.index - b.index;
    })
    .map((entry) => entry.p);
}

export function ResultScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [predictions, setPredictions] = useState<MyPrediction[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [shareState, setShareState] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    setPredictions(null);
    fetchMe().then(setMe).catch(() => setMe(null));
    fetchMyPredictions()
      .then((rows) => setPredictions(rows as MyPrediction[]))
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Settled and void picks both resolve a card — a cancelled match must not
  // vanish from the fan's history.
  const resolved = sortResolved(
    (predictions ?? []).filter(
      (p) => p.question.status === "settled" || p.question.status === "void",
    ),
  );
  const latest = resolved.at(0);
  const rest = resolved.slice(1);

  if (loadFailed) {
    return (
      <EmptyState
        icon={Flag}
        action={
          <button type="button" className="btn btn-primary" onClick={load}>
            Retry
          </button>
        }
      >
        Couldn't load your results.
      </EmptyState>
    );
  }
  if (!predictions) return <p className="empty-state">Loading results…</p>;
  if (!latest) {
    return (
      <EmptyState icon={Flag}>
        No settled picks yet. Make the call now and check back after the whistle.
      </EmptyState>
    );
  }

  const isVoid = latest.question.status === "void";
  const isPush = !isVoid && latest.question.result === "push";
  const { text: resultText, tone: resultTone } = resultPhrase(latest);

  async function handleShare() {
    const text = buildShareText({
      won: latest?.correct ?? null,
      streak: me?.currentStreak ?? 0,
      question: latest?.question.question ?? "",
    });
    setShareState(await share(text));
  }

  return (
    <div className="screen result-screen">
      <article className="result-card result-reveal">
        <h2 className={`result-phrase type-display-l ${resultTone}`}>{resultText}</h2>
        {isVoid && <StatusBadge status="void" />}
        {isPush && <StatusBadge status="push" />}
        <p className="result-question">{latest.question.question}</p>
        <p className="result-stat tabular">
          Streak: {me?.currentStreak ?? 0} · Best: {me?.bestStreak ?? 0} · Points:{" "}
          {me?.points ?? 0}
        </p>
        <p className="result-next">
          {isVoid
            ? "That one doesn't count — another card is waiting in the deck."
            : latest.correct === false
              ? "Next call is yours — another card is waiting in the deck."
              : "Keep it rolling — another card is waiting in the deck."}
        </p>
        {!isVoid && (
          <button type="button" className="btn btn-primary" onClick={() => void handleShare()}>
            Share result
          </button>
        )}
        {shareState === "copied" && <p role="status">Copied to clipboard.</p>}
      </article>
      {rest.map((p) => {
        const phrase = resultPhrase(p);
        const badge =
          p.question.status === "void" ? "void" : p.question.result === "push" ? "push" : null;
        return (
          <article key={p.id} className="result-card">
            <p className={`result-phrase ${phrase.tone}`}>{phrase.text}</p>
            {badge && <StatusBadge status={badge} />}
            <p className="result-question">{p.question.question}</p>
          </article>
        );
      })}
      <div className="sponsor-slot" aria-label="Sponsor">
        Sponsored by TxODDS
      </div>
    </div>
  );
}
