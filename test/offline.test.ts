import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outdent } from "outdent";
import { afterEach, describe, expect, test } from "vitest";
import {
  grammarsOffline,
  setGrammarOffline,
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
