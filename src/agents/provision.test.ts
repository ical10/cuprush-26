import { describe, expect, it } from "vitest";
import {
  createPrivyWalletCreator,
  deriveIdempotencyKey,
  resolveProvisionEnv,
} from "./provision";

describe("resolveProvisionEnv", () => {
  it("prefers RAILWAY_ENVIRONMENT_NAME", () => {
    expect(
      resolveProvisionEnv({
        RAILWAY_ENVIRONMENT_NAME: "production",
        NODE_ENV: "development",
      }),
    ).toBe("production");
  });

  it("falls back to NODE_ENV", () => {
    expect(resolveProvisionEnv({ NODE_ENV: "staging" })).toBe("staging");
  });

  it("defaults to dev when nothing is set", () => {
    expect(resolveProvisionEnv({})).toBe("dev");
  });
});

describe("deriveIdempotencyKey", () => {
  it("namespaces the agent key by environment", () => {
    expect(deriveIdempotencyKey("production", "form-hawk")).toBe(
      "hilo-production-form-hawk",
    );
    expect(deriveIdempotencyKey("dev", "chaos-goblin")).toBe(
      "hilo-dev-chaos-goblin",
    );
  });
});

describe("createPrivyWalletCreator", () => {
  const fullEnv = {
    PRIVY_APP_ID: "app-id",
    PRIVY_APP_SECRET: "app-secret",
    PRIVY_AUTHORIZATION_KEY: "auth-key",
  };

  it("fails closed listing every missing variable", () => {
    expect(() => createPrivyWalletCreator({})).toThrow(/PRIVY_APP_ID/);
    expect(() => createPrivyWalletCreator({})).toThrow(/PRIVY_APP_SECRET/);
    expect(() => createPrivyWalletCreator({})).toThrow(
      /PRIVY_AUTHORIZATION_KEY/,
    );
  });

  it("fails closed when only the authorization key is missing", () => {
    expect(() =>
      createPrivyWalletCreator({
        PRIVY_APP_ID: "app-id",
        PRIVY_APP_SECRET: "app-secret",
      }),
    ).toThrow(/PRIVY_AUTHORIZATION_KEY/);
  });

  it("passes its own credentials guard when all variables are present", () => {
    // With every variable set, control reaches Privy's client construction,
    // which then rejects the dummy key — proving our guard did not fire.
    expect(() => createPrivyWalletCreator(fullEnv)).toThrow(
      /wallet authorization private key/i,
    );
  });
});
