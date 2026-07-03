export type TxState = "saving" | "locked" | "failed";

export function TxStatus({ state, onRetry }: { state: TxState; onRetry?(): void }) {
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
        Save failed.{" "}
        <button type="button" className="btn btn-link" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  return (
    <p className="tx-status tx-locked" role="status">
      Locked on Solana.
    </p>
  );
}
