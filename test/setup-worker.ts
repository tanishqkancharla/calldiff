import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Each Vitest pool worker (and the CLI processes it spawns) gets its own
 * grammar cache. Tests in one file still share that worker's cache.
 *
 * A single shared cache made parallel `npm install --prefix` unpack into the
 * same node_modules (ENOTEMPTY) and parallel `require()` of one tree-sitter
 * `.node` hang. Per-test dirs would reinstall grammars on every case.
 */
const worker = process.env.VITEST_POOL_ID ?? String(process.pid);
const dir = join(tmpdir(), "calldiff-grammar-cache", `worker-${worker}`);
mkdirSync(dir, { recursive: true });
process.env.CALLDIFF_GRAMMAR_CACHE = dir;
