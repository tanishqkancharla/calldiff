import { expect, test as vitestTest } from "vitest";
import { extractFunctions } from "../src/extract.js";
import type { FunctionInfo } from "../src/types.js";
import { test } from "./expectCallstack.js";

/** Call keys of a function's steps, in order (branches drop out as `false`). */
function callKeys(fn: FunctionInfo | undefined): unknown[] {
  return (fn?.steps ?? []).map((step) => step.type === "call" && step.key);
}

vitestTest("typescript: a curried arrow chain keeps the outer name's steps", () => {
  const functions = extractFunctions(
    "src/tracer.ts",
    `export const traceRequest = (options) => (effect) =>
       withTracer(effect, makeTracer(options))`,
  );

  // The chain is one logical function: the inner arrow is not its own entry.
  expect(functions.map((fn) => fn.key)).toEqual(["traceRequest"]);
  expect(callKeys(functions[0])).toEqual(["withTracer", "makeTracer"]);
});

vitestTest("typescript: every arrow in the chain is peeled, not just one", () => {
  const [middleware] = extractFunctions(
    "src/middleware.ts",
    `export const middleware = (store) => (next) => (action) => {
       log(action)
       return next(action)
     }`,
  );

  expect(middleware?.label).toBe("middleware(store)");
  expect(callKeys(middleware)).toEqual(["log", "next"]);
});

vitestTest("typescript: generics and return annotations do not hide the body", () => {
  const [traceRequest] = extractFunctions(
    "src/aeTracer.ts",
    `export const traceRequest =
       <E, R>(options: Options<E, R>) =>
       <A, E2>(effect: Effect.Effect<A, E2>): Effect.Effect<A, E2> =>
         Effect.flatMap(currentRequest(), (request) => runTraced(request, effect))`,
  );

  // `runTraced` sits inside an argument callback, so contract #5 keeps it out.
  expect(callKeys(traceRequest)).toEqual(["Effect.flatMap", "currentRequest"]);
});

vitestTest("typescript: a curried class property is peeled too", () => {
  const functions = extractFunctions(
    "src/Store.ts",
    `export class Store {
       select = (key) => (state) => read(state, key)
     }`,
  );

  expect(functions.map((fn) => fn.key)).toEqual(["Store.select"]);
  expect(callKeys(functions[0])).toEqual(["read"]);
});

vitestTest("typescript: an argument callback is still not the caller's", () => {
  const [boot] = extractFunctions(
    "src/boot.ts",
    `export function boot(items) {
       items.map((item) => render(item))
     }`,
  );

  expect(callKeys(boot)).toEqual(["items.map"]);
});

vitestTest("typescript: a function returned among statements stays out", () => {
  const [makeCounter] = extractFunctions(
    "src/counter.ts",
    `export function makeCounter() {
       setup()
       return () => tick()
     }`,
  );

  // A factory's product runs later, at a call site of its own — attributing
  // `tick` to `makeCounter` would claim it runs when the factory is called.
  expect(callKeys(makeCounter)).toEqual(["setup"]);
});

vitestTest("javascript: a curried arrow chain keeps the outer name's steps", () => {
  const functions = extractFunctions(
    "src/middleware.js",
    `export const middleware = (store) => (next) => (action) => {
       log(action)
       return next(action)
     }`,
  );

  expect(functions.map((fn) => fn.key)).toEqual(["middleware"]);
  expect(callKeys(functions[0])).toEqual(["log", "next"]);
});

vitestTest("tsx: a curried HOC reports the component it renders", () => {
  const [withAuth] = extractFunctions(
    "src/withAuth.tsx",
    `export const withAuth = (Component) => (props) => {
       useSession()
       return <Component {...props} />
     }`,
  );

  expect(callKeys(withAuth)).toEqual(["useSession", "Component"]);
});

test("typescript: a curried combinator diffs under its own name", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export const middleware = (store) => (next) => (action) => {
    -   log(action);
    +   audit(action);
        return next(action);
      };
    `,
    "middleware",
    { file: "middleware.ts" },
  ).toEqual(`
      middleware(store)
    - ├─ log()
    + ├─ audit()
      └─ next()
  `);
});
