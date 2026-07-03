import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts", "node_modules/**", "src/web/**"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/web/**/*.test.{ts,tsx}"],
          setupFiles: ["src/web/test/setup.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.int.test.ts"],
          exclude: ["node_modules/**"],
          globalSetup: ["src/test/db-global-setup.ts"],
          setupFiles: ["src/test/integration-setup.ts"],
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
