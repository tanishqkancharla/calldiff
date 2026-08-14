import { defineConfig } from "vitest/config";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    // Native tree-sitter addons can deadlock when many CLI processes
    // `require()` the same .node binding at once.
    maxWorkers: 1,
    fileParallelism: false,
    globalSetup: ["./test/setup-grammars.ts"],
    // Keep on-demand grammars out of the repo; reuse across test runs in this env.
    env: {
      CALLDIFF_GRAMMAR_CACHE: join(tmpdir(), "calldiff-grammar-cache"),
    },
  },
});
