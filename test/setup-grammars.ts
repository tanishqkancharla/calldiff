import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFunctions } from "../src/extract.js";
import { extractors } from "../src/languages/registry.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Compile the CLI and install on-demand grammars once before the suite.
 * Tests spawn `node dist/cli.js` against a shared CALLDIFF_GRAMMAR_CACHE.
 */
export default function setup(): void {
  process.env.CALLDIFF_GRAMMAR_CACHE ??= join(
    tmpdir(),
    "calldiff-grammar-cache",
  );
  execFileSync("npx", ["tsc"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  for (const extractor of extractors) {
    const ext = extractor.extensions[0];
    if (!ext) continue;
    try {
      extractFunctions(`warmup${ext}`, "\n");
    } catch {
      // Empty source may not parse; the grammar load is what matters.
    }
  }
}
