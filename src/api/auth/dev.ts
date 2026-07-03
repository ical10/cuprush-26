import type { AuthAdapter, AuthEnv } from "./adapter";

const DEV_TOKEN_PREFIX = "dev:";

/**
 * Local auth stub: accepts `dev:<anything>` bearer tokens and treats the
 * suffix as the (fake) Privy user id, so the full authenticated flow runs
 * without Privy credentials. Never usable in production.
 */
export function createDevAuthAdapter(env: AuthEnv = process.env): AuthAdapter {
  if (env.NODE_ENV === "production") {
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
