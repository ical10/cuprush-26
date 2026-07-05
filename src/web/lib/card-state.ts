export const SWIPE_THRESHOLD_PX = 80;
export const SWIPE_VELOCITY_THRESHOLD = 500;

/**
 * Pure swipe -> outcome mapping. `outcomes` is a question's two allowed
 * outcomes in registry order ([yes,no] or [higher,lower]): dragging right
 * (positive dx) picks outcomes[0], dragging left picks outcomes[1]. Commits
 * once distance clears `threshold`, OR once a fast flick clears
 * `velocityThreshold` regardless of distance (framer-motion's onDragEnd
 * reports both). Otherwise the card springs back uncommitted.
 */
export function outcomeFromDrag(
  dx: number,
  outcomes: readonly string[],
  threshold = SWIPE_THRESHOLD_PX,
  velocity = 0,
  velocityThreshold = SWIPE_VELOCITY_THRESHOLD,
): string | null {
  const committed =
    Math.abs(dx) >= threshold || Math.abs(velocity) >= velocityThreshold;
  if (!committed) return null;
  const direction = Math.abs(velocity) >= velocityThreshold ? velocity : dx;
  return direction > 0 ? (outcomes[0] ?? null) : (outcomes[1] ?? null);
}

/** Visual rotation for a dragged card, capped so it never flips past readable. */
export function dragRotationDeg(dx: number, max = 12): number {
  const raw = dx / 12;
  return Math.max(-max, Math.min(max, raw));
}
