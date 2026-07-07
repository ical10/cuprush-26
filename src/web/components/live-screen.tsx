import { useEffect, useRef, useState } from "react";
import { fetchMyPredictions } from "../lib/api";
import { useLive } from "../hooks/use-live";
import { usePrefersReducedMotion } from "../hooks/use-reduced-motion";
import {
  capitalizeOutcome,
  isCurrentlyWinning,
  ruleStat1,
  ruleStat2,
  winningLabel,
} from "../lib/outcome-labels";
import { Activity, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hashForScreen } from "../lib/routes";
import { StatusBadge } from "./status-badge";
import type { BadgeStatus } from "./status-badge";
import { EmptyState } from "./empty-state";
import type { Prediction, Question } from "../lib/types";

type MyPrediction = Prediction & { question: Question; correct: boolean | null };

/**
 * One live stat value. Pulses Victory Cyan exactly once (450ms) when its own
 * value changes — never when a sibling stat or another fixture updates — and
 * stays still under prefers-reduced-motion (DESIGN.md § 05 "Live card").
 */
function LiveValue({ value }: { value: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const [pulse, setPulse] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (reducedMotion) return;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 450);
    return () => clearTimeout(timer);
  }, [value, reducedMotion]);

  return (
    <span className={pulse ? "live-value live-value-pulse" : "live-value"}>{value}</span>
  );
}

export function LiveScreen() {
  const live = useLive();
  const [predictions, setPredictions] = useState<MyPrediction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyPredictions()
      .then((rows) => setPredictions(rows as MyPrediction[]))
      .catch(() => setError("Sign in to see your live picks."));
  }, []);

  if (error) {
    return (
      <EmptyState
        icon={LogIn}
        action={
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => {
              location.hash = hashForScreen("auth");
            }}
          >
            Sign in
          </Button>
        }
      >
        {error}
      </EmptyState>
    );
  }
  if (!predictions) return <p className="empty-state">Loading your picks…</p>;

  const live_ = predictions.filter((p) =>
    ["locked", "live", "settling"].includes(p.question.status),
  );

  if (live_.length === 0) {
    return (
      <EmptyState icon={Activity}>
        No live picks yet. Head to the deck and make the call.
      </EmptyState>
    );
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
          <article key={p.id} className="live-card">
            <header className="live-card-head">
              <p className="live-fixture">
                {fixture.homeTeam} vs {fixture.awayTeam}
              </p>
              <StatusBadge status={p.question.status as BadgeStatus} />
            </header>
            <p className="live-scoreline type-score tabular">
              <LiveValue value={stat1} />
              <span className="live-scoreline-sep" aria-hidden="true">
                :
              </span>
              <LiveValue value={stat2} />
            </p>
            <p className={`live-standing ${winning ? "is-winning" : "is-losing"}`}>
              {winningLabel(winning)}
            </p>
            <p className="live-question">{p.question.question}</p>
            <p className="live-pick">Your pick: {capitalizeOutcome(p.outcome)}</p>
            <p className="live-state">Match state: {gameState}</p>
          </article>
        );
      })}
    </div>
  );
}
