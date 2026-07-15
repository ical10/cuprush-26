import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import type {
  LinkedAccountWithMetadata,
  WalletWithMetadata,
} from "@privy-io/react-auth";
import { AuthContext } from "./auth-context";
import type { AuthContextValue } from "./auth-context";
import { saveWalletAddress, setAuthTokenProvider } from "../lib/api";

/** The user's embedded Solana wallet (Privy-created), if it exists yet. */
function embeddedSolanaAddress(
  linkedAccounts: readonly LinkedAccountWithMetadata[] | undefined,
): string | null {
  const wallet = linkedAccounts?.find(
    (a): a is WalletWithMetadata =>
      a.type === "wallet" &&
      a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2"),
  );
  return wallet?.address ?? null;
}

/**
 * Real Privy auth (AUTH_MODE/VITE_AUTH_MODE=privy). Passwordless email OTP +
 * an embedded Solana wallet auto-created on first login. The backend already
 * verifies Privy access tokens (src/api/auth/privy.ts) and keys each user on
 * the stable did:privy id, so this side only has to: (1) route API calls
 * through Privy's short-lived access token, (2) mirror Privy's session into
 * the app's AuthContext, and (3) persist the embedded wallet address once it
 * exists.
 */
function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();

  const authRef = useRef({ authenticated, getAccessToken });
  authRef.current = { authenticated, getAccessToken };

  // Registered during render (not an effect) so the provider exists before any
  // child effect can fire a request; reads through the ref so it never goes stale.
  useMemo(() => {
    setAuthTokenProvider(async () => {
      const auth = authRef.current;
      if (!auth.authenticated) return null;
      try {
        return await auth.getAccessToken();
      } catch (error) {
        console.error("failed to get Privy access token", error);
        return null;
      }
    });
  }, []);

  // The embedded Solana wallet is created asynchronously after login, so watch
  // user.linkedAccounts rather than reading it inline at the login call site.
  // saveWalletAddress is first-write-wins server-side, so re-posting the same
  // address is a no-op.
  const solanaAddress = embeddedSolanaAddress(user?.linkedAccounts);
  useEffect(() => {
    if (!authenticated || !solanaAddress) return;
    void saveWalletAddress(solanaAddress).catch((error) => {
      console.error("failed to save wallet address", error);
    });
  }, [authenticated, solanaAddress]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: authenticated,
      // Email OTP drives Privy directly (see privy-email-login.tsx); there is
      // no app-managed token to set here.
      login: () => {},
      logout: () => {
        void logout();
      },
    }),
    [authenticated, logout],
  );

  // Hold render until Privy has restored any existing session, so a returning
  // user isn't flashed as signed-out on reload.
  if (!ready) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
  if (!appId) {
    throw new Error(
      "VITE_PRIVY_APP_ID is not set but VITE_AUTH_MODE=privy — the client cannot start Privy without an app id.",
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
