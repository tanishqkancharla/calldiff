import { defineConfig } from "vitest/config";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    // Parallel CLI processes `require()`ing the same tree-sitter .node hang
    // (swift/kotlin/perl/haskell/elixir/zig e2e files run together).
    maxWorkers: 1,
    fileParallelism: false,
    // Keep on-demand grammars out of the repo; reuse across test runs in this env.
    env: {
      CALLDIFF_GRAMMAR_CACHE: join(tmpdir(), "calldiff-grammar-cache"),
    },
  },
});
