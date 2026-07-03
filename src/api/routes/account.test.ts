import { describe, expect, it } from "vitest";
import { patchMeSchema, walletSchema } from "./account";

describe("patchMeSchema", () => {
  it("accepts a plain display name", () => {
    const result = patchMeSchema.safeParse({ displayName: "Husni" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.displayName).toBe("Husni");
  });

  it("trims surrounding whitespace before validating", () => {
    const result = patchMeSchema.safeParse({ displayName: "  Husni  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.displayName).toBe("Husni");
  });

  it("rejects an empty display name", () => {
    expect(patchMeSchema.safeParse({ displayName: "" }).success).toBe(false);
  });

  it("rejects a whitespace-only display name", () => {
    expect(patchMeSchema.safeParse({ displayName: "   " }).success).toBe(
      false,
    );
  });

  it("accepts exactly 32 characters", () => {
    expect(
      patchMeSchema.safeParse({ displayName: "a".repeat(32) }).success,
    ).toBe(true);
  });

  it("rejects 33 characters", () => {
    expect(
      patchMeSchema.safeParse({ displayName: "a".repeat(33) }).success,
    ).toBe(false);
  });

  it("rejects a missing display name", () => {
    expect(patchMeSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields so only displayName is writable", () => {
    expect(
      patchMeSchema.safeParse({ displayName: "ok", points: 999 }).success,
    ).toBe(false);
  });
});

describe("walletSchema", () => {
  it("accepts a base58 Solana address", () => {
    expect(
      walletSchema.safeParse({
        address: "4Nd1mYQFuLVMYq3VLC7hRqHqXHbTbSHFF3P2FLjSnZbF",
      }).success,
    ).toBe(true);
  });

  it("rejects addresses shorter than 32 characters", () => {
    expect(
      walletSchema.safeParse({ address: "4Nd1mYQFuLVMYq3VLC7hRqHqXHbTbSH" })
        .success,
    ).toBe(false);
  });

  it("rejects addresses longer than 44 characters", () => {
    expect(
      walletSchema.safeParse({ address: "1".repeat(45) }).success,
    ).toBe(false);
  });

  it("rejects non-base58 characters (0, O, I, l)", () => {
    expect(
      walletSchema.safeParse({ address: "0OIl".repeat(10) }).success,
    ).toBe(false);
  });

  it("rejects a missing address", () => {
    expect(walletSchema.safeParse({}).success).toBe(false);
  });
});
