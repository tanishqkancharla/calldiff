import { describe, expect, test } from "vitest";
import { cli, normalizeArgv } from "../src/cli.js";

async function invoke(
  argv: string[],
): Promise<{ stdout: string; code: number | undefined }> {
  let stdout = "";
  let code: number | undefined;
  await cli.serve(normalizeArgv(argv), {
    stdout: (s) => {
      stdout += s;
    },
    exit: (c) => {
      code = c;
    },
  });
  return { stdout, code };
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
    expect(normalizeArgv(["show", "-e", "boot"])).toEqual([
      "show",
      "-e",
      "boot",
    ]);
  });
});

describe("calldiff CLI (incur)", () => {
  test("--help exits successfully and mentions show", async () => {
    const { stdout, code } = await invoke(["--help"]);
    expect(code === undefined || code === 0).toBe(true);
    expect(stdout).toMatch(/calldiff/);
    expect(stdout).toMatch(/show/);
    expect(stdout).toMatch(/--entry/);
  });

  test("--llms prints agent manifest", async () => {
    const { stdout, code } = await invoke(["--llms"]);
    expect(code === undefined || code === 0).toBe(true);
    expect(stdout).toMatch(/calldiff/);
    expect(stdout).toMatch(/show/);
  });

  test("show without --entry fails", async () => {
    const { stdout, code } = await invoke(["show"]);
    expect(code).toBeTruthy();
    expect(code).toBeGreaterThan(0);
    expect(stdout.length + code!).toBeGreaterThan(0);
  });

  test("unknown flag fails", async () => {
    const { code } = await invoke(["--not-a-real-flag"]);
    expect(code).toBeTruthy();
    expect(code).toBeGreaterThan(0);
  });
});
