import { afterAll, describe, expect, it, vi } from "vitest";

const { drizzleMock, postgresMock } = vi.hoisted(() => ({
  drizzleMock: vi.fn(() => ({})),
  postgresMock: vi.fn(() => ({})),
}));

vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));
vi.mock("postgres", () => ({ default: postgresMock }));

const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = "postgresql://localhost:5432/cuprush_client_test";

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("database client", () => {
  it("closes idle Postgres connections after 60 seconds", async () => {
    await import("./client");

    expect(postgresMock).toHaveBeenCalledWith(process.env.DATABASE_URL, {
      idle_timeout: 60,
    });
  });
});
