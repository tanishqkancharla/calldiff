import { expect, test as vitestTest } from "vitest";
import { extractFunctions } from "../src/extract.js";
import type { CallStep, FunctionInfo } from "../src/types.js";
import { test } from "./expectCallstack.js";

/**
 * Indented `key` per step, so nesting is visible in the assertion. Kotlin
 * already nests a trailing lambda's body under the call that receives it;
 * these pin the same shape for TypeScript and JavaScript.
 */
function shape(fn: FunctionInfo | undefined): string {
  const walk = (steps: CallStep[], depth: number): string[] =>
    steps.flatMap((step) => [
      `${"  ".repeat(depth)}${step.type === "call" ? step.key : step.label}`,
      ...walk(step.children ?? [], depth + 1),
    ]);
  return walk(fn?.steps ?? [], 0).join("\n");
}

vitestTest("typescript: a callback body nests under the receiving call", () => {
  const [boot] = extractFunctions(
    "src/boot.ts",
    `export function boot(items) {
       items.map((item) => render(item))
     }`,
  );

  expect(shape(boot)).toBe(["items.map", "  render"].join("\n"));
});

vitestTest("typescript: argument calls nest under the call too", () => {
  const [run] = extractFunctions(
    "src/run.ts",
    `export function run() {
       withRetry(backoff(), () => fetchAll())
     }`,
  );

  expect(shape(run)).toBe(
    ["withRetry", "  backoff", "  fetchAll"].join("\n"),
  );
});

vitestTest("typescript: nesting is transitive through a pipeline", () => {
  const [traceRequest] = extractFunctions(
    "src/aeTracer.ts",
    `export const traceRequest = (options) => (effect) =>
       Effect.flatMap(currentRequest(), (request) =>
         Effect.flatMap(currentContext(), (context) =>
           withTracer(effect, parentSpanFrom(request))))`,
  );

  expect(shape(traceRequest)).toBe(
    [
      "Effect.flatMap",
      "  currentRequest",
      "  Effect.flatMap",
      "    currentContext",
      "    withTracer",
      "      parentSpanFrom",
    ].join("\n"),
  );
});

vitestTest("typescript: a branch inside a callback keeps its arm", () => {
  const [boot] = extractFunctions(
    "src/boot.ts",
    `export function boot(items) {
       items.forEach((item) => {
         if (item.ready) {
           render(item)
         } else {
           skip(item)
         }
       })
     }`,
  );

  expect(shape(boot)).toBe(
    [
      "items.forEach",
      "  if (item.ready)",
      "    render",
      "  else",
      "    skip",
    ].join("\n"),
  );
});

vitestTest("typescript: a constructor callback nests as well", () => {
  const [wait] = extractFunctions(
    "src/wait.ts",
    `export function wait() {
       new Promise((resolve) => schedule(resolve))
     }`,
  );

  expect(shape(wait)).toBe(["new Promise", "  schedule"].join("\n"));
});

vitestTest("typescript: a hoisted wrapper callback is not printed twice", () => {
  // `handler` is registered as its own definition, so the tree expands it from
  // the `handler()` call site. Nesting it under `defineEventHandler` too would
  // show the same body twice.
  const [boot] = extractFunctions(
    "src/boot.ts",
    `export function boot() {
       const handler = defineEventHandler(async (event) => { chargeCard(event) })
       handler()
     }`,
  );

  expect(shape(boot)).toBe(["defineEventHandler", "handler"].join("\n"));
});

vitestTest("javascript: a callback body nests under the receiving call", () => {
  const [boot] = extractFunctions(
    "src/boot.js",
    `export function boot(items) {
       items.map((item) => render(item))
     }`,
  );

  expect(shape(boot)).toBe(["items.map", "  render"].join("\n"));
});

vitestTest("tsx: an effect callback nests under useEffect", () => {
  const [Panel] = extractFunctions(
    "src/Panel.tsx",
    `export function Panel() {
       useEffect(() => { loadRows() }, [])
       return <Rows />
     }`,
  );

  expect(shape(Panel)).toBe(["useEffect", "  loadRows", "Rows"].join("\n"));
});

test("typescript: a change inside a callback shows where it happened", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export function boot(items) {
        items.forEach((item) => {
    -     render(item);
    +     paint(item);
        });
      }
    `,
    "boot",
    { file: "boot.ts" },
  ).toEqual(`
      boot(items)
      └─ items.forEach()
    -    ├─ render()
    +    └─ paint()
  `);
});
