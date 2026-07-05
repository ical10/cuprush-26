import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "../hooks/use-reduced-motion";

export type TxState = "saving" | "locked" | "failed";

type Props = {
  state: TxState;
  message?: string | null;
  onRetry?(): void;
};

export function TxStatus({ state, message, onRetry }: Props) {
  const reducedMotion = usePrefersReducedMotion();

  if (state === "saving") {
    return (
      <p className="tx-status tx-saving" role="status">
        Saving your pick…
      </p>
    );
  }
  if (state === "failed") {
    return (
      <p className="tx-status tx-failed" role="alert">
        {message || "Save failed."}{" "}
        <button type="button" className="btn btn-link" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  return (
    <motion.div
      className="tx-locked-badge"
      role="status"
      initial={reducedMotion ? undefined : { scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
    >
      <svg
        className="tx-locked-check"
        viewBox="0 0 24 24"
        width="28"
        height="28"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.15" />
        <path
          d="M7 12.5l3 3 7-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Locked on Solana.</span>
    </motion.div>
  );
}
