import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("typescript: a callback body nests under the receiving call", () => {
  const host = workspace({
    "/src/boot.ts": src`
      export function boot(items) {
        items.map((item) => render(item))
      }
    `,
  });

  const result = host.run("calldiff tree -e boot");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    boot(items)
    └─ items.map()
       └─ render()
  `.trimEnd());
});

test("typescript: argument calls nest under the call too", () => {
  const host = workspace({
    "/src/run.ts": src`
      export function run() {
        withRetry(backoff(), () => fetchAll())
      }
    `,
  });

  const result = host.run("calldiff tree -e run");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    run()
    └─ withRetry()
       ├─ backoff()
       └─ fetchAll()
  `.trimEnd());
});

test("typescript: nesting is transitive through a pipeline", () => {
  const host = workspace({
    "/src/aeTracer.ts": src`
      export const traceRequest = (options) => (effect) =>
        Effect.flatMap(currentRequest(), (request) =>
          Effect.flatMap(currentContext(), (context) =>
            withTracer(effect, parentSpanFrom(request))))
    `,
  });

  const result = host.run("calldiff tree -e traceRequest");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    traceRequest(options)
    └─ Effect.flatMap()
       ├─ currentRequest()
       └─ Effect.flatMap()
          ├─ currentContext()
          └─ withTracer()
             └─ parentSpanFrom()
  `.trimEnd());
});

test("typescript: a branch inside a callback keeps its arm", () => {
  const host = workspace({
    "/src/boot.ts": src`
      export function boot(items) {
        items.forEach((item) => {
          if (item.ready) {
            render(item)
          } else {
            skip(item)
          }
        })
      }
    `,
  });

  const result = host.run("calldiff tree -e boot");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    boot(items)
    └─ items.forEach()
       ├─ if (item.ready)
          └─ render()
       └─ else
          └─ skip()
  `.trimEnd());
});

test("typescript: a constructor callback nests as well", () => {
  const host = workspace({
    "/src/wait.ts": src`
      export function wait() {
        new Promise((resolve) => schedule(resolve))
      }
    `,
  });

  const result = host.run("calldiff tree -e wait");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    wait()
    └─ new Promise()
       └─ schedule()
  `.trimEnd());
});

test("typescript: a hoisted wrapper callback is not printed twice", () => {
  const host = workspace({
    "/src/boot.ts": src`
      export function boot() {
        const handler = defineEventHandler(async (event) => { chargeCard(event) })
        handler()
      }
    `,
  });

  const result = host.run("calldiff tree -e boot");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    boot()
    ├─ defineEventHandler()
    └─ handler(event)
       └─ chargeCard()
  `.trimEnd());
});

test("javascript: a callback body nests under the receiving call", () => {
  const host = workspace({
    "/src/boot.js": src`
      export function boot(items) {
        items.map((item) => render(item))
      }
    `,
  });

  const result = host.run("calldiff tree -e boot");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    boot(items)
    └─ items.map()
       └─ render()
  `.trimEnd());
});

test("tsx: an effect callback nests under useEffect", () => {
  const host = workspace({
    "/src/Panel.tsx": src`
      export function Panel() {
        useEffect(() => { loadRows() }, [])
        return <Rows />
      }
    `,
  });

  const result = host.run("calldiff tree -e Panel");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    Panel()
    ├─ useEffect()
    │  └─ loadRows()
    └─ Rows()
  `.trimEnd());
});

test("typescript: a change inside a callback shows where it happened", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/boot.ts": src`
      export function boot(items) {
        items.forEach((item) => {
          render(item);
        });
      }
    `,
  });
  const to = host.commit("after", {
    "/boot.ts": src`
      export function boot(items) {
        items.forEach((item) => {
          paint(item);
        });
      }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot(items)
      └─ items.forEach()
    -    ├─ render()
    +    └─ paint()
  `));
});

test("typescript: reach walks through callback nesting", () => {
  const host = workspace({
    "/src/aeTracer.ts": src`
      export const traceRequest = (options) => (effect) =>
        Effect.flatMap(currentRequest(), (request) =>
          parentSpanFromRequest(request))

      function parentSpanFromRequest(request) {
        parseTraceparent(request.header)
      }

      function parseTraceparent(header) {}
    `,
  });

  const result = host.run(
    "calldiff reach -e traceRequest --to parseTraceparent",
  );

  expect(result.code).toBe(0);
  expect(result.stdout).toContain("parseTraceparent");
  expect(result.stdout).toContain("Effect.flatMap()");
});
