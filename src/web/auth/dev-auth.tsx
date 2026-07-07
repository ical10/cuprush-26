import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "./auth-context";
import { saveWalletAddress } from "../lib/api";
import { randomDemoWalletAddress } from "../lib/demo-wallet";

/**
 * VITE_AUTH_MODE=dev (the default): mints a `dev:<name>` bearer token
 * client-side, matching the server's dev auth stub (src/api/auth/dev.ts).
 * Local development and demo only.
 */
export function DevAuth({ onDone }: { onDone(): void }) {
  const { login } = useAuth();
  const [name, setName] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    login(`dev:${trimmed}`);
    // A real embedded wallet comes from Privy once credentials exist; the
    // dev stub provisions a placeholder one immediately so predictions
    // aren't blocked on the "wallet required" check right after signing in.
    await saveWalletAddress(randomDemoWalletAddress()).catch(() => {});
    onDone();
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="dev-name">Enter any name to sign in</label>
      <input
        id="dev-name"
        name="name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Husni"
      />
      <p className="disclosure">
        Signing in creates an account with an embedded wallet and may submit
        approved game transactions to Solana on your behalf.
      </p>
      <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
        Sign in
      </button>
    </form>
  );
}
