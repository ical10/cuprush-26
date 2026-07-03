/**
 * STUB BOUNDARY — pending real Privy credentials (PRD "Delivery
 * constraints": no Privy credentials yet).
 *
 * `@privy-io/react-auth` was attempted (`pnpm add @privy-io/react-auth`)
 * and installs, but its dependency tree (wagmi/@reown/@walletconnect's EVM
 * stack, @solana/kit) drags in peer conflicts against this app's actual
 * versions — React 19 vs several deps' React 18 peer range, Zod 4 vs
 * abitype's Zod 3 peer, and a TypeScript major mismatch across
 * @solana/* packages. Wiring it now risks the build and bundles a large
 * EVM/wallet stack this PoC never uses (Solana-only, sponsored fees).
 * Given no working credentials exist yet to validate the integration
 * against anyway, this module documents the intended shape instead, so
 * swapping in the real provider is a contained, one-file change once
 * credentials land and the peer set can be revisited.
 *
 * Intended wiring, once unblocked:
 *   <PrivyProvider appId={PRIVY_APP_ID} config={{ loginMethods: ["email"],
 *     embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } } }}>
 *     <App />
 *   </PrivyProvider>
 * On wallet creation: POST /api/wallet with the new embedded address.
 * On login: exchange the Privy access token for API calls (the backend's
 * AUTH_MODE=privy adapter already verifies it — src/api/auth/privy.ts).
 */
import { useAuth } from "./auth-context";

export function PrivyAuthStub({ onDone }: { onDone(): void }) {
  const { login } = useAuth();

  const handleClick = () => {
    // Demo-only placeholder token so the flow is exercisable before real
    // Privy credentials exist; never used when AUTH_MODE=privy on the server.
    login("dev:privy-stub-user");
    onDone();
  };

  return (
    <div className="auth-form">
      <p>
        Privy email sign-in is not wired yet — this build is waiting on
        Privy app credentials.
      </p>
      <p className="disclosure">
        Locked on Solana. Signing in creates an embedded wallet and may
        submit approved game transactions on your behalf.
      </p>
      <button type="button" className="btn btn-primary" onClick={handleClick}>
        Continue (stub)
      </button>
    </div>
  );
}
