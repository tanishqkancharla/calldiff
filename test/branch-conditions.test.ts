import { outdent } from "outdent";
import { expect, test } from "vitest";
import { workspace } from "./workspace.js";

/**
 * A call in a branch test is the branch's identity, not a sibling and not
 * only label text. ASCII prints the `if` line plus the arm; `reach` walks
 * `condition` so `--to guard` hits that same `if` line.
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
  export function viaAndIf(x: number): number {
    if (guard(x) && other(x)) { return target(); }
    return 0;
  }
  export function other(x: number): boolean { return x < 0; }
`;

function formsHost() {
  return workspace({ "/src/app.ts": forms });
}

test("reach --to guard prints the if line, not a sibling guard", () => {
  const result = formsHost().run("calldiff reach -e viaIf --to guard -- src");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    viaIf(x)
    └─ if (guard(x))
  `.trimEnd());
  expect(result.stdout).not.toContain("No paths");
});

test("reach --to target still goes through the if into the arm", () => {
  const result = formsHost().run("calldiff reach -e viaIf --to target -- src");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    viaIf(x)
    └─ if (guard(x))
       └─ target()
  `.trimEnd());
});

test("reach finds a call written in an else-if test", () => {
  const result = formsHost().run("calldiff reach -e viaElseIf --to guard -- src");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    viaElseIf(x)
    └─ else if (guard(x))
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

test("tree keeps the if line; guard is not a sibling of the branch", () => {
  const host = formsHost();

  const viaIf = host.run("calldiff tree -e viaIf -- src");
  expect(viaIf.code).toBe(0);
  expect(viaIf.stdout).toContain(src`
    viaIf(x)
    └─ if (guard(x))
       └─ target()
  `.trimEnd());
  expect(viaIf.stdout).not.toContain("├─ guard(x)");

  const viaWhile = host.run("calldiff tree -e viaWhile -- src");
  expect(viaWhile.code).toBe(0);
  expect(viaWhile.stdout).toContain(src`
    viaWhile(x)
    ├─ guard(x)
    └─ target()
  `.trimEnd());
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

test("multiple calls in one test share the same if line", () => {
  const host = formsHost();

  const tree = host.run("calldiff tree -e viaAndIf -- src");
  expect(tree.code).toBe(0);
  expect(tree.stdout).toContain(src`
    viaAndIf(x)
    └─ if (guard(x) && other(x))
       └─ target()
  `.trimEnd());

  const toGuard = host.run("calldiff reach -e viaAndIf --to guard -- src");
  expect(toGuard.code).toBe(0);
  expect(toGuard.stdout).toContain("if (guard(x) && other(x))");
  expect(toGuard.stdout).not.toContain("No paths");

  const toOther = host.run("calldiff reach -e viaAndIf --to other -- src");
  expect(toOther.code).toBe(0);
  expect(toOther.stdout).toContain("if (guard(x) && other(x))");
  expect(toOther.stdout).not.toContain("No paths");
});

test("javascript switch subject lives on the switch branch", () => {
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
    └─ switch (getKind(x))
       ├─ case "a"
          └─ target()
       └─ default
  `.trimEnd());

  const reach = host.run("calldiff reach -e viaSwitch --to getKind -- src");
  expect(reach.code).toBe(0);
  expect(reach.stdout).toContain(src`
    viaSwitch(x)
    └─ switch (getKind(x))
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

test("python match subject lives on the match branch", () => {
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
    └─ match get_kind(x)
       └─ case "a"
          └─ target()
  `.trimEnd());

  const reach = host.run("calldiff reach -e via_match --to get_kind -- src");
  expect(reach.code).toBe(0);
  expect(reach.stdout).toContain("match get_kind(x)");
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
    ├─ if guard(x)
       └─ target()
    └─ elif other(x)
  `.trimEnd());

  const toGuard = host.run("calldiff reach -e via_if --to guard -- src");
  expect(toGuard.code).toBe(0);
  expect(toGuard.stdout).toContain("if guard(x)");
  expect(toGuard.stdout).not.toContain("No paths");

  const toOther = host.run("calldiff reach -e via_if --to other -- src");
  expect(toOther.code).toBe(0);
  expect(toOther.stdout).toContain("elif other(x)");
  expect(toOther.stdout).not.toContain("No paths");
});

test("rust match subject lives on the match branch", () => {
  const host = workspace({
    "/src/app.rs": src`
      fn get_kind(x: i32) -> i32 { x }
      fn target() -> i32 { 42 }
      fn via_match(x: i32) -> i32 {
          match get_kind(x) {
              1 => target(),
              _ => 0,
          }
      }
    `,
  });

  const tree = host.run("calldiff tree -e via_match -- src");
  expect(tree.code).toBe(0);
  expect(tree.stdout).toContain(src`
    via_match(x)
    └─ match get_kind(x)
       ├─ case 1
          └─ target()
       └─ case _
  `.trimEnd());

  const reach = host.run("calldiff reach -e via_match --to get_kind -- src");
  expect(reach.code).toBe(0);
  expect(reach.stdout).toContain("match get_kind(x)");
  expect(reach.stdout).not.toContain("No paths");
});

test("go switch subject lives on the switch branch", () => {
  const host = workspace({
    "/src/app.go": src`
      package app

      func getKind(x int) int { return x }
      func target() int { return 42 }
      func viaSwitch(x int) int {
        switch getKind(x) {
        case 1:
          return target()
        default:
          return 0
        }
      }
    `,
  });

  const tree = host.run("calldiff tree -e viaSwitch -- src");
  expect(tree.code).toBe(0);
  expect(tree.stdout).toContain(src`
    viaSwitch(x)
    └─ switch getKind(x)
       ├─ case 1
          └─ target()
       └─ default
  `.trimEnd());

  const reach = host.run("calldiff reach -e viaSwitch --to getKind -- src");
  expect(reach.code).toBe(0);
  expect(reach.stdout).toContain("switch getKind(x)");
  expect(reach.stdout).not.toContain("No paths");
});

test("kotlin when subject lives on the when branch", () => {
  const host = workspace({
    "/src/app.kt": src`
      fun getKind(x: Int): Int = x
      fun target(): Int = 42
      fun viaWhen(x: Int): Int {
        return when (getKind(x)) {
          1 -> target()
          else -> 0
        }
      }
    `,
  });

  const tree = host.run("calldiff tree -e viaWhen -- src");
  expect(tree.code).toBe(0);
  expect(tree.stdout).toContain("when");
  expect(tree.stdout).toContain("getKind(x)");
  expect(tree.stdout).not.toContain("├─ getKind(x)");

  const reach = host.run("calldiff reach -e viaWhen --to getKind -- src");
  expect(reach.code).toBe(0);
  expect(reach.stdout).toContain("when");
  expect(reach.stdout).not.toContain("No paths");
});

test("nested calls in a test still hit the if line", () => {
  const host = workspace({
    "/src/app.ts": src`
      export function foo(x: number): number { return x; }
      export function guard(x: number): boolean { return x > 0; }
      export function target(): number { return 42; }
      export function viaIf(x: number): number {
        if (guard(foo(x))) { return target(); }
        return 0;
      }
    `,
  });

  const tree = host.run("calldiff tree -e viaIf -- src");
  expect(tree.code).toBe(0);
  expect(tree.stdout).toContain(src`
    viaIf(x)
    └─ if (guard(foo(x)))
       └─ target()
  `.trimEnd());
  expect(tree.stdout).not.toContain("├─ guard");
  expect(tree.stdout).not.toContain("├─ foo");

  const toGuard = host.run("calldiff reach -e viaIf --to guard -- src");
  expect(toGuard.code).toBe(0);
  expect(toGuard.stdout).toContain(src`
    viaIf(x)
    └─ if (guard(foo(x)))
  `.trimEnd());
  expect(toGuard.stdout).not.toContain("No paths");

  const toFoo = host.run("calldiff reach -e viaIf --to foo -- src");
  expect(toFoo.code).toBe(0);
  expect(toFoo.stdout).toContain(src`
    viaIf(x)
    └─ if (guard(foo(x)))
  `.trimEnd());
  expect(toFoo.stdout).not.toContain("No paths");
});

test("reach into a condition callee's body goes through the if then the callee", () => {
  const host = workspace({
    "/src/app.ts": src`
      export function helper(x: number): boolean { return x > 0; }
      export function guard(x: number): boolean { return helper(x); }
      export function target(): number { return 42; }
      export function viaIf(x: number): number {
        if (guard(x)) { return target(); }
        return 0;
      }
    `,
  });

  const result = host.run("calldiff reach -e viaIf --to helper -- src");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    viaIf(x)
    └─ if (guard(x))
       └─ guard(x)
          └─ helper(x)
  `.trimEnd());
  expect(result.stdout).not.toContain("No paths");
});
