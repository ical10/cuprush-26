export const SWIPE_THRESHOLD_PX = 80;

/**
 * Pure swipe -> outcome mapping. `outcomes` is a question's two allowed
 * outcomes in registry order ([yes,no] or [higher,lower]): dragging right
 * (positive dx) picks outcomes[0], dragging left picks outcomes[1]. Below
 * the threshold, no outcome is committed — the card just springs back.
 */
export function outcomeFromDrag(
  dx: number,
  outcomes: readonly string[],
  threshold = SWIPE_THRESHOLD_PX,
): string | null {
  if (Math.abs(dx) < threshold) return null;
  return dx > 0 ? (outcomes[0] ?? null) : (outcomes[1] ?? null);
}

/** Visual rotation for a dragged card, capped so it never flips past readable. */
export function dragRotationDeg(dx: number, max = 12): number {
  const raw = dx / 12;
  return Math.max(-max, Math.min(max, raw));
}
