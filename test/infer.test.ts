import { outdent } from "outdent";
import { expect, test } from "vitest";
import { buildIndex, extractFunctions } from "../src/extract.js";
import { affectedEntries } from "../src/infer.js";
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

test("reports a change inside a file-scoped helper that shares a global name", () => {
  // lib.ts sorts first, so it owns the bare `helper` key; z.ts calls its own
  // helper (file-scoped resolution, #19). Only the z.ts helper changes.
  const host = workspace();
  const from = host.commit("before", {
    "/lib.ts": src`
      export function helper() {
        libCall();
      }
    `,
    "/z.ts": src`
      export function rootZ() {
        helper();
      }
      function helper() {
        oldCall();
      }
    `,
  });
  const to = host.commit("after", {
    "/z.ts": src`
      export function rootZ() {
        helper();
      }
      function helper() {
        newCall();
      }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to}`);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("rootZ()");
  expect(result.stdout).toContain("oldCall()");
  expect(result.stdout).toContain("newCall()");
});

test("a line shift alone does not make an entry a candidate", () => {
  const before = buildIndex(
    extractFunctions(
      "app.ts",
      src`
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
    ),
  );
  const after = buildIndex(
    extractFunctions(
      "app.ts",
      src`
        export function changedRoot() {
          changed();
        }
        function changed() {
          oldCall();
          extraCall();
        }
        export function stableRoot() {
          stable();
        }
        function stable() {
          sameCall();
        }
      `,
    ),
  );

  const candidates = affectedEntries(before, after, 12);
  expect(candidates).toContain("changedRoot");
  expect(candidates).not.toContain("stableRoot");
  expect(candidates).not.toContain("stable");
});
