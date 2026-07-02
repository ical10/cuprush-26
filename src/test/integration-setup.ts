import { afterAll, beforeAll } from "vitest";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required to run integration tests. Copy .env.example to .env and point it at a local Postgres database.",
  );
}

const sql = postgres(databaseUrl, { max: 1 });

beforeAll(async () => {
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end();
});
