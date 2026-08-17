import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    // Separate processes so each worker can load its own grammar cache copy.
    pool: "forks",
    setupFiles: ["./test/setup-worker.ts"],
  },
});
