import { outdent } from "outdent";
import { expect, test } from "vitest";
import { workspace } from "./workspace.js";

/**
 * A call in a branch test is an edge, not just label text.
 *
 * `tree` used to render `if (guard(x))` into the branch label and drop the
 * call, so `reach` answered "No paths" for a path the same tool had just
 * printed. See CONTRACT.md "Must support" #4.
 */
const src = outdent({ trimTrailingNewline: false });

const forms = src`
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

function formsHost() {
  return workspace({ "/src/app.ts": forms });
}

test("reach finds a call written in an if test", () => {
  const result = formsHost().run("calldiff reach -e viaIf --to guard -- src");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    viaIf(x)
    └─ guard(x)
  `.trimEnd());
  expect(result.stdout).not.toContain("No paths");
});

test("reach finds a call written in an else-if test", () => {
  const result = formsHost().run("calldiff reach -e viaElseIf --to guard -- src");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    viaElseIf(x)
    └─ guard(x)
  `.trimEnd());
  expect(result.stdout).not.toContain("No paths");
});

test.each([
  ["viaWhile", "while"],
  ["viaTernary", "ternary"],
  ["viaAnd", "&&"],
  ["viaAssign", "assigned then tested"],
  ["viaReturn", "returned"],
])("still reaches through %s (%s)", (entry) => {
  const result = formsHost().run(
    `calldiff reach -e ${entry} --to guard -- src`,
  );

  expect(result.code).toBe(0);
  expect(result.stdout).toContain("guard(x)");
  expect(result.stdout).not.toContain("No paths");
});

test("the condition call is a sibling of the branch, as while already was", () => {
  const host = formsHost();

  const viaIf = host.run("calldiff tree -e viaIf -- src");
  expect(viaIf.code).toBe(0);
  expect(viaIf.stdout).toContain(src`
    viaIf(x)
    ├─ guard(x)
    └─ if (guard(x))
       └─ target()
  `.trimEnd());

  const viaWhile = host.run("calldiff tree -e viaWhile -- src");
  expect(viaWhile.code).toBe(0);
  expect(viaWhile.stdout).toContain(src`
    viaWhile(x)
    ├─ guard(x)
    └─ target()
  `.trimEnd());
});

test("the branch label still shows the condition", () => {
  const result = formsHost().run("calldiff tree -e viaIf -- src");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain("if (guard(x))");
});

test("a test with no calls adds no steps", () => {
  const host = workspace({
    "/src/app.ts": src`
      export function run(x: number): number {
        if (x > 0) { return work(); }
        return 0;
      }
      export function work(): number { return 1; }
    `,
  });

  const result = host.run("calldiff tree -e run -- src");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    run(x)
    └─ if (x > 0)
       └─ work()
  `.trimEnd());
  expect(result.stdout).not.toContain("├─");
});

test("javascript switch subject is an edge; the arms stay branches", () => {
  const host = workspace({
    "/src/app.js": src`
      export function getKind(x) { return "a"; }
      export function target() { return 42; }
      export function viaSwitch(x) {
        switch (getKind(x)) {
          case "a": return target();
          default: return 0;
        }
      }
    `,
  });

  const tree = host.run("calldiff tree -e viaSwitch -- src");
  expect(tree.code).toBe(0);
  expect(tree.stdout).toContain(src`
    viaSwitch(x)
    ├─ getKind(x)
    ├─ case "a"
       └─ target()
    └─ default
  `.trimEnd());

  const reach = host.run("calldiff reach -e viaSwitch --to getKind -- src");
  expect(reach.code).toBe(0);
  expect(reach.stdout).toContain(src`
    viaSwitch(x)
    └─ getKind(x)
  `.trimEnd());
  expect(reach.stdout).not.toContain("No paths");
});

test("typescript switch subject is still an ordinary edge", () => {
  const host = workspace({
    "/src/app.ts": src`
      export function getKind(x: number): string { return "a"; }
      export function target(): number { return 42; }
      export function viaSwitch(x: number): number {
        switch (getKind(x)) {
          case "a": return target();
          default: return 0;
        }
      }
    `,
  });

  const result = host.run("calldiff reach -e viaSwitch --to getKind -- src");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain("getKind(x)");
  expect(result.stdout).not.toContain("No paths");
});

test("python match subject is an edge", () => {
  const host = workspace({
    "/src/app.py": src`
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
  });

  const tree = host.run("calldiff tree -e via_match -- src");
  expect(tree.code).toBe(0);
  expect(tree.stdout).toContain(src`
    via_match(x)
    ├─ get_kind(x)
    └─ case "a"
       └─ target()
  `.trimEnd());

  const reach = host.run("calldiff reach -e via_match --to get_kind -- src");
  expect(reach.code).toBe(0);
  expect(reach.stdout).toContain("get_kind(x)");
  expect(reach.stdout).not.toContain("No paths");
});

test("python if and elif tests both resolve", () => {
  const host = workspace({
    "/src/app.py": src`
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
  });

  const tree = host.run("calldiff tree -e via_if -- src");
  expect(tree.code).toBe(0);
  expect(tree.stdout).toContain(src`
    via_if(x)
    ├─ guard(x)
    ├─ if guard(x)
       └─ target()
    ├─ other(x)
    └─ elif other(x)
  `.trimEnd());

  const toGuard = host.run("calldiff reach -e via_if --to guard -- src");
  expect(toGuard.code).toBe(0);
  expect(toGuard.stdout).toContain("guard(x)");
  expect(toGuard.stdout).not.toContain("No paths");

  const toOther = host.run("calldiff reach -e via_if --to other -- src");
  expect(toOther.code).toBe(0);
  expect(toOther.stdout).toContain("other(x)");
  expect(toOther.stdout).not.toContain("No paths");
});
