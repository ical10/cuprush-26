import { useEffect, useState } from "react";
import { fetchMe, fetchMyPredictions } from "../lib/api";
import { buildShareText } from "../lib/share-text";
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
    return <p className="empty-state">No settled predictions yet — check back after kickoff.</p>;
  }

  const resultText =
    latest.correct === null
      ? "Result pending"
      : latest.correct
        ? "You called it right"
        : "Not this time";

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
      <h2>{resultText}</h2>
      <p className="result-question">{latest.question.question}</p>
      <p className="result-stat">
        Streak: {me?.currentStreak ?? 0} · Best: {me?.bestStreak ?? 0} · Points:{" "}
        {me?.points ?? 0}
      </p>
      <p className="result-next">Next challenge: another card is waiting in the deck.</p>
      <div className="sponsor-slot" aria-label="Sponsor">
        Sponsored by TxODDS
      </div>
      <button type="button" className="btn btn-primary" onClick={() => void handleShare()}>
        Share result
      </button>
      {shareState === "copied" && <p role="status">Copied to clipboard.</p>}
    </div>
  );
}
