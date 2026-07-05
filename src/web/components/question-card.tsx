import { useEffect, useState } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import type { PanInfo } from "framer-motion";
import { dragRotationDeg, outcomeFromDrag, SWIPE_VELOCITY_THRESHOLD } from "../lib/card-state";
import { capitalizeOutcome } from "../lib/outcome-labels";
import type { Question } from "../lib/types";

type Props = {
  question: Question;
  onAnswer(outcome: string): void;
  disabled?: boolean;
};

const EXIT_DISTANCE_PX = 600;

export function QuestionCard({ question, onAnswer, disabled }: Props) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, (value) => dragRotationDeg(value));
  const [exitDirection, setExitDirection] = useState<1 | -1 | null>(null);

  const [primary, secondary] = question.outcomes;

  // A new question means a fresh card: reset any exit animation from the
  // previous one instead of carrying it over.
  useEffect(() => {
    x.set(0);
    setExitDirection(null);
  }, [question.id, x]);

  function handleDragEnd(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    if (disabled) return;
    const outcome = outcomeFromDrag(
      info.offset.x,
      question.outcomes,
      undefined,
      info.velocity.x,
    );
    if (!outcome) return;
    const byVelocity = Math.abs(info.velocity.x) >= SWIPE_VELOCITY_THRESHOLD;
    const direction = byVelocity ? info.velocity.x : info.offset.x;
    setExitDirection(direction > 0 ? 1 : -1);
    onAnswer(outcome);
  }

  return (
    <div className="card-wrap">
      <motion.div
        className="question-card"
        style={{ x, rotate }}
        drag={disabled || exitDirection ? false : "x"}
        dragElastic={0.6}
        onDragEnd={handleDragEnd}
        animate={
          exitDirection
            ? { x: exitDirection * EXIT_DISTANCE_PX, opacity: 0 }
            : { x: 0, opacity: 1 }
        }
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        data-testid="question-card"
      >
        <p className="card-fixture">
          {question.fixture.homeTeam} vs {question.fixture.awayTeam}
        </p>
        <h2 className="card-question">{question.question}</h2>
      </motion.div>

      <div className="card-buttons" role="group" aria-label="Answer this question">
        <button
          type="button"
          className="btn btn-outcome"
          disabled={disabled}
          onClick={() => onAnswer(primary ?? "")}
        >
          {capitalizeOutcome(primary ?? "")}
        </button>
        <button
          type="button"
          className="btn btn-outcome"
          disabled={disabled}
          onClick={() => onAnswer(secondary ?? "")}
        >
          {capitalizeOutcome(secondary ?? "")}
        </button>
      </div>
    </div>
  );
}
