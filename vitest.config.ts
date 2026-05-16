import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globals: true,
  },
  coverage: {
    provider: "v8",
    include: ["src/**/*.ts"],
    exclude: ["src/types-global.d.ts"],
    thresholds: {
      statements: 40,
      branches: 30,
      functions: 30,
      lines: 40,
    },
  },
});
