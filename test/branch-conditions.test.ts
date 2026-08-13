import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { buildCallTree } from "../src/calltree.js";
import { buildIndex, extractFunctions } from "../src/extract.js";
import { findReachPaths } from "../src/reach.js";
import { renderTree } from "../src/render.js";
import { workspace } from "./workspace.js";

/**
 * A call in a branch test is an edge, not just label text.
 *
 * `tree` rendered `if (guard(x))` into the branch label and dropped the call,
 * so `reach` answered "No paths" for a path the same tool had just printed —
 * the worst direction for a consumer, since exit 0 plus "No paths" reads as a
 * confident statement about absence. See CONTRACT.md "Must support" #4.
 */
const forms = `
  export function guard(x: number): boolean { return x > 0; }
  export function target(): number { return 42; }

  export function viaIf(x: number): number {
    if (guard(x)) { return target(); }
    return 0;
  }
  export function viaElseIf(x: number): number {
    if (x === 0) { return 1; }
    else if (guard(x)) { return target(); }
    return 0;
  }
  export function viaWhile(x: number): number {
    while (guard(x)) { x--; }
    return target();
  }
  export function viaTernary(x: number): number {
    return guard(x) ? target() : 0;
  }
  export function viaAnd(x: number): number {
    return guard(x) && target();
  }
  export function viaAssign(x: number): number {
    const ok = guard(x);
    if (ok) return target();
    return 0;
  }
  export function viaReturn(x: number): boolean {
    return guard(x);
  }
`;

const index = buildIndex(extractFunctions("forms.ts", forms));

function reaches(entry: string, to: string): boolean {
  return findReachPaths(entry, to, index, 12).length > 0;
}

describe("calls in a branch test", () => {
  test("reach finds the callee in an if test", () => {
    expect(reaches("viaIf", "guard")).toBe(true);
  });

  test("reach finds the callee in an else-if test", () => {
    expect(reaches("viaElseIf", "guard")).toBe(true);
  });

  // The forms that already worked; this fix must not disturb them.
  test.each([
    ["viaWhile", "while"],
    ["viaTernary", "ternary"],
    ["viaAnd", "&&"],
    ["viaAssign", "assigned then tested"],
    ["viaReturn", "returned"],
  ])("still reaches through %s (%s)", (entry) => {
    expect(reaches(entry, "guard")).toBe(true);
  });

  test("the condition call is a sibling of the branch, as while already was", () => {
    const ascii = renderTree(buildCallTree("viaIf", index, 12), {
      color: false,
    });
    expect(ascii).toBe(
      outdent`
        viaIf(x)
        ├─ guard(x)
        └─ if (guard(x))
           └─ target()
      `,
    );

    // Same shape the ordinary path has always produced for a loop condition.
    expect(renderTree(buildCallTree("viaWhile", index, 12), { color: false }))
      .toBe(
        outdent`
          viaWhile(x)
          ├─ guard(x)
          └─ target()
        `,
      );
  });

  test("the branch label still shows the condition", () => {
    const ascii = renderTree(buildCallTree("viaIf", index, 12), {
      color: false,
    });
    expect(ascii).toContain("if (guard(x))");
  });

  test("a test with no calls adds no steps", () => {
    const plain = buildIndex(
      extractFunctions(
        "plain.ts",
        `
          export function run(x: number): number {
            if (x > 0) { return work(); }
            return 0;
          }
          export function work(): number { return 1; }
        `,
      ),
    );
    expect(renderTree(buildCallTree("run", plain, 12), { color: false })).toBe(
      outdent`
        run(x)
        └─ if (x > 0)
           └─ work()
      `,
    );
  });
});

describe("branch test calls end to end", () => {
  test("reach reports the path the tree prints", () => {
    const host = workspace({
      "/src/app.ts": outdent`
        export function guard(x: number): boolean {
          return x > 0;
        }

        export function viaIf(x: number): number {
          if (guard(x)) {
            return 1;
          }
          return 0;
        }
      `,
    });

    const result = host.run("calldiff reach -e viaIf --to guard -- src");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(outdent`
      viaIf(x)
      └─ guard(x)
    `);
    expect(result.stdout).not.toContain("No paths");
  });
});

/**
 * A switch/match subject is the same defect one node over: it runs before any
 * arm is chosen, and the extractors that special-case `switch` returned without
 * walking it. TypeScript never special-cased `switch`, so its subject was
 * always an ordinary edge — this makes the rest agree with it.
 */
describe("calls in a switch or match subject", () => {
  const switched = buildIndex(
    extractFunctions(
      "sw.ts",
      `
        export function getKind(x: number): string { return "a"; }
        export function target(): number { return 42; }
        export function viaSwitch(x: number): number {
          switch (getKind(x)) {
            case "a": return target();
            default: return 0;
          }
        }
      `,
    ),
  );

  test("typescript reaches the subject", () => {
    expect(findReachPaths("viaSwitch", "getKind", switched, 12)).toHaveLength(1);
  });

  test("javascript reaches the subject", () => {
    const js = buildIndex(
      extractFunctions(
        "sw.js",
        `
          export function getKind(x) { return "a"; }
          export function target() { return 42; }
          export function viaSwitch(x) {
            switch (getKind(x)) {
              case "a": return target();
              default: return 0;
            }
          }
        `,
      ),
    );
    expect(findReachPaths("viaSwitch", "getKind", js, 12)).toHaveLength(1);
    // The arms are still branches, not flattened into the subject's siblings.
    const tree = buildCallTree("viaSwitch", js, 12);
    expect(tree.children.map((c) => c.kind)).toEqual([
      "call",
      "branch",
      "branch",
    ]);
  });

  test("python reaches the match subject", () => {
    const py = buildIndex(
      extractFunctions(
        "sw.py",
        outdent`
          def get_kind(x):
              return "a"

          def target():
              return 42

          def via_match(x):
              match get_kind(x):
                  case "a":
                      return target()
              return 0
        `,
      ),
    );
    expect(findReachPaths("via_match", "get_kind", py, 12)).toHaveLength(1);
  });
});

/** Not a TypeScript quirk: every extractor consumed the test as label text. */
describe("branch test calls in other languages", () => {
  test("python: elif and if tests both resolve", () => {
    const py = buildIndex(
      extractFunctions(
        "a.py",
        outdent`
          def guard(x):
              return x > 0

          def other(x):
              return x < 0

          def target():
              return 42

          def via_if(x):
              if guard(x):
                  return target()
              elif other(x):
                  return 0
              return 1
        `,
      ),
    );

    expect(findReachPaths("via_if", "guard", py, 12)).toHaveLength(1);
    expect(findReachPaths("via_if", "other", py, 12)).toHaveLength(1);
  });
});
