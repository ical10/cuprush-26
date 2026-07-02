import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationClient = postgres(databaseUrl, { max: 1 });

await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
await migrationClient.end();

console.log("Migrations applied.");
