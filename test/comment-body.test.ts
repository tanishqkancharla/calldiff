import { expect, test as vitestTest } from "vitest";
import { extractFunctions } from "../src/extract.js";
import type { FunctionInfo } from "../src/types.js";
import { stepShape } from "./helpers.js";

/** Call keys of a function's steps, in order (branches drop out as `false`). */
function callKeys(fn: FunctionInfo | undefined): unknown[] {
  return (fn?.steps ?? []).map((step) => step.type === "call" && step.key);
}

// tree-sitter reports `comment` as a NAMED child, so a concise arrow whose
// expression is preceded by one has the comment sitting where the body is
// looked for. Picking it makes the function report no calls at all.

vitestTest("typescript: a line comment is not the arrow's body", () => {
  const [handler] = extractFunctions(
    "src/handler.ts",
    `export const handler = (event) =>
       // Read from context so this stays a drop-in combinator.
       process(event)`,
  );

  expect(callKeys(handler)).toEqual(["process"]);
});

vitestTest("typescript: a block comment is not the arrow's body", () => {
  const [handler] = extractFunctions(
    "src/handler.ts",
    `export const handler = (event) => /* explain */ process(event)`,
  );

  expect(callKeys(handler)).toEqual(["process"]);
});

vitestTest("typescript: a comment inside a curried chain is not the body", () => {
  const [traceRequest] = extractFunctions(
    "src/aeTracer.ts",
    `export const traceRequest =
       <E, R>(options: Options<E, R>) =>
       <A, E2>(effect: Effect.Effect<A, E2>): Effect.Effect<A, E2> =>
         // The inbound request is read from context rather than passed in.
         Effect.flatMap(currentRequest(), (request) => runTraced(request, effect))`,
  );

  expect(stepShape(traceRequest)).toBe(
    ["Effect.flatMap", "  currentRequest", "  runTraced"].join("\n"),
  );
});

vitestTest("javascript: a line comment is not the arrow's body", () => {
  const [handler] = extractFunctions(
    "src/handler.js",
    `export const handler = (event) =>
       // explain
       process(event)`,
  );

  expect(callKeys(handler)).toEqual(["process"]);
});
