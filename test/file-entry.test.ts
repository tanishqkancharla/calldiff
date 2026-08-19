import { describe, expect, test } from "vitest";
import { outdent } from "outdent";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

describe("CLI --file entrypoints", () => {
  test("tree --file matches a unique path suffix", () => {
    const host = workspace({
      "/packages/api/src/boot.ts": src`
        export function boot() {
          run();
        }
        function run() {}
      `,
    });

    const result = host.run("calldiff tree --file boot.ts");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("boot()");
    expect(result.stdout).toContain("run()");
  });

  test("tree --file prefers an exact path over a suffix", () => {
    const host = workspace({
      "/src/routes.ts": src`
        export function exact() {
          fromExact();
        }
        function fromExact() {}
      `,
      "/packages/api/src/routes.ts": src`
        export function nested() {
          fromNested();
        }
        function fromNested() {}
      `,
    });

    const result = host.run("calldiff tree --file src/routes.ts");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("fromExact()");
    expect(result.stdout).not.toContain("fromNested()");
  });

  test("errors when a file entrypoint is missing", () => {
    const host = workspace({
      "/src/boot.ts": src`
        export function boot() {}
      `,
    });

    const result = host.run("calldiff tree --file missing.ts");
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /Entrypoint file not found/,
    );
  });

  test("tree --file expands exported symbols in that file", () => {
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

    const result = host.run("calldiff tree --file packages/api/src/boot.ts");
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual(src`
      calldiff tree working tree

      boot()
      └─ run()

      ready()
      └─ ping()
    `);
  });

  test("tree -F pins to the file when the same name exists elsewhere", () => {
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

    const result = host.run("calldiff tree -F packages/b/src/flow.ts");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("fromB()");
    expect(result.stdout).not.toContain("fromA()");
  });

  test("tree -e stays symbol-only even for path-shaped strings", () => {
    const host = workspace({
      "/src/boot.ts": src`
        export function boot() {
          run();
        }
        function run() {}
      `,
    });

    const asFile = host.run("calldiff tree -e src/boot.ts");
    expect(asFile.code).not.toBe(0);
    expect(`${asFile.stdout}\n${asFile.stderr}`).toMatch(/Entrypoint not found/);

    const asSymbol = host.run("calldiff tree -e boot");
    expect(asSymbol.code).toBe(0);
    expect(asSymbol.stdout).toContain("boot()");
  });

  test("reach --file walks exports in that file only", () => {
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
      "calldiff reach --file packages/a/src/flow.ts --to notify",
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("notify()");
    expect(result.stdout).not.toContain("other()");
  });

  test("diff --file diffs exports defined in that file", () => {
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

    const result = host.run(`calldiff diff ${before} HEAD --file src/boot.ts`);
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

    const result = host.run("calldiff tree --file boot.ts");
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

    const result = host.run("calldiff tree --file src/internal.ts");
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /No exported entrypoints/,
    );
  });
});
