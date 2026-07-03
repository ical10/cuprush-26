import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { dragRotationDeg, outcomeFromDrag } from "../lib/card-state";
import type { Question } from "../lib/types";

type Props = {
  question: Question;
  onAnswer(outcome: string): void;
  disabled?: boolean;
};

export function QuestionCard({ question, onAnswer, disabled }: Props) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const pointerId = useRef<number | null>(null);

  const [primary, secondary] = question.outcomes;

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    pointerId.current = event.pointerId;
    startX.current = event.clientX;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging || pointerId.current !== event.pointerId) return;
    setDx(event.clientX - startX.current);
  }

  function release() {
    const outcome = outcomeFromDrag(dx, question.outcomes);
    setDragging(false);
    setDx(0);
    if (outcome) onAnswer(outcome);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    release();
  }

  return (
    <div className="card-wrap">
      <div
        className="question-card"
        style={{
          transform: `translateX(${dx}px) rotate(${dragRotationDeg(dx)}deg)`,
          transition: dragging ? "none" : "transform 0.2s ease",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        data-testid="question-card"
      >
        <p className="card-fixture">
          {question.fixture.homeTeam} vs {question.fixture.awayTeam}
        </p>
        <h2 className="card-question">{question.question}</h2>
      </div>

      <div className="card-buttons" role="group" aria-label="Answer this question">
        <button
          type="button"
          className="btn btn-outcome"
          disabled={disabled}
          onClick={() => onAnswer(primary ?? "")}
        >
          {primary}
        </button>
        <button
          type="button"
          className="btn btn-outcome"
          disabled={disabled}
          onClick={() => onAnswer(secondary ?? "")}
        >
          {secondary}
        </button>
      </div>
    </div>
  );
}
