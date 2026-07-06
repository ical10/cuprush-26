import { createDevAuthAdapter } from "./dev";
import { createPrivyAuthAdapter } from "./privy";

export type VerifiedAuth = {
  /** Stable Privy user id ("did:privy:..." in live mode). */
  privyUserId: string;
};

/**
 * Verifies a bearer access token and yields the caller's stable identity.
 * Returns null for any token that does not verify — never throws for a bad
 * token, so the middleware can map every failure to a uniform 401.
 */
export type AuthAdapter = {
  verifyAccessToken(token: string): Promise<VerifiedAuth | null>;
};

export type AuthEnv = {
  AUTH_MODE?: string;
  NODE_ENV?: string;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
};

/**
 * AUTH_MODE=privy (the default) verifies real Privy access tokens;
 * AUTH_MODE=dev must be set explicitly and accepts local `dev:<id>` stub
 * tokens. Defaulting to privy makes a deploy that forgets AUTH_MODE fail
 * closed — the privy adapter throws without credentials — instead of
 * silently booting the unauthenticated stub.
 */
export function createAuthAdapterFromEnv(
  env: AuthEnv = process.env,
): AuthAdapter {
  const mode = env.AUTH_MODE ?? "privy";
  switch (mode) {
    case "privy":
      return createPrivyAuthAdapter(env);
    case "dev":
      return createDevAuthAdapter(env);
    default:
      throw new Error(
        `Unknown AUTH_MODE "${mode}" — expected "privy" or "dev".`,
      );
  }
}
