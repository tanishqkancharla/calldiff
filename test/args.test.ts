import { describe, expect, test } from "vitest";
import {
  cli,
  hasTokenFlag,
  normalizeArgv,
  wrapCliStdout,
} from "../src/cli.js";

async function invoke(
  argv: string[],
): Promise<{ stdout: string; stderr: string; code: number | undefined }> {
  let stdout = "";
  let stderr = "";
  let code: number | undefined;
  // The default ASCII path writes to process.stdout itself, so capture both
  // that and incur's injected writer. Failures go to stderr (see wrapCliStdout).
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await cli.serve(normalizeArgv(argv), {
      stdout: wrapCliStdout((s) => {
        stdout += s;
      }),
      exit: (c) => {
        code = c;
      },
    });
  } finally {
    process.stdout.write = realStdoutWrite;
    process.stderr.write = realStderrWrite;
  }
  return { stdout, stderr, code };
}

describe("normalizeArgv", () => {
  test("strips lone -- separators", () => {
    expect(normalizeArgv(["main", "feature", "--", "src"])).toEqual([
      "main",
      "feature",
      "src",
    ]);
  });

  test("leaves other tokens alone", () => {
    expect(normalizeArgv(["tree", "-e", "boot"])).toEqual([
      "tree",
      "-e",
      "boot",
    ]);
  });
});

describe("hasTokenFlag", () => {
  test("detects each token flag", () => {
    expect(hasTokenFlag(["tree", "--token-count"])).toBe(true);
    expect(hasTokenFlag(["tree", "--token-limit", "50"])).toBe(true);
    expect(hasTokenFlag(["tree", "--token-offset", "10"])).toBe(true);
  });

  test("detects the --flag=value form", () => {
    expect(hasTokenFlag(["tree", "--token-limit=50"])).toBe(true);
  });

  test("is false without one", () => {
    expect(hasTokenFlag(["tree", "-e", "boot"])).toBe(false);
    expect(hasTokenFlag(["diff", "--max-depth", "3"])).toBe(false);
  });
});

// Regression: these incur globals act on a command's return value, so the
// ASCII fast path used to swallow them — `--token-limit` printed everything
// and `--token-count` reported 0.
describe("token flags in default ASCII mode", () => {
  const entry = ["tree", "--entry", "buildCallTree"];

  test("--token-count reports a real count", async () => {
    const { stdout } = await invoke([...entry, "--token-count"]);
    const count = Number(stdout.trim());
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThan(0);
  });

  test("--token-limit actually truncates", async () => {
    const full = await invoke(entry);
    const limited = await invoke([...entry, "--token-limit", "20"]);
    expect(limited.stdout).toMatch(/truncated: showing tokens/);
    expect(limited.stdout.length).toBeLessThan(full.stdout.length);
  });

  test("output is unchanged without the flags", async () => {
    const { stdout } = await invoke(entry);
    expect(stdout).toMatch(/buildCallTree/);
    expect(stdout).not.toMatch(/truncated: showing tokens/);
  });
});

describe("calldiff CLI (incur)", () => {
  test("--help exits successfully and mentions subcommands", async () => {
    const { stdout, code } = await invoke(["--help"]);
    expect(code === undefined || code === 0).toBe(true);
    expect(stdout).toMatch(/calldiff/);
    expect(stdout).toMatch(/diff/);
    expect(stdout).toMatch(/tree/);
    expect(stdout).toMatch(/reach/);
  });

  test("--llms prints agent manifest", async () => {
    const { stdout, code } = await invoke(["--llms"]);
    expect(code === undefined || code === 0).toBe(true);
    expect(stdout).toMatch(/calldiff/);
    expect(stdout).toMatch(/tree/);
    expect(stdout).toMatch(/reach/);
  });

  test("tree without --entry fails", async () => {
    const { code } = await invoke(["tree"]);
    expect(code).toBeTruthy();
    expect(code).toBeGreaterThan(0);
  });

  test("reach without --to fails", async () => {
    const { code } = await invoke(["reach", "-e", "boot"]);
    expect(code).toBeTruthy();
    expect(code).toBeGreaterThan(0);
  });

  test("missing entrypoint failure goes to stderr", async () => {
    const { stdout, stderr, code } = await invoke([
      "tree",
      "-e",
      "noSuchSymbolAnywhere",
    ]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/TREE_FAILED/);
    expect(stderr).toMatch(/Entrypoint not found/);
  });

  test("unknown flag fails", async () => {
    const { code } = await invoke(["--not-a-real-flag"]);
    expect(code).toBeTruthy();
    expect(code).toBeGreaterThan(0);
  });
});
