import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("GET /api/health (integration)", () => {
  it("responds with ok status when the app is wired against a real environment", async () => {
    const app = createApp();

    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});
