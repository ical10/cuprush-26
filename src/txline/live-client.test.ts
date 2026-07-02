import { describe, expect, it } from "vitest";
import { readLiveConfig } from "./live-client";

describe("readLiveConfig", () => {
  it("reads TXLINE_BASE_URL and TXLINE_API_KEY from the given env", () => {
    const config = readLiveConfig({
      TXLINE_BASE_URL: "https://txline.example.com",
      TXLINE_API_KEY: "secret",
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({ baseUrl: "https://txline.example.com", apiKey: "secret" });
  });

  it("throws when TXLINE_BASE_URL is missing", () => {
    expect(() =>
      readLiveConfig({ TXLINE_API_KEY: "secret" } as NodeJS.ProcessEnv),
    ).toThrow(/TXLINE_BASE_URL/);
  });

  it("throws when TXLINE_API_KEY is missing", () => {
    expect(() =>
      readLiveConfig({ TXLINE_BASE_URL: "https://txline.example.com" } as NodeJS.ProcessEnv),
    ).toThrow(/TXLINE_API_KEY/);
  });
});
