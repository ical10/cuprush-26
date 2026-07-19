import { useEffect, useState } from "react";
import {
  deleteAccount,
  fetchMe,
  revokeDelegation,
  updateDisplayName,
} from "../lib/api";
import { useAuth } from "../auth/auth-context";
import type { Me } from "../lib/types";

// Privy may still be provisioning the embedded wallet when the profile first
// loads; one delayed re-fetch usually picks it up without a manual refresh.
const WALLET_RETRY_DELAY_MS = 4_000;

type Status = {
  area: "name" | "delegation" | "delete";
  tone: "success" | "error";
  text: string;
};

type Props = {
  onSignIn: () => void;
};

export function ProfileScreen({ onSignIn }: Props) {
  const { isAuthenticated, logout } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let walletRetry: ReturnType<typeof setTimeout> | undefined;

    function load(isInitial: boolean) {
      fetchMe()
        .then((m) => {
          if (cancelled) return;
          setMe(m);
          if (isInitial) {
            setName(m.displayName ?? "");
            if (m.walletAddress === null) {
              walletRetry = setTimeout(
                () => load(false),
                WALLET_RETRY_DELAY_MS,
              );
            }
          }
        })
        .catch(() => {
          if (!cancelled && isInitial) setLoadFailed(true);
        });
    }

    load(true);
    return () => {
      cancelled = true;
      if (walletRetry) clearTimeout(walletRetry);
    };
  }, [isAuthenticated, loadAttempt]);

  if (!isAuthenticated) {
    return (
      <div className="empty-state">
        <p>Sign in to view your profile.</p>
        <button type="button" className="btn btn-primary" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    );
  }
  if (loadFailed) {
    return (
      <div className="empty-state">
        <p>Couldn&apos;t load your profile.</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setLoadFailed(false);
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Retry
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => logout()}>
          Sign out
        </button>
      </div>
    );
  }
  if (!me) return <p className="empty-state">Loading profile…</p>;

  async function handleSaveName() {
    setStatus(null);
    setSavingName(true);
    try {
      const updated = await updateDisplayName(name);
      setMe(updated);
      setStatus({ area: "name", tone: "success", text: "Name saved." });
    } catch (error) {
      const message =
        error instanceof Error && error.message !== ""
          ? error.message
          : "Couldn't save your name. Try again.";
      setStatus({ area: "name", tone: "error", text: message });
    } finally {
      setSavingName(false);
    }
  }

  async function handleRevoke() {
    setStatus(null);
    try {
      await revokeDelegation();
      setConfirmRevoke(false);
      setStatus({
        area: "delegation",
        tone: "success",
        text: "Delegation revoked.",
      });
    } catch {
      setStatus({
        area: "delegation",
        tone: "error",
        text: "Couldn't revoke delegation. Try again.",
      });
    }
  }

  async function handleDelete() {
    setStatus(null);
    try {
      await deleteAccount();
      logout();
      return;
    } catch {
      // The delete may have succeeded server-side with the response lost in
      // transit. Verify before reporting failure: a re-fetch that errors or
      // returns a blank (freshly provisioned) profile means the old account
      // is gone, so log out instead of leaving a broken session behind.
    }
    let stillExists = false;
    try {
      const check = await fetchMe();
      stillExists =
        check.displayName !== null ||
        check.walletAddress !== null ||
        check.points > 0 ||
        check.currentStreak > 0 ||
        check.bestStreak > 0;
    } catch {
      // Unreachable profile: treat as gone.
    }
    if (stillExists) {
      setStatus({
        area: "delete",
        tone: "error",
        text: "Couldn't delete your account. Try again.",
      });
    } else {
      logout();
    }
  }

  function statusLine(area: Status["area"]) {
    if (status?.area !== area) return null;
    return (
      <p role="status" className={`form-status form-status-${status.tone}`}>
        {status.text}
      </p>
    );
  }

  return (
    <div className="screen profile-screen">
      <h2 className="type-screen-title">Profile</h2>

      <div className="profile-field">
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          value={name}
          maxLength={32}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={savingName}
          onClick={() => void handleSaveName()}
        >
          Save name
        </button>
        {statusLine("name")}
      </div>

      <div className="profile-field">
        <span className="profile-label">Wallet</span>
        {me.walletAddress ? (
          <code className="wallet-address">{me.walletAddress}</code>
        ) : (
          <p className="type-body wallet-empty">
            No wallet yet. It may still be setting up — refresh in a moment, or
            sign out and back in.
          </p>
        )}
        {!confirmRevoke ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setConfirmRevoke(true)}
          >
            Revoke delegation
          </button>
        ) : (
          <div className="danger-confirm">
            <p role="alert" className="type-body">
              Revoking permanently stops the server from saving your picks —
              there is no way to undo it. Your existing points remain.
            </p>
            <div className="danger-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleRevoke()}
              >
                Revoke permanently
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmRevoke(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {statusLine("delegation")}
      </div>

      <div className="profile-field">
        <button type="button" className="btn btn-secondary" onClick={() => logout()}>
          Sign out
        </button>
      </div>

      <div className="danger-zone">
        {!confirmDelete ? (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete account
          </button>
        ) : (
          <div className="danger-confirm">
            <p role="alert" className="type-body">
              Deleting your account anonymizes your profile. On-chain
              transactions cannot be erased and will remain on Solana.
            </p>
            <div className="danger-actions">
              <button type="button" className="btn btn-danger" onClick={() => void handleDelete()}>
                Delete my account
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
            {statusLine("delete")}
          </div>
        )}
      </div>
    </div>
  );
}
