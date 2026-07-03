import type { MiddlewareHandler } from "hono";
import type { Database } from "../../db/client";
import type { AuthAdapter } from "./adapter";
import { loadOrProvisionUser, type AuthedIdentity } from "./provision";

export type AuthVariables = {
  participant: AuthedIdentity["participant"];
  user: AuthedIdentity["user"];
};

export type AuthEnvBindings = { Variables: AuthVariables };

export type DbProvider = () => Database | Promise<Database>;

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(" ");
  if (scheme !== "Bearer" || !token || rest.length > 0) return null;
  return token;
}

/**
 * Verifies the bearer access token on every request it guards and sets the
 * `participant` and `user` context vars from the token — the caller's
 * identity is always derived here, never from the request body. First
 * authenticated request provisions both rows.
 */
export function createAuthMiddleware(
  auth: AuthAdapter,
  getDb: DbProvider,
): MiddlewareHandler<AuthEnvBindings> {
  return async (c, next) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const verified = await auth.verifyAccessToken(token);
    if (!verified) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const db = await getDb();
    const { participant, user } = await loadOrProvisionUser(
      db,
      verified.privyUserId,
    );
    c.set("participant", participant);
    c.set("user", user);

    await next();
  };
}
