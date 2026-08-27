import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // GroupMQ's Redis operations intentionally poll in one-second intervals.
    // Concurrent adapter suites can occasionally exceed Vitest's 5s default.
    testTimeout: process.env.QUEUE_TYPE === "groupmq" ? 10_000 : 5_000,
  },
});
