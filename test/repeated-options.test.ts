import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { collectRepeated, normalizeArgv } from "../src/cli.js";
import { workspace } from "./workspace.js";

/**
 * `--entry` / `--file` accept multiple values in the published schema
 * (`anyOf: string | string[]`) and in the README's usage line
 * (`-e PiService.createAgentSession -e boot`), but incur only accumulates
 * repeats for a plain `z.array` field. Against a union it overwrote, so all
 * but the last value vanished without a word.
 */
describe("collectRepeated", () => {
  test("collects repeated long and short spellings", () => {
    expect(collectRepeated(["tree", "-e", "a", "--entry", "b"])).toEqual({
      entry: ["a", "b"],
      file: [],
    });
    expect(collectRepeated(["tree", "-F", "x.ts", "--file", "y.ts"])).toEqual({
      entry: [],
      file: ["x.ts", "y.ts"],
    });
  });

  test("collects the --flag=value form", () => {
    expect(collectRepeated(["tree", "--entry=a", "--entry=b"])).toEqual({
      entry: ["a", "b"],
      file: [],
    });
  });

  test("does not mistake a flag's value for a flag", () => {
    // `-e` here is the value of `--file`, not an entry flag.
    expect(collectRepeated(["tree", "--file", "-e", "--entry", "b"])).toEqual({
      entry: ["b"],
      file: ["-e"],
    });
  });

  test("ignores a trailing flag with no value", () => {
    expect(collectRepeated(["tree", "-e"])).toEqual({ entry: [], file: [] });
  });

  test("is empty when neither flag appears", () => {
    expect(collectRepeated(["tree", "src", "--locs"])).toEqual({
      entry: [],
      file: [],
    });
  });

  test("normalizeArgv still returns argv unchanged but for lone --", () => {
    expect(normalizeArgv(["tree", "-e", "a", "--", "src"])).toEqual([
      "tree",
      "-e",
      "a",
      "src",
    ]);
  });
});

const app = outdent`
  export function boot(): void {
    start();
  }
  export function createAgentSession(): void {
    start();
  }
  function start(): void {}
`;

const other = outdent`
  export function alpha(): void {}
  export function beta(): void {}
`;

function entriesOf(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as {
    data: { trees: Array<{ entry: string }> };
  };
  return parsed.data.trees.map((t) => t.entry);
}

describe("repeated --entry / --file", () => {
  test("tree returns one tree per repeated --entry", () => {
    const host = workspace({ "/src/app.ts": app });

    const result = host.run(
      "calldiff tree -e createAgentSession -e boot --format json --full-output -- src",
    );

    expect(result.code).toBe(0);
    expect(entriesOf(result.stdout)).toEqual(["createAgentSession", "boot"]);
  });

  test("tree returns the union of every repeated --file", () => {
    const host = workspace({ "/src/app.ts": app, "/src/other.ts": other });

    const result = host.run(
      "calldiff tree -F src/app.ts -F src/other.ts --format json --full-output -- src",
    );

    expect(result.code).toBe(0);
    expect(entriesOf(result.stdout)).toEqual([
      "boot",
      "createAgentSession",
      "alpha",
      "beta",
    ]);
  });

  test("a single --entry is unchanged", () => {
    const host = workspace({ "/src/app.ts": app });

    const result = host.run(
      "calldiff tree -e boot --format json --full-output -- src",
    );

    expect(result.code).toBe(0);
    expect(entriesOf(result.stdout)).toEqual(["boot"]);
  });

  test("reach walks every repeated --entry", () => {
    const host = workspace({ "/src/app.ts": app });

    const result = host.run(
      "calldiff reach -e createAgentSession -e boot --to start -- src",
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("createAgentSession()");
    expect(result.stdout).toContain("boot()");
  });

  test("diff honours the README's two-entrypoint usage", () => {
    const host = workspace();
    const before = host.commit("before", {
      "/src/app.ts": outdent`
        export function boot(): void {}
        export function createAgentSession(): void {}
      `,
    });
    const after = host.commit("after", { "/src/app.ts": app });

    const result = host.run(
      `calldiff diff ${before} ${after} -e createAgentSession -e boot --format json --full-output -- src`,
    );

    expect(result.code).toBe(0);
    expect(entriesOf(result.stdout)).toEqual(["createAgentSession", "boot"]);
  });
});
