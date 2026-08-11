import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

/** Keep the trailing newline so expectations match CLI stdout. */
const src = outdent({ trimTrailingNewline: false });

describe("CLI failure reporting (issue #24)", () => {
  // spawnSync + cold tsx can exceed the default 5s under parallel load
  test("tree missing entrypoint writes code/message to stderr only", { timeout: 15_000 }, () => {
    const host = workspace({
      "/src/app.ts": src`
        export function boot() {}
      `,
    });

    const result = host.run("calldiff tree -e doesNotExist src/app.ts");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("code: TREE_FAILED");
    expect(result.stderr).toContain('message: "Entrypoint not found: doesNotExist"');
    expect(result.stderr).not.toContain("hint:");
  });

  test("reach missing target writes to stderr only", { timeout: 15_000 }, () => {
    const host = workspace({
      "/src/app.ts": src`
        export function boot() {
          run();
        }
        function run() {}
      `,
    });

    const result = host.run("calldiff reach -e boot --to missingTarget");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("code: REACH_FAILED");
    expect(result.stderr).toContain('message: "Target not found: missingTarget"');
  });

  test("named re-export hints the barrel file", { timeout: 15_000 }, () => {
    const host = workspace({
      "/src/container.ts": src`
        export function createClient() {
          connect();
        }
        function connect() {}
      `,
      "/src/cradle.ts": src`
        export { createClient } from "./container.js";
      `,
    });

    const result = host.run("calldiff tree -e createClient src/cradle.ts");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("code: TREE_FAILED");
    expect(result.stderr).toContain('message: "Entrypoint not found: createClient"');
    expect(result.stderr).toContain(
      "hint: Symbol found only as a re-export in src/cradle.ts",
    );
  });

  test("star re-export hints the barrel file", { timeout: 15_000 }, () => {
    const host = workspace({
      "/src/container.ts": src`
        export function createClient() {
          connect();
        }
        function connect() {}
      `,
      "/src/cradle.ts": src`
        export * from "./container.js";
      `,
    });

    const result = host.run("calldiff tree -e createClient src/cradle.ts");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "hint: Symbol found only as a re-export in src/cradle.ts",
    );
  });

  test("existing empty-bodied entry still prints the header on stdout", { timeout: 15_000 }, () => {
    const host = workspace({
      "/src/app.ts": src`
        export function someRealFn() {}
      `,
    });

    const result = host.run("calldiff tree -e someRealFn src/app.ts");

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("calldiff tree working tree");
    expect(result.stdout).toContain("someRealFn()");
  });
});
