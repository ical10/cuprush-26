import { useEffect, useState } from "react";
import {
  deleteAccount,
  fetchMe,
  revokeDelegation,
  updateDisplayName,
} from "../lib/api";
import { useAuth } from "../auth/auth-context";
import type { Me } from "../lib/types";

export function ProfileScreen() {
  const { isAuthenticated, logout } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMe()
      .then((m) => {
        setMe(m);
        setName(m.displayName ?? "");
      })
      .catch(() => setMe(null));
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <p className="empty-state">Sign in to view your profile.</p>;
  }
  if (!me) return <p className="empty-state">Loading profile…</p>;

  async function handleSaveName() {
    setStatus(null);
    try {
      const updated = await updateDisplayName(name);
      setMe(updated);
      setStatus("Saved.");
    } catch {
      setStatus("Could not save name.");
    }
  }

  async function handleRevoke() {
    try {
      await revokeDelegation();
      setStatus("Delegation revoked.");
    } catch {
      setStatus("Could not revoke delegation.");
    }
  }

  async function handleDelete() {
    try {
      await deleteAccount();
      logout();
    } catch {
      setStatus("Could not delete account.");
    }
  }

  return (
    <div className="screen profile-screen">
      <h2>Profile</h2>

      <label htmlFor="display-name">Display name</label>
      <input
        id="display-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="button" className="btn btn-primary" onClick={() => void handleSaveName()}>
        Save name
      </button>

      <p className="wallet-address">
        Wallet: {me.walletAddress ?? "not created yet"}
      </p>
      <button type="button" className="btn btn-outcome" onClick={() => void handleRevoke()}>
        Revoke delegation
      </button>

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
          <div>
            <p role="alert">
              Deleting your account anonymizes your profile. On-chain
              transactions cannot be erased and will remain on Solana.
            </p>
            <button type="button" className="btn btn-danger" onClick={() => void handleDelete()}>
              Confirm delete
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {status && <p role="status">{status}</p>}
    </div>
  );
}
