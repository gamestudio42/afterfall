import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/index.ts", "packages/core/src/state.ts"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 68,
        branches: 68,
        functions: 68,
        lines: 68,
      },
    },
  },
});
