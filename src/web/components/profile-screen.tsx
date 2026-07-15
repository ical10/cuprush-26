import { useEffect, useState } from "react";
import {
  deleteAccount,
  fetchMe,
  revokeDelegation,
  updateDisplayName,
} from "../lib/api";
import { useAuth } from "../auth/auth-context";
import type { Me } from "../lib/types";

type Status = {
  area: "name" | "delegation" | "delete";
  tone: "success" | "error";
  text: string;
};

export function ProfileScreen() {
  const { isAuthenticated, logout } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
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
      setStatus({ area: "name", tone: "success", text: "Name saved." });
    } catch {
      setStatus({
        area: "name",
        tone: "error",
        text: "Couldn't save your name. Try again.",
      });
    }
  }

  async function handleRevoke() {
    setStatus(null);
    try {
      await revokeDelegation();
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
    } catch {
      setStatus({
        area: "delete",
        tone: "error",
        text: "Couldn't delete your account. Try again.",
      });
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
          onChange={(event) => setName(event.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={() => void handleSaveName()}>
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
            No wallet yet. Sign in again to create one.
          </p>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => void handleRevoke()}>
          Revoke delegation
        </button>
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
