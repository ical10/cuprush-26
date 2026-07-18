import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "../hooks/use-reduced-motion";

export type TxState = "saving" | "saved" | "locked" | "failed";

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
        {message || "That save didn't go through. Your pick is still here."}{" "}
        <button type="button" className="btn btn-link" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  // saved: picks are stored and immutable, but the on-chain commitment is
  // deferred — the reconciler freezes each fixture's hash on chain when it
  // locks (kickoff-30m). locked: the commitment is confirmed on chain.
  const label =
    state === "saved"
      ? "Saved. Locks on Solana before kickoff."
      : "Locked on Solana.";
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
      <span>{label}</span>
    </motion.div>
  );
}
