import { outdent } from "outdent";
import { expect, test } from "vitest";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("infers only exported ancestors of changed functions", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/app.ts": src`
      export function changedRoot() {
        changed();
      }
      function changed() {
        oldCall();
      }
      export function stableRoot() {
        stable();
      }
      function stable() {
        sameCall();
      }
    `,
  });
  const to = host.commit("after", {
    "/app.ts": src`
      export function changedRoot() {
        changed();
      }
      function changed() {
        newCall();
      }
      export function stableRoot() {
        stable();
      }
      function stable() {
        sameCall();
      }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to}`);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("changedRoot()");
  expect(result.stdout).not.toContain("stableRoot()");
});

test("falls back to changed non-exported functions", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/app.ts": src`
      function worker() {
        oldCall();
      }
    `,
  });
  const to = host.commit("after", {
    "/app.ts": src`
      function worker() {
        newCall();
      }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to}`);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("worker()");
  expect(result.stdout).toContain("oldCall()");
  expect(result.stdout).toContain("newCall()");
});

test("explicit unchanged entries report no callstack changes", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/app.ts": src`
      export function root() {
        sameCall();
      }
    `,
  });
  const to = host.commit("after");

  const result = host.run(`calldiff diff ${from} ${to} -e root`);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("No callstack changes for requested entrypoints.");
});
