import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { resetTestDatabase, testDatabaseUrl } from "../db/test/test-db";

export default async function setup() {
  resetTestDatabase();

  const migrationClient = postgres(testDatabaseUrl(), { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
  await migrationClient.end();
}
