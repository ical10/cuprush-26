import { useEffect, useRef, useState } from "react";
import { fetchMyPredictions } from "../lib/api";
import { useLive } from "../hooks/use-live";
import { usePrefersReducedMotion } from "../hooks/use-reduced-motion";
import { isCurrentlyWinning, ruleStat1, ruleStat2, winningLabel } from "../lib/outcome-labels";
import type { Prediction, Question } from "../lib/types";

type MyPrediction = Prediction & { question: Question; correct: boolean | null };

export function LiveScreen() {
  const live = useLive();
  const reducedMotion = usePrefersReducedMotion();
  const [predictions, setPredictions] = useState<MyPrediction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  const seenSeq = useRef<Record<string, number>>({});

  useEffect(() => {
    fetchMyPredictions()
      .then((rows) => setPredictions(rows as MyPrediction[]))
      .catch(() => setError("Sign in to see your live picks."));
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    // Flash only the fixtures whose sequence actually advanced this render,
    // so an update to one match never animates every other live card.
    const advanced: Record<string, boolean> = {};
    for (const [id, update] of Object.entries(live)) {
      if ((seenSeq.current[id] ?? -1) < update.seq) {
        advanced[id] = true;
        seenSeq.current[id] = update.seq;
      }
    }
    if (Object.keys(advanced).length === 0) return;
    setFlash(advanced);
    const timer = setTimeout(() => setFlash({}), 500);
    return () => clearTimeout(timer);
  }, [live, reducedMotion]);

  if (error) return <p className="empty-state">{error}</p>;
  if (!predictions) return <p className="empty-state">Loading your picks…</p>;

  const live_ = predictions.filter((p) =>
    ["locked", "live", "settling"].includes(p.question.status),
  );

  if (live_.length === 0) {
    return <p className="empty-state">No live predictions yet.</p>;
  }

  return (
    <div className="screen live-screen">
      {live_.map((p) => {
        const fixture = p.question.fixture;
        const update = live[fixture.id];
        const stats = update?.stats ?? fixture.stats;
        const gameState = update?.gameState ?? fixture.gameState;
        const winning = isCurrentlyWinning(p.outcome, p.question.rule, stats);
        const stat1 = ruleStat1(p.question.rule, stats);
        const stat2 = ruleStat2(p.question.rule, stats);
        return (
          <article
            key={p.id}
            className={`live-card${flash[fixture.id] ? " live-card-flash" : ""}`}
          >
            <p className="live-fixture">
              {fixture.homeTeam} vs {fixture.awayTeam}
            </p>
            <p className="live-state">Match state: {gameState}</p>
            <p className="live-question">{p.question.question}</p>
            <p className="live-stat">
              {stat1} : {stat2}
            </p>
            <p className="live-pick">Your pick: {p.outcome}</p>
            <p className={`live-winning ${winning ? "is-winning" : "is-losing"}`}>
              {winningLabel(winning)}
            </p>
          </article>
        );
      })}
    </div>
  );
}
