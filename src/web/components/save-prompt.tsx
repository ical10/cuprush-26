type Props = {
  outcome: string;
  onSignIn(): void;
  onDismiss(): void;
};

export function SavePrompt({ outcome, onSignIn, onDismiss }: Props) {
  return (
    <div className="sheet" role="dialog" aria-label="Save your pick">
      <p className="sheet-title">Save your pick and start a streak.</p>
      <p className="sheet-detail">Your pick: {outcome}</p>
      <div className="sheet-actions">
        <button type="button" className="btn btn-primary" onClick={onSignIn}>
          Sign in to save
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>
          Keep browsing
        </button>
      </div>
    </div>
  );
}
