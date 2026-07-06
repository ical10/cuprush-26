import type { AuthAdapter, AuthEnv } from "./adapter";

const DEV_TOKEN_PREFIX = "dev:";

/**
 * Local auth stub: accepts `dev:<anything>` bearer tokens and treats the
 * suffix as the (fake) Privy user id, so the full authenticated flow runs
 * without Privy credentials. Never usable in production.
 */
const PROD_NODE_ENVS = new Set(["production", "prod", "staging"]);

export function createDevAuthAdapter(env: AuthEnv = process.env): AuthAdapter {
  // Reject every prod-ish NODE_ENV, not just the exact string "production",
  // so "Production"/"PROD"/"staging" can't slip the stub into a deployed
  // environment. NODE_ENV unset stays allowed — local `pnpm dev` doesn't set
  // it, and the real guard against accidental prod exposure is AUTH_MODE
  // defaulting to privy (this adapter only runs on an explicit AUTH_MODE=dev).
  if (PROD_NODE_ENVS.has((env.NODE_ENV ?? "").trim().toLowerCase())) {
    throw new Error(
      "Refusing to start: AUTH_MODE=dev accepts unauthenticated stub tokens " +
        "and must never run in production. Set AUTH_MODE=privy with " +
        "PRIVY_APP_ID and PRIVY_APP_SECRET.",
    );
  }

  console.warn(
    "⚠️  AUTH_MODE=dev — accepting unauthenticated `dev:<id>` stub tokens. " +
      "Local development only; never expose this server publicly.",
  );

  return {
    verifyAccessToken(token: string) {
      if (!token.startsWith(DEV_TOKEN_PREFIX)) {
        return Promise.resolve(null);
      }
      const privyUserId = token.slice(DEV_TOKEN_PREFIX.length);
      if (privyUserId.length === 0) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ privyUserId });
    },
  };
}
