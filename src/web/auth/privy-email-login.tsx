import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLoginWithEmail } from "@privy-io/react-auth";

/**
 * Passwordless email OTP sign-in. Step 1 emails a 6-digit code; step 2
 * verifies it, at which point Privy authenticates the user and (per
 * PrivyProvider config) creates their embedded Solana wallet. Wallet
 * persistence is handled by PrivyBridge, not here.
 */
export function PrivyEmailLogin({ onDone }: { onDone(): void }) {
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function handleSendCode(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      await sendCode({ email: trimmed });
      setStage("code");
      setCooldown(30);
    } catch (error) {
      console.error("failed to send Privy email code", error);
      setError("Couldn't send a code to that email. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await loginWithCode({ code });
      onDone();
    } catch (error) {
      console.error("failed to verify Privy email code", error);
      setError("That code didn't work. Check it or request a new one.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "email") {
    return (
      <form className="auth-form" onSubmit={handleSendCode}>
        <label htmlFor="privy-email">Email</label>
        <input
          id="privy-email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <p className="disclosure">
          Signing in creates an account with an embedded Solana wallet and may
          submit approved game transactions on your behalf.
        </p>
        {error && (
          <p role="alert" className="form-status form-status-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !email.trim() || cooldown > 0}
        >
          {busy ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleVerify}>
      <label htmlFor="privy-code">Enter the code sent to {email}</label>
      <input
        id="privy-code"
        name="code"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        autoFocus
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        placeholder="123456"
      />
      {error && (
        <p role="alert" className="form-status form-status-error">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
        {busy ? "Verifying…" : "Verify & sign in"}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => {
          setStage("email");
          setCode("");
          setError(null);
        }}
      >
        Use a different email
      </button>
    </form>
  );
}
