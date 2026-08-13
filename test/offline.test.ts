import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outdent } from "outdent";
import { afterEach, describe, expect, test } from "vitest";
import {
  grammarInstallArgs,
  grammarsOffline,
  setGrammarOffline,
  withInstallLock,
} from "../src/languages/grammars.js";
import { workspace } from "./workspace.js";

/**
 * `CALLDIFF_GRAMMAR_CACHE` could move where on-demand grammars are written,
 * but nothing could decline the write, so a caller that had promised its own
 * users offline operation could not adopt calldiff. The only opt-out was to
 * point the cache at an uncreatable path, which stopped the install and then
 * reported a bare `mkdir` errno naming neither the grammar nor the cause.
 */
const scratchDirs: string[] = [];

afterEach(() => {
  setGrammarOffline(undefined);
  delete process.env.CALLDIFF_OFFLINE;
  while (scratchDirs.length > 0) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
});

/** A cache path that does not exist yet, so an install shows up on disk. */
function scratchCache(): string {
  const parent = mkdtempSync(join(tmpdir(), "calldiff-offline-"));
  scratchDirs.push(parent);
  return join(parent, "grammars");
}

describe("grammarsOffline", () => {
  test("is off by default", () => {
    expect(grammarsOffline()).toBe(false);
  });

  test("reads CALLDIFF_OFFLINE", () => {
    process.env.CALLDIFF_OFFLINE = "1";
    expect(grammarsOffline()).toBe(true);
    process.env.CALLDIFF_OFFLINE = "true";
    expect(grammarsOffline()).toBe(true);
    process.env.CALLDIFF_OFFLINE = "0";
    expect(grammarsOffline()).toBe(false);
  });

  test("an explicit setting wins over the environment", () => {
    process.env.CALLDIFF_OFFLINE = "1";
    setGrammarOffline(false);
    expect(grammarsOffline()).toBe(false);
    setGrammarOffline(true);
    expect(grammarsOffline()).toBe(true);
  });

  test("clearing the setting falls back to the environment", () => {
    process.env.CALLDIFF_OFFLINE = "1";
    setGrammarOffline(false);
    setGrammarOffline(undefined);
    expect(grammarsOffline()).toBe(true);
  });
});

/**
 * The cache is only a cache if it accumulates. npm reconciles the tree against
 * the cache's package.json on every install, so `--no-save` against a
 * package.json listing nothing made each grammar prune the one before it.
 */
describe("grammarInstallArgs", () => {
  test("records the install so npm cannot prune the other grammars", () => {
    const args = grammarInstallArgs("/cache", "tree-sitter-python");
    expect(args).toContain("--save-exact");
    expect(args).not.toContain("--no-save");
  });

  test("installs into the given cache", () => {
    const args = grammarInstallArgs("/cache", "tree-sitter-c-sharp@0.23.1");
    expect(args.slice(0, 3)).toEqual(["install", "--prefix", "/cache"]);
    expect(args.at(-1)).toBe("tree-sitter-c-sharp@0.23.1");
  });
});

/**
 * npm is not safe to run concurrently against one `--prefix`. Two calldiff
 * processes installing different grammars into a shared cache collided with
 * ENOTEMPTY and half-copied package directories — which a consumer fanning
 * calldiff out across a repository hits, and which this suite hit under
 * vitest's file parallelism.
 */
describe("withInstallLock", () => {
  function lockDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "calldiff-lock-"));
    scratchDirs.push(dir);
    return dir;
  }

  test("runs the install and releases the lock", () => {
    const dir = lockDir();
    let ran = 0;
    withInstallLock(dir, () => {
      ran += 1;
      expect(existsSync(join(dir, ".install-lock"))).toBe(true);
    });
    expect(ran).toBe(1);
    expect(existsSync(join(dir, ".install-lock"))).toBe(false);
  });

  test("releases the lock when the install throws", () => {
    const dir = lockDir();
    expect(() =>
      withInstallLock(dir, () => {
        throw new Error("install blew up");
      }),
    ).toThrow("install blew up");
    expect(existsSync(join(dir, ".install-lock"))).toBe(false);
  });

  test("waits for a held lock and gives up with an actionable message", () => {
    const dir = lockDir();
    mkdirSync(join(dir, ".install-lock"));
    let ran = false;

    expect(() =>
      withInstallLock(dir, () => { ran = true; }, {
        timeoutMs: 50,
        pollMs: 5,
        staleMs: 60_000,
      }),
    ).toThrow(/timed out waiting for another calldiff process/);
    expect(ran).toBe(false);
  });

  test("reclaims a lock left behind by a dead process", () => {
    const dir = lockDir();
    const lock = join(dir, ".install-lock");
    mkdirSync(lock);
    const longAgo = new Date(Date.now() - 60 * 60_000);
    utimesSync(lock, longAgo, longAgo);

    let ran = false;
    withInstallLock(dir, () => { ran = true; }, { staleMs: 1000, pollMs: 5 });

    expect(ran).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });
});

const python = outdent`
  def sink(x):
      print(x)

  def main():
      sink(1)
`;

const ts = outdent`
  export function boot(): void {
    helper();
  }
  export function helper(): void {}
`;

describe("--offline", () => {
  test("installs nothing, and names the grammar and the way out", () => {
    const cache = scratchCache();
    const host = workspace({ "/a.py": python });

    const result = host.run("calldiff tree --entry main --offline", {
      env: { CALLDIFF_GRAMMAR_CACHE: cache },
    });

    expect(existsSync(cache)).toBe(false);
    expect(result.stderr).toContain("python");
    expect(result.stderr).toContain("tree-sitter-python");
    expect(result.stderr).toContain("--offline");
  });

  test("CALLDIFF_OFFLINE declines the install too", () => {
    const cache = scratchCache();
    const host = workspace({ "/a.py": python });

    const result = host.run("calldiff tree --entry main", {
      env: { CALLDIFF_GRAMMAR_CACHE: cache, CALLDIFF_OFFLINE: "1" },
    });

    expect(existsSync(cache)).toBe(false);
    expect(result.stderr).toContain("tree-sitter-python");
  });

  test("a mixed repo still answers for the languages it can parse", () => {
    const cache = scratchCache();
    const host = workspace({ "/a.py": python, "/b.ts": ts });

    const result = host.run("calldiff tree --entry boot --offline", {
      env: { CALLDIFF_GRAMMAR_CACHE: cache },
    });

    // Python is skipped with exactly one warning; TypeScript is a dependency
    // and answers normally. Per-file degradation, unchanged.
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("boot()");
    expect(result.stdout).toContain("helper()");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("a.py");
    expect(result.stdout).not.toContain("warn:");
    expect(existsSync(cache)).toBe(false);
  });

  test("bundled grammars are unaffected by the flag", () => {
    const host = workspace({ "/b.ts": ts });

    const offline = host.run("calldiff tree --entry boot --offline");
    const online = host.run("calldiff tree --entry boot");

    expect(offline.code).toBe(0);
    expect(offline.stdout).toBe(online.stdout);
    expect(offline.stderr).toBe("");
  });

  test("a failed install names the grammar instead of a raw errno", () => {
    const host = workspace({ "/a.py": python });

    const result = host.run("calldiff tree --entry main", {
      env: { CALLDIFF_GRAMMAR_CACHE: "/nonexistent-calldiff-cache" },
    });

    expect(result.stderr).toContain("failed to install grammar for python");
    expect(result.stderr).toContain("tree-sitter-python");
  });
});
