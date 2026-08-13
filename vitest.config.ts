import { defineConfig } from "vitest/config";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Keep on-demand grammars out of the repo; reuse across test runs in this env.
    env: {
      CALLDIFF_GRAMMAR_CACHE: join(tmpdir(), "calldiff-grammar-cache"),
    },
    // On a cold cache the first test per language installs and natively builds
    // a grammar, and those installs serialize on the cache lock, so a worker
    // can legitimately wait several minutes. Matches the lock's own timeout.
    // Warm runs are unaffected: the whole suite takes a few seconds.
    testTimeout: 15 * 60_000,
  },
});
