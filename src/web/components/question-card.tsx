import { useEffect, useState } from "react";
import { motion, useMotionValue, useMotionValueEvent, useTransform } from "framer-motion";
import type { PanInfo } from "framer-motion";
import {
  dragRotationDeg,
  outcomeFromDrag,
  SWIPE_THRESHOLD_PX,
  SWIPE_VELOCITY_THRESHOLD,
} from "../lib/card-state";
import { capitalizeOutcome } from "../lib/outcome-labels";
import { usePrefersReducedMotion } from "../hooks/use-reduced-motion";
import type { Question } from "../lib/types";

type Props = {
  question: Question;
  onAnswer(outcome: string): void;
  disabled?: boolean;
};

const EXIT_DISTANCE_PX = 600;

type PreviewSide = "left" | "right";

/**
 * The draggable card only: fixture, question, and directional swipe cues
 * (DESIGN.md § 05 Prediction card). The outcome buttons live in the deck's
 * fixed action rail so they never move, rotate, or exit with the card.
 */
export function QuestionCard({ question, onAnswer, disabled }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, (value) => (reducedMotion ? 0 : dragRotationDeg(value)));
  const [exitDirection, setExitDirection] = useState<1 | -1 | null>(null);
  const [preview, setPreview] = useState<PreviewSide | null>(null);

  const [primary, secondary] = question.outcomes;

  // Reveal the would-be outcome only once the drag clears the same distance
  // threshold outcomeFromDrag commits on. Below it the card snaps back
  // uncommitted, so no label or semantic colour may appear yet.
  useMotionValueEvent(x, "change", (value) => {
    const next: PreviewSide | null =
      Math.abs(value) >= SWIPE_THRESHOLD_PX ? (value > 0 ? "right" : "left") : null;
    setPreview((prev) => (prev === next ? prev : next));
  });

  // A new question means a fresh card: reset any exit animation from the
  // previous one instead of carrying it over.
  useEffect(() => {
    x.set(0);
    setExitDirection(null);
    setPreview(null);
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

  const previewLabel = capitalizeOutcome(
    (preview === "right" ? primary : secondary) ?? "",
  );

  return (
    <>
      <motion.div
        className="question-card clip-cut-lg"
        data-commit={preview ?? undefined}
        style={{ x, rotate }}
        drag={disabled || exitDirection ? false : "x"}
        dragElastic={0.6}
        onDragEnd={handleDragEnd}
        animate={
          exitDirection
            ? reducedMotion
              ? { opacity: 0 }
              : { x: exitDirection * EXIT_DISTANCE_PX, opacity: 0 }
            : { x: 0, opacity: 1 }
        }
        transition={
          exitDirection
            ? { duration: reducedMotion ? 0.12 : 0.28, ease: "easeOut" }
            : reducedMotion
              ? { duration: 0.15, ease: "easeOut" }
              : { type: "spring", stiffness: 300, damping: 30 }
        }
        data-testid="question-card"
      >
        <p className="card-fixture type-meta">
          {question.fixture.homeTeam} vs {question.fixture.awayTeam}
        </p>
        <h2 className="card-question type-card-question">{question.question}</h2>
        <div className="card-space" aria-hidden="true" />
        {/*
          Decorative mirror of the rail: left = outcomes[1] (No/Lower),
          right = outcomes[0] (Yes/Higher), matching outcomeFromDrag's
          drag-right -> outcomes[0] semantics. The accessible controls are
          the rail buttons in card-deck.
        */}
        <p className="card-cues type-meta" aria-hidden="true">
          <span>&larr; {capitalizeOutcome(secondary ?? "")}</span>
          <span>{capitalizeOutcome(primary ?? "")} &rarr;</span>
        </p>
        {preview && (
          <span
            className={`card-reveal card-reveal-${preview}`}
            data-testid="card-reveal"
            aria-hidden="true"
          >
            {previewLabel}
          </span>
        )}
      </motion.div>
      {exitDirection && !reducedMotion && (
        <span
          className={`card-streak ${exitDirection > 0 ? "card-streak-right" : "card-streak-left"}`}
          aria-hidden="true"
        />
      )}
    </>
  );
}
