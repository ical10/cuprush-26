import { useEffect, useState } from "react";
import { fetchQuestions, submitPrediction } from "../lib/api";
import { useAuth } from "../auth/auth-context";
import type { Question } from "../lib/types";
import { QuestionCard } from "./question-card";
import { SavePrompt } from "./save-prompt";
import { TxStatus } from "./tx-status";
import type { TxState } from "./tx-status";

type Props = {
  onNavigateAuth(after: () => void): void;
};

export function CardDeck({ onNavigateAuth }: Props) {
  const { isAuthenticated } = useAuth();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [pendingOutcome, setPendingOutcome] = useState<string | null>(null);
  const [txState, setTxState] = useState<TxState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestions()
      .then((data) => setQuestions(data.filter((q) => q.status === "open")))
      .catch(() => setError("Could not load questions right now."));
  }, []);

  // Auto-advance once the checkmark animation has had a beat to register,
  // instead of requiring a "Next question" tap.
  useEffect(() => {
    if (txState !== "locked") return;
    const timer = setTimeout(() => {
      setTxState(null);
      setPendingOutcome(null);
      setIndex((i) => i + 1);
    }, 900);
    return () => clearTimeout(timer);
  }, [txState]);

  const current = questions?.[index] ?? null;

  async function save(question: Question, outcome: string) {
    setTxState("saving");
    setLastAttempt(outcome);
    try {
      await submitPrediction(question.id, outcome);
      setTxState("locked");
    } catch {
      setTxState("failed");
    }
  }

  function handleAnswer(outcome: string) {
    if (!current) return;
    if (!isAuthenticated) {
      setPendingOutcome(outcome);
      return;
    }
    void save(current, outcome);
  }

  function handleSignIn() {
    if (!current || !pendingOutcome) return;
    const outcome = pendingOutcome;
    onNavigateAuth(() => {
      setPendingOutcome(null);
      void save(current, outcome);
    });
  }

  if (error) return <p className="empty-state">{error}</p>;
  if (!questions) return <p className="empty-state">Loading questions…</p>;
  const total = questions.length;
  const swiped = Math.min(index, total);
  if (!current) {
    return (
      <p className="empty-state">
        {total > 0
          ? `You've swiped ${swiped} of ${total} questions.`
          : "No open questions right now. Check back closer to kickoff."}
      </p>
    );
  }

  return (
    <div className="screen deck-screen">
      <p className="deck-progress">
        Card {index + 1} of {total}
      </p>
      <QuestionCard
        question={current}
        onAnswer={handleAnswer}
        disabled={txState === "saving" || txState === "locked"}
      />

      {pendingOutcome && !isAuthenticated && (
        <SavePrompt
          outcome={pendingOutcome}
          onSignIn={handleSignIn}
          onDismiss={() => setPendingOutcome(null)}
        />
      )}

      {txState && (
        <div className="tx-panel">
          <TxStatus
            state={txState}
            onRetry={() => current && lastAttempt && void save(current, lastAttempt)}
          />
        </div>
      )}
    </div>
  );
}
