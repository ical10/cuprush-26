import { Clock, Lock, Minus, OctagonX, Scale } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePrefersReducedMotion } from "../hooks/use-reduced-motion";

export type BadgeStatus = "live" | "locking" | "locked" | "settling" | "push" | "void";

/**
 * DESIGN.md § 05 "Status badges": compact pills only for these six states,
 * each pairing color with an icon (or the live dot) and the plain word —
 * never color alone. LIVE is the only badge whose dot pulses, and it goes
 * static under prefers-reduced-motion.
 */
const BADGES: Record<BadgeStatus, { label: string; icon: LucideIcon | null }> = {
  live: { label: "Live", icon: null },
  locking: { label: "Locking", icon: Clock },
  locked: { label: "Locked", icon: Lock },
  settling: { label: "Settling", icon: Scale },
  push: { label: "Push", icon: Minus },
  void: { label: "Void", icon: OctagonX },
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const reducedMotion = usePrefersReducedMotion();
  const { label, icon: Icon } = BADGES[status];
  return (
    <span className={`status-badge status-badge-${status}`}>
      {status === "live" ? (
        <span
          data-testid="badge-dot"
          className={reducedMotion ? "badge-dot" : "badge-dot badge-dot-pulse"}
          aria-hidden="true"
        />
      ) : Icon ? (
        <Icon className="badge-icon" size={12} strokeWidth={2} aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
}
