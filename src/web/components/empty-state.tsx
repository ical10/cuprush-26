import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * DESIGN.md § 05 "Empty, delayed, and error states": name what happened,
 * keep the fan's confidence, give one next action, use a simple line icon —
 * never a sad illustration.
 */
export function EmptyState({
  icon: Icon,
  children,
  action,
}: {
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon className="empty-state-icon" size={28} strokeWidth={2} aria-hidden="true" />
      <p className="empty-state-text">{children}</p>
      {action}
    </div>
  );
}
