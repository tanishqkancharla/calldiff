import { describe, expect, test } from "vitest";
import { outdent } from "outdent";
import {
  classifyEntrypoint,
  matchEntrypointFiles,
  resolveFileEntrypoints,
} from "../src/calltree.js";
import { buildIndex } from "../src/extract.js";
import { inferEntries } from "../src/infer.js";
import type { FunctionInfo } from "../src/types.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

function fn(
  key: string,
  file: string,
  calls: string[] = [],
  exported = true,
): FunctionInfo {
  return {
    key,
    label: `${key}()`,
    file,
    steps: calls.map((call) => ({ type: "call", key: call })),
    exported,
    start: 0,
    end: 1,
  };
}

describe("entrypoint classification", () => {
  test("classifies by indexed file lookup, not string shape", () => {
    const index = buildIndex([
      fn("boot", "src/boot.ts", ["run"], true),
      fn("run", "src/boot.ts", [], false),
    ]);

    expect(classifyEntrypoint("src/boot.ts", index)).toEqual({
      kind: "file",
      file: "src/boot.ts",
    });
    expect(classifyEntrypoint("boot.ts", index)).toEqual({
      kind: "file",
      file: "src/boot.ts",
    });
    expect(classifyEntrypoint("boot", index)).toEqual({
      kind: "symbol",
      key: "boot",
    });
  });

  test("path-shaped strings that are not indexed stay symbols / not-found", () => {
    const index = buildIndex([fn("boot", "src/boot.ts", [], true)]);

    expect(classifyEntrypoint("boot", index).kind).toBe("symbol");
    expect(() => classifyEntrypoint("src/missing.ts", index)).toThrow(
      /Entrypoint not found/,
    );
    expect(() => classifyEntrypoint("packages/api/src/routes.ts", index)).toThrow(
      /Entrypoint not found/,
    );
  });
});

describe("file entrypoint matching", () => {
  test("prefers exact paths then unique suffixes", () => {
    expect(
      matchEntrypointFiles("src/routes.ts", [
        "src/routes.ts",
        "packages/api/src/routes.ts",
      ]),
    ).toEqual(["src/routes.ts"]);

    expect(
      matchEntrypointFiles("routes.ts", [
        "packages/api/src/routes.ts",
      ]),
    ).toEqual(["packages/api/src/routes.ts"]);
  });

  test("lists every ambiguous suffix match", () => {
    expect(
      matchEntrypointFiles("routes.ts", [
        "packages/a/src/routes.ts",
        "packages/b/src/routes.ts",
      ]),
    ).toEqual(["packages/a/src/routes.ts", "packages/b/src/routes.ts"]);
  });

  test("resolveFileEntrypoints returns exported defs only", () => {
    const index = buildIndex([
      fn("boot", "src/boot.ts", ["run"], true),
      fn("run", "src/boot.ts", [], false),
      fn("other", "src/other.ts", [], true),
    ]);

    expect(resolveFileEntrypoints("boot.ts", index).map((i) => i.key)).toEqual([
      "boot",
    ]);
  });

  test("resolveFileEntrypoints rejects ambiguous paths", () => {
    const index = buildIndex([
      fn("boot", "packages/a/src/boot.ts", [], true),
      fn("boot", "packages/b/src/boot.ts", [], true),
    ]);

    expect(() => resolveFileEntrypoints("boot.ts", index)).toThrow(
      /Ambiguous entrypoint file/,
    );
  });
});

describe("inferEntries with file paths", () => {
  test("expands a file path to exported keys", () => {
    const before = buildIndex([
      fn("boot", "src/boot.ts", ["old"], true),
      fn("helper", "src/boot.ts", [], false),
    ]);
    const after = buildIndex([
      fn("boot", "src/boot.ts", ["new"], true),
      fn("helper", "src/boot.ts", [], false),
    ]);

    expect(inferEntries(before, after, ["src/boot.ts"], 12)).toEqual(["boot"]);
  });
});

describe("CLI file entrypoints", () => {
  test("tree -e <file> expands exported symbols in that file", () => {
    const host = workspace({
      "/packages/api/src/boot.ts": src`
        export function boot() {
          run();
        }
        function run() {}
        export function ready() {
          ping();
        }
        function ping() {}
      `,
      "/packages/api/src/other.ts": src`
        export function decoy() {
          boom();
        }
        function boom() {}
      `,
    });

    const result = host.run("calldiff tree -e packages/api/src/boot.ts");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("boot()");
    expect(result.stdout).toContain("run()");
    expect(result.stdout).toContain("ready()");
    expect(result.stdout).toContain("ping()");
    expect(result.stdout).not.toContain("decoy()");
  });

  test("tree -e pins to the file when the same name exists elsewhere", () => {
    const host = workspace({
      "/packages/a/src/flow.ts": src`
        export function start() {
          fromA();
        }
        function fromA() {}
      `,
      "/packages/b/src/flow.ts": src`
        export function start() {
          fromB();
        }
        function fromB() {}
      `,
    });

    const result = host.run("calldiff tree -e packages/b/src/flow.ts");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("fromB()");
    expect(result.stdout).not.toContain("fromA()");
  });

  test("reach -e <file> walks exports in that file only", () => {
    const host = workspace({
      "/packages/a/src/flow.ts": src`
        export function start() {
          notify();
        }
      `,
      "/packages/b/src/flow.ts": src`
        export function start() {
          other();
        }
        function other() {}
      `,
      "/packages/a/src/notify.ts": src`
        export function notify() {}
      `,
    });

    const result = host.run(
      "calldiff reach -e packages/a/src/flow.ts --to notify",
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("notify()");
    expect(result.stdout).not.toContain("other()");
  });

  test("diff -e <file> diffs exports defined in that file", () => {
    const host = workspace();
    const before = host.commit("before", {
      "/src/boot.ts": src`
        export function boot() {
          oldPath();
        }
        function oldPath() {}
      `,
    });
    host.commit("after", {
      "/src/boot.ts": src`
        export function boot() {
          newPath();
        }
        function newPath() {}
      `,
    });

    const result = host.run(`calldiff diff ${before} HEAD -e src/boot.ts`);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("boot()");
    expect(result.stdout).toContain("oldPath()");
    expect(result.stdout).toContain("newPath()");
    expect(result.stdout).toMatch(/^- /m);
    expect(result.stdout).toMatch(/^\+ /m);
  }, 30_000);

  test("errors when a file entrypoint is ambiguous", () => {
    const host = workspace({
      "/packages/a/src/boot.ts": src`
        export function boot() {}
      `,
      "/packages/b/src/boot.ts": src`
        export function boot() {}
      `,
    });

    const result = host.run("calldiff tree -e boot.ts");
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /Ambiguous entrypoint file/,
    );
  });

  test("errors when a file has no exported entrypoints", () => {
    const host = workspace({
      "/src/internal.ts": src`
        function helper() {
          work();
        }
        function work() {}
      `,
    });

    const result = host.run("calldiff tree -e src/internal.ts");
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /No exported entrypoints/,
    );
  });
});
