import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createDevAuthAdapter } from "./auth/dev";

describe("GET /api/health", () => {
  it("responds with ok status", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = createApp({ auth: createDevAuthAdapter({}) });

    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});
