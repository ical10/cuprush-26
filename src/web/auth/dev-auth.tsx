import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "./auth-context";

/**
 * VITE_AUTH_MODE=dev (the default): mints a `dev:<name>` bearer token
 * client-side, matching the server's dev auth stub (src/api/auth/dev.ts).
 * Local development and demo only.
 */
export function DevAuth({ onDone }: { onDone(): void }) {
  const { login } = useAuth();
  const [name, setName] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    login(`dev:${trimmed}`);
    onDone();
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="dev-name">Enter any name to continue</label>
      <input
        id="dev-name"
        name="name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Husni"
      />
      <p className="disclosure">
        Locked on Solana. Creating an account creates a wallet and may submit
        approved game transactions on your behalf.
      </p>
      <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
        Continue
      </button>
    </form>
  );
}
