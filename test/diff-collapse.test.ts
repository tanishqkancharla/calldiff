import { outdent } from "outdent";
import { expect, test } from "vitest";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

const before = src`
  export function root() {
    stable();
    changed();
  }
  function stable() {
    stableA();
    stableB();
  }
  function changed() {
    oldCall();
  }
`;
const after = src`
  export function root() {
    stable();
    changed();
  }
  function stable() {
    stableA();
    stableB();
  }
  function changed() {
    newCall();
  }
`;

test("diff collapses callees whose call tree did not change", () => {
  const host = workspace();
  const from = host.commit("before", { "/app.ts": before });
  const to = host.commit("after", { "/app.ts": after });

  const result = host.run(`calldiff diff ${from} ${to}`);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("stable() …");
  expect(result.stdout).not.toContain("stableA()");
  expect(result.stdout).toContain("oldCall()");
  expect(result.stdout).toContain("newCall()");
});

test("--full keeps unchanged callees expanded", () => {
  const host = workspace();
  const from = host.commit("before", { "/app.ts": before });
  const to = host.commit("after", { "/app.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} --full`);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("stableA()");
  expect(result.stdout).not.toContain("…");
});

test("diff expands a repeated changed callee once and marks repeats", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/app.ts": src`
      export function root() {
        changed();
        middle();
        changed();
      }
      function middle() {}
      function changed() {
        oldCall();
      }
    `,
  });
  const to = host.commit("after", {
    "/app.ts": src`
      export function root() {
        changed();
        middle();
        changed();
      }
      function middle() {}
      function changed() {
        newCall();
      }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to}`);
  expect(result.code).toBe(0);
  expect(result.stdout.match(/newCall\(\)/g)).toHaveLength(1);
  expect(result.stdout).toContain("changed() ↑");
});

test("a shallower repeat still expands when the first one was cut by --max-depth", () => {
  // root → viaA → shared → leaf (leaf's body is past depth 3 here),
  // then root → shared → leaf at a shallower depth, where the change shows.
  const host = workspace();
  const from = host.commit("before", {
    "/app.ts": src`
      export function root() {
        viaA();
        shared();
      }
      function viaA() {
        shared();
      }
      function shared() {
        leaf();
      }
      function leaf() {
        oldCall();
      }
    `,
  });
  const to = host.commit("after", {
    "/app.ts": src`
      export function root() {
        viaA();
        shared();
      }
      function viaA() {
        shared();
      }
      function shared() {
        leaf();
      }
      function leaf() {
        newCall();
      }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} --max-depth 3`);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("newCall()");
  expect(result.stdout).toContain("oldCall()");
});

test("collapsing does not invent a change when a call switches to an identical definition", () => {
  // a.ts's helper moves inside a function body (becomes local), so the bare
  // `helper` key now resolves to b.ts's helper. Both bodies are identical and
  // unchanged: the full diff shows no change, and neither may the collapsed one.
  const host = workspace();
  const from = host.commit("before", {
    "/a.ts": src`
      export function helper() {
        sameCall();
      }
    `,
    "/b.ts": src`
      export function helper() {
        sameCall();
      }
    `,
    "/root.ts": src`
      export function root() {
        helper();
      }
    `,
  });
  const to = host.commit("after", {
    "/a.ts": src`
      export function wrapper() {
        function helper() {
          sameCall();
        }
        return helper;
      }
    `,
  });

  const full = host.run(`calldiff diff ${from} ${to} -e root --full`);
  const collapsed = host.run(`calldiff diff ${from} ${to} -e root`);
  expect(full.stdout).toContain("No callstack changes for requested entrypoints.");
  expect(collapsed.stdout).toContain("No callstack changes for requested entrypoints.");
});

test("collapsing keeps a change that comes only from a different recursion path", () => {
  // The bare `root` key moves from a.ts to b.ts (a.ts's root becomes local).
  // shared() is unchanged, but it re-enters a different root on each side,
  // so the recursion cut (⇄) lands in a different place: a real change.
  const host = workspace();
  const from = host.commit("before", {
    "/a.ts": src`
      export function root() {
        shared();
      }
      function shared() {
        root();
      }
    `,
    "/b.ts": src`
      export function root() {
        shared();
      }
    `,
  });
  const to = host.commit("after", {
    "/a.ts": src`
      function wrapper() {
        function root() {
          shared();
        }
      }
      function shared() {
        root();
      }
    `,
  });

  const full = host.run(`calldiff diff ${from} ${to} -e root --full`);
  const collapsed = host.run(`calldiff diff ${from} ${to} -e root`);
  expect(full.stdout).not.toContain("No callstack changes");
  expect(collapsed.stdout).not.toContain("No callstack changes");
});
