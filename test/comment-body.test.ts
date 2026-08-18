import { outdent } from "outdent";
import { expect, test } from "vitest";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("typescript: a line comment is not the arrow's body", () => {
  const host = workspace({
    "/src/handler.ts": src`
      export const handler = (event) =>
        // Read from context so this stays a drop-in combinator.
        process(event)
    `,
  });

  const result = host.run("calldiff tree -e handler");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    handler(event)
    └─ process()
  `.trimEnd());
});

test("typescript: a block comment is not the arrow's body", () => {
  const host = workspace({
    "/src/handler.ts": src`
      export const handler = (event) => /* explain */ process(event)
    `,
  });

  const result = host.run("calldiff tree -e handler");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    handler(event)
    └─ process()
  `.trimEnd());
});

test("typescript: a comment inside a curried chain is not the body", () => {
  const host = workspace({
    "/src/aeTracer.ts": src`
      export const traceRequest =
        <E, R>(options: Options<E, R>) =>
        <A, E2>(effect: Effect.Effect<A, E2>): Effect.Effect<A, E2> =>
          // The inbound request is read from context rather than passed in.
          Effect.flatMap(currentRequest(), (request) => runTraced(request, effect))
    `,
  });

  const result = host.run("calldiff tree -e traceRequest");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    traceRequest(options)
    └─ Effect.flatMap()
       ├─ currentRequest()
       └─ runTraced()
  `.trimEnd());
});

test("javascript: a line comment is not the arrow's body", () => {
  const host = workspace({
    "/src/handler.js": src`
      export const handler = (event) =>
        // explain
        process(event)
    `,
  });

  const result = host.run("calldiff tree -e handler");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    handler(event)
    └─ process()
  `.trimEnd());
});
