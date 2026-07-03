import { PrivyClient } from "@privy-io/server-auth";
import type { AuthAdapter, AuthEnv } from "./adapter";

/**
 * Live adapter: verifies Privy access tokens (signature + claims) via
 * @privy-io/server-auth and extracts the stable Privy user id. The raw
 * token is never logged or stored.
 */
export function createPrivyAuthAdapter(
  env: AuthEnv = process.env,
): AuthAdapter {
  const { PRIVY_APP_ID: appId, PRIVY_APP_SECRET: appSecret } = env;
  if (!appId) {
    throw new Error("AUTH_MODE=privy requires PRIVY_APP_ID.");
  }
  if (!appSecret) {
    throw new Error("AUTH_MODE=privy requires PRIVY_APP_SECRET.");
  }

  const client = new PrivyClient(appId, appSecret);

  return {
    async verifyAccessToken(token: string) {
      try {
        const claims = await client.verifyAuthToken(token);
        return { privyUserId: claims.userId };
      } catch {
        // Expired, malformed, or wrong-app tokens all map to a uniform 401.
        return null;
      }
    },
  };
}
