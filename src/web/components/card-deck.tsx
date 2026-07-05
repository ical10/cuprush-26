import { useEffect, useState } from "react";
import { fetchQuestions, submitPredictionBatch } from "../lib/api";
import { useAuth } from "../auth/auth-context";
import { Button } from "@/components/ui/button";
import type { BatchAnswer, Question } from "../lib/types";
import { QuestionCard } from "./question-card";
import { SavePrompt } from "./save-prompt";
import { TxStatus } from "./tx-status";

type Props = {
  onNavigateAuth(after: () => void): void;
};

type SubmitState = "idle" | "submitting" | "done" | "failed";

export function CardDeck({ onNavigateAuth }: Props) {
  const { isAuthenticated } = useAuth();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  // Answers accumulate locally per swipe — nothing hits the network until the
  // whole deck is submitted as one batch. A refresh before submit discards
  // them (accepted tradeoff); a submitted batch is durable.
  const [answers, setAnswers] = useState<BatchAnswer[]>([]);
  const [pendingOutcome, setPendingOutcome] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestions()
      .then((data) => setQuestions(data.filter((q) => q.status === "open")))
      .catch(() => setError("Could not load questions right now."));
  }, []);

  const current = questions?.[index] ?? null;

  function record(question: Question, outcome: string) {
    setAnswers((prev) => [...prev, { questionId: question.id, outcome }]);
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
    setSubmitState("submitting");
    try {
      await submitPredictionBatch(answers);
      setSubmitState("done");
      setSubmitError(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed.");
      setSubmitState("failed");
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
          <TxStatus state="locked" />
          <p className="deck-progress">
            {answers.length} pick{answers.length === 1 ? "" : "s"} locked in.
          </p>
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
          {submitState === "submitting" ? "Submitting…" : "Submit picks"}
        </Button>
      </div>
    );
  }

  return (
    <div className="screen deck-screen">
      <p className="deck-progress">
        Card {index + 1} of {total}
      </p>
      <QuestionCard question={current} onAnswer={handleAnswer} />

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
