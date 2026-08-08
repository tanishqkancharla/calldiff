/**
 * Aggressive oxc vs tree-sitter parity probes for edge-case TS.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFunctions as extractOxc } from "../src/extract-oxc.js";
import { extractFunctions as extractTs } from "../src/extract.js";
import type { FunctionInfo } from "../src/types.js";

function brief(fns: FunctionInfo[]) {
  return fns
    .map((f) => ({
      key: f.key,
      label: f.label,
      exported: f.exported,
      steps: f.steps,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function assertParity(name: string, source: string, file = "sample.ts") {
  test(`edge parity: ${name}`, () => {
    const oxc = brief(extractOxc(file, source));
    const ts = brief(extractTs(file, source));
    assert.deepEqual(ts, oxc);
  });
}

assertParity(
  "getter/setter",
  `
export class C {
  get value() { fetch(); return 1; }
  set value(v: number) { store(v); }
  start() { use(this.value); }
}
function fetch() {}
function store(_v: number) {}
function use(_v: number) {}
`,
);

assertParity(
  "abstract method + implementation",
  `
export abstract class A {
  abstract prep(): void;
  start(): void {
    this.prep();
    run();
  }
}
function run() {}
`,
);

assertParity(
  "generator function",
  `
export function* gen() {
  yield work();
  return done();
}
function work() { return 1; }
function done() { return 2; }
`,
);

assertParity(
  "decorators on methods",
  `
function logged(_t: unknown, _k: string, d: PropertyDescriptor) { return d; }
export class C {
  @logged
  run() { work(); }
}
function work() {}
`,
);

assertParity(
  "super.method call",
  `
class Base { setup() {} }
export class Child extends Base {
  start() {
    super.setup();
    work();
  }
}
function work() {}
`,
);

assertParity(
  "assignment pattern params",
  `
export function f(x = 1, y: string = "a") { use(x, y); }
function use(..._a: unknown[]) {}
`,
);

assertParity(
  "declare function ambient",
  `
declare function external(): void;
export function local() { external(); }
`,
);

assertParity(
  "namespace with functions",
  `
export namespace N {
  export function boot() { inner(); }
  function inner() {}
}
`,
);

assertParity(
  "object literal methods are not extracted as functions",
  `
export const api = {
  start() { work(); },
  stop: () => { halt(); }
};
function work() {}
function halt() {}
`,
);

assertParity(
  "IIFE and void calls",
  `
export function boot() {
  void setup();
  (function () { hidden(); })();
}
function setup() {}
function hidden() {}
`,
);

test("known delta: tagged templates count as calls in tree-sitter only", () => {
  const source = [
    "export function boot() {",
    "  css`color: red`;",
    "  work();",
    "}",
    "function css(_s: TemplateStringsArray) {}",
    "function work() {}",
  ].join("\n");
  const oxc = brief(extractOxc("sample.ts", source));
  const ts = brief(extractTs("sample.ts", source));
  // oxc uses TaggedTemplateExpression (ignored); tree-sitter emits call_expression
  assert.deepEqual(
    oxc.find((f) => f.key === "boot")?.steps,
    [{ type: "call", key: "work" }],
  );
  assert.deepEqual(
    ts.find((f) => f.key === "boot")?.steps,
    [
      { type: "call", key: "css" },
      { type: "call", key: "work" },
    ],
  );
});

assertParity(
  "dynamic import()",
  `
export async function boot() {
  await import("./x");
  work();
}
function work() {}
`,
);

assertParity(
  "tsx component-ish calls",
  `
export function App() {
  return <Button onClick={handle} />;
}
function handle() { click(); }
function click() {}
function Button(_p: any) { return null; }
`,
  "sample.tsx",
);

assertParity(
  "static initialization block",
  `
export class C {
  static {
    init();
  }
  start() { work(); }
}
function init() {}
function work() {}
`,
);

assertParity(
  "for/while loop calls",
  `
export function boot(items: string[]) {
  for (const i of items) { visit(i); }
  while (cond()) { step(); }
}
function visit(_i: string) {}
function cond() { return false; }
function step() {}
`,
);

assertParity(
  "try/catch/finally calls",
  `
export function boot() {
  try { a(); } catch { b(); } finally { c(); }
}
function a() {}
function b() {}
function c() {}
`,
);

assertParity(
  "switch cases",
  `
export function boot(x: number) {
  switch (x) {
    case 1: a(); break;
    default: b();
  }
}
function a() {}
function b() {}
`,
);

assertParity(
  "async await",
  `
export async function boot() {
  await load();
  work();
}
async function load() {}
function work() {}
`,
);

assertParity(
  "method type parameters",
  `
export class C {
  map<T>(x: T) { id(x); }
}
function id<T>(x: T) { return x; }
`,
);

assertParity(
  "export async function",
  `
export async function boot() { await a(); b(); }
async function a() {}
function b() {}
`,
);

test("known delta: tree-sitter indexes #private methods; oxc only records the call", () => {
  const source = `
export class Vault {
  #unlock() { prep(); }
  open() { this.#unlock(); }
}
function prep() {}
`;
  const oxc = brief(extractOxc("sample.ts", source));
  const ts = brief(extractTs("sample.ts", source));
  // oxc skips MethodDefinition when key is PrivateIdentifier, so #unlock is not
  // in the index and its body (prep) never expands. tree-sitter does index it.
  assert.equal(
    oxc.some((f) => f.key === "Vault.#unlock"),
    false,
  );
  assert.deepEqual(
    oxc.find((f) => f.key === "Vault.open")?.steps,
    [{ type: "call", key: "Vault.#unlock" }],
  );
  assert.deepEqual(
    ts.find((f) => f.key === "Vault.#unlock")?.steps,
    [{ type: "call", key: "prep" }],
  );
  assert.deepEqual(
    ts.find((f) => f.key === "Vault.open")?.steps,
    [{ type: "call", key: "Vault.#unlock" }],
  );
});

assertParity(
  "export class with constructor only",
  `
export class Thing {
  constructor(public x: number) {
    setup(x);
  }
}
function setup(_x: number) {}
`,
);
