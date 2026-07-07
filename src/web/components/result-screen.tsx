import { useEffect, useState } from "react";
import { fetchMe, fetchMyPredictions } from "../lib/api";
import { buildShareText } from "../lib/share-text";
import { Flag } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { EmptyState } from "./empty-state";
import type { Me, Prediction, Question } from "../lib/types";

type MyPrediction = Prediction & { question: Question; correct: boolean | null };

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

export function ResultScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [predictions, setPredictions] = useState<MyPrediction[] | null>(null);
  const [shareState, setShareState] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then(setMe).catch(() => setMe(null));
    fetchMyPredictions()
      .then((rows) => setPredictions(rows as MyPrediction[]))
      .catch(() => setPredictions([]));
  }, []);

  const settled = (predictions ?? []).filter((p) => p.question.status === "settled");
  const latest = settled.at(0);

  if (!predictions) return <p className="empty-state">Loading results…</p>;
  if (!latest) {
    return (
      <EmptyState icon={Flag}>
        No settled picks yet. Make the call now and check back after the whistle.
      </EmptyState>
    );
  }

  const isPush = latest.question.result === "push";
  const resultText = isPush
    ? "It's a push"
    : latest.correct === null
      ? "Result on its way"
      : latest.correct
        ? "You called it"
        : "Not this time";
  const resultTone = isPush
    ? "result-push"
    : latest.correct === null
      ? "result-pending"
      : latest.correct
        ? "result-correct"
        : "result-incorrect";

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
        {isPush && <StatusBadge status="push" />}
        <p className="result-question">{latest.question.question}</p>
        <p className="result-stat tabular">
          Streak: {me?.currentStreak ?? 0} · Best: {me?.bestStreak ?? 0} · Points:{" "}
          {me?.points ?? 0}
        </p>
        <p className="result-next">
          {latest.correct === false
            ? "Next call is yours — another card is waiting in the deck."
            : "Keep it rolling — another card is waiting in the deck."}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void handleShare()}>
          Share result
        </button>
        {shareState === "copied" && <p role="status">Copied to clipboard.</p>}
      </article>
      <div className="sponsor-slot" aria-label="Sponsor">
        Sponsored by TxODDS
      </div>
    </div>
  );
}
