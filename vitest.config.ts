import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts", "node_modules/**"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.int.test.ts"],
          exclude: ["node_modules/**"],
          setupFiles: ["src/test/integration-setup.ts"],
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
