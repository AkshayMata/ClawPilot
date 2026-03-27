import { defineConfig } from "vitest/config";

/**
 * Root vitest config — designed for maximum parallelism:
 *
 * 1. All test files run in parallel worker threads (default pool)
 * 2. Tests WITHIN each file marked `concurrent` also run in parallel
 * 3. Each test creates fresh instances — zero shared state between tests
 * 4. fileParallelism: true ensures files across all packages run concurrently
 */
export default defineConfig({
  test: {
    /* Run from repo root, discover tests in all packages */
    include: ["packages/*/src/**/*.test.ts"],

    /* Worker-thread pool — fastest for pure-logic tests */
    pool: "threads",

    /* Files run in parallel (default, but explicit for clarity) */
    fileParallelism: true,

    /* 10s timeout per test — fail fast */
    testTimeout: 10_000,

    /* Reporter: concise for CI, verbose for local */
    reporters: process.env.CI ? ["default"] : ["verbose"],
  },
});
