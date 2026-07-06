import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevAuthAdapter } from "./dev";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDevAuthAdapter", () => {
  it("logs a loud warning on creation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createDevAuthAdapter({});
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.join(" ")).toMatch(/dev/i);
  });

  it("refuses to start when NODE_ENV=production", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => createDevAuthAdapter({ NODE_ENV: "production" })).toThrow(
      /production/i,
    );
  });

  it.each(["Production", "PRODUCTION", " prod ", "staging"])(
    "refuses to start for prod-ish NODE_ENV %j",
    (nodeEnv) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => createDevAuthAdapter({ NODE_ENV: nodeEnv })).toThrow(
        /production/i,
      );
    },
  );

  it("still starts when NODE_ENV is unset (local dev)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => createDevAuthAdapter({})).not.toThrow();
  });

  describe("verifyAccessToken", () => {
    function adapter() {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      return createDevAuthAdapter({});
    }

    it("accepts a dev:<suffix> token and uses the suffix as the privy user id", async () => {
      await expect(adapter().verifyAccessToken("dev:alice")).resolves.toEqual({
        privyUserId: "alice",
      });
    });

    it("keeps colons inside the suffix", async () => {
      await expect(
        adapter().verifyAccessToken("dev:did:privy:abc123"),
      ).resolves.toEqual({ privyUserId: "did:privy:abc123" });
    });

    it("rejects a token without the dev: prefix", async () => {
      await expect(adapter().verifyAccessToken("alice")).resolves.toBeNull();
    });

    it("rejects a dev: token with an empty suffix", async () => {
      await expect(adapter().verifyAccessToken("dev:")).resolves.toBeNull();
    });

    it("rejects an empty token", async () => {
      await expect(adapter().verifyAccessToken("")).resolves.toBeNull();
    });
  });
});
