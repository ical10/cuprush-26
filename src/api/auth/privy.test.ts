import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAuthToken = vi.fn();
const privyClientConstructor = vi.fn();

vi.mock("@privy-io/server-auth", () => ({
  PrivyClient: class {
    constructor(appId: string, appSecret: string) {
      privyClientConstructor(appId, appSecret);
    }
    verifyAuthToken = verifyAuthToken;
  },
}));

import { createPrivyAuthAdapter } from "./privy";

beforeEach(() => {
  verifyAuthToken.mockReset();
  privyClientConstructor.mockReset();
});

describe("createPrivyAuthAdapter", () => {
  const env = { PRIVY_APP_ID: "app-id", PRIVY_APP_SECRET: "app-secret" };

  it("throws when PRIVY_APP_ID is missing", () => {
    expect(() =>
      createPrivyAuthAdapter({ PRIVY_APP_SECRET: "s" }),
    ).toThrow(/PRIVY_APP_ID/);
  });

  it("throws when PRIVY_APP_SECRET is missing", () => {
    expect(() => createPrivyAuthAdapter({ PRIVY_APP_ID: "a" })).toThrow(
      /PRIVY_APP_SECRET/,
    );
  });

  it("constructs the Privy client with the app credentials", () => {
    createPrivyAuthAdapter(env);
    expect(privyClientConstructor).toHaveBeenCalledWith(
      "app-id",
      "app-secret",
    );
  });

  it("returns the stable privy user id from verified claims", async () => {
    verifyAuthToken.mockResolvedValue({
      appId: "app-id",
      issuer: "privy.io",
      issuedAt: 1,
      expiration: 2,
      sessionId: "session",
      userId: "did:privy:abc123",
    });

    const adapter = createPrivyAuthAdapter(env);
    await expect(adapter.verifyAccessToken("a.b.c")).resolves.toEqual({
      privyUserId: "did:privy:abc123",
    });
    expect(verifyAuthToken).toHaveBeenCalledWith("a.b.c");
  });

  it("returns null when token verification fails", async () => {
    verifyAuthToken.mockRejectedValue(new Error("invalid auth token"));

    const adapter = createPrivyAuthAdapter(env);
    await expect(adapter.verifyAccessToken("bad-token")).resolves.toBeNull();
  });

  it("fails closed on an expired token", async () => {
    verifyAuthToken.mockRejectedValue(new Error("token is expired"));

    const adapter = createPrivyAuthAdapter(env);
    await expect(
      adapter.verifyAccessToken("expired.token.here"),
    ).resolves.toBeNull();
  });
});
