import { execFileSync } from "node:child_process";

export const TEST_DB_NAME = "worldcup_hilo_test";

function baseDatabaseUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is required to run database integration tests.");
  }
  return new URL(raw);
}

export function testDatabaseUrl(): string {
  const url = baseDatabaseUrl();
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

/** Drops and recreates the local integration test database via psql tooling. */
export function resetTestDatabase(): void {
  execFileSync("dropdb", ["--if-exists", TEST_DB_NAME]);
  execFileSync("createdb", [TEST_DB_NAME]);
}
