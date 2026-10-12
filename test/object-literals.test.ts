import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

/** Keep the trailing newline so expectations match CLI stdout. */
const src = outdent({ trimTrailingNewline: false });

/**
 * Functions written as object-literal properties.
 *
 * They are module-level callables the same way class methods are, so they are
 * indexed as `<owner>.<prop>`. Before this they parsed to nothing, which made a
 * file that exports only object literals unusable as a `--file` entrypoint and
 * hid every call inside them from `tree`/`reach`/`diff`.
 */
describe("object-literal functions", () => {
  test("typescript: exported object-literal methods become --file entrypoints", () => {
    const host = workspace({
      "/src/tool.ts": src`
        export const tool = {
          available: () => true,
          execute(input: string) {
            return run(input);
          },
        };

        function run(input: string) {
          return input;
        }
      `,
    });

    const result = host.run("calldiff tree --file src/tool.ts");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("tool.available()");
    expect(result.stdout).toContain("tool.execute(input)");
    expect(result.stdout).toContain("run(input)");
  });

  test("typescript: nested object literals extend the key prefix", () => {
    const host = workspace({
      "/src/config.ts": src`
        export const config = {
          hooks: {
            onReady: () => prime(),
          },
        };

        function prime() {}
      `,
    });

    const result = host.run("calldiff tree --file src/config.ts");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("config.hooks.onReady()");
    expect(result.stdout).toContain("prime()");
  });

  test("typescript: a non-exported object literal still answers calls", () => {
    const host = workspace({
      "/src/flow.ts": src`
        const helper = {
          run: () => leaf(),
        };

        export function entry() {
          helper.run();
        }

        function leaf() {}
      `,
    });

    const result = host.run("calldiff tree --entry entry");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("entry()");
    expect(result.stdout).toContain("helper.run()");
    expect(result.stdout).toContain("leaf()");
  });

  test("typescript: diff reports call-flow changes inside an object-literal method", () => {
    const host = workspace();
    const before = host.commit("before", {
      "/src/tool.ts": src`
        export const tool = {
          execute: () => oldPath(),
        };

        function oldPath() {}
      `,
    });
    host.commit("after", {
      "/src/tool.ts": src`
        export const tool = {
          execute: () => newPath(),
        };

        function newPath() {}
      `,
    });

    const result = host.run(`calldiff diff ${before} HEAD --file src/tool.ts`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("tool.execute()");
    expect(result.stdout).toContain("oldPath()");
    expect(result.stdout).toContain("newPath()");
  });

  test("javascript: exported object-literal methods become --file entrypoints", () => {
    const host = workspace({
      "/src/tool.js": src`
        export const tool = {
          execute: (input) => run(input),
        };

        function run(input) {
          return input;
        }
      `,
    });

    const result = host.run("calldiff tree --file src/tool.js");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("tool.execute(input)");
    expect(result.stdout).toContain("run(input)");
  });
});
