import { afterEach, describe, expect, it, vi } from "vitest";

const verifyAuthToken = vi.fn();

vi.mock("@privy-io/server-auth", () => ({
  PrivyClient: class {
    verifyAuthToken = verifyAuthToken;
  },
}));

import { createAuthAdapterFromEnv } from "./adapter";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuthAdapterFromEnv", () => {
  it("defaults to the dev adapter when AUTH_MODE is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createAuthAdapterFromEnv({});
    expect(warn).toHaveBeenCalled();
    await expect(adapter.verifyAccessToken("dev:someone")).resolves.toEqual({
      privyUserId: "someone",
    });
  });

  it("selects the privy adapter when AUTH_MODE=privy", async () => {
    verifyAuthToken.mockResolvedValue({ userId: "did:privy:xyz" });
    const adapter = createAuthAdapterFromEnv({
      AUTH_MODE: "privy",
      PRIVY_APP_ID: "app-id",
      PRIVY_APP_SECRET: "app-secret",
    });
    await expect(adapter.verifyAccessToken("a.b.c")).resolves.toEqual({
      privyUserId: "did:privy:xyz",
    });
    expect(verifyAuthToken).toHaveBeenCalledWith("a.b.c");
  });

  it("rejects an unknown AUTH_MODE", () => {
    expect(() => createAuthAdapterFromEnv({ AUTH_MODE: "magic" })).toThrow(
      /AUTH_MODE/,
    );
  });

  it("refuses dev mode in production", () => {
    expect(() =>
      createAuthAdapterFromEnv({ AUTH_MODE: "dev", NODE_ENV: "production" }),
    ).toThrow(/production/i);
  });
});
