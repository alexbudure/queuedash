import { defineConfig } from "vitest/config";

/**
 * Each adapter serves more than one major of its queue library. The package
 * compiles against the newest; the older ones are installed under npm aliases,
 * and pointing the bare specifier at an alias runs the same suite against that
 * major.
 */
const olderMajorAliases = {
  ...(process.env.BULLMQ_MAJOR === "5" ? { bullmq: "bullmq-v5" } : {}),
  ...(process.env.BEE_MAJOR === "1" ? { "bee-queue": "bee-queue-v1" } : {}),
};

export default defineConfig({
  resolve: {
    alias: olderMajorAliases,
  },
  test: {
    globals: true,
    // GroupMQ's Redis operations intentionally poll in one-second intervals.
    // Concurrent adapter suites can occasionally exceed Vitest's 5s default.
    testTimeout: process.env.QUEUE_TYPE === "groupmq" ? 10_000 : 5_000,
  },
});
