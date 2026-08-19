import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("typescript: a curried arrow chain keeps the outer name's steps", () => {
  const host = workspace({
    "/src/tracer.ts": src`
      export const traceRequest = (options) => (effect) =>
        withTracer(effect, makeTracer(options))
    `,
  });

  const result = host.run("calldiff tree --file src/tracer.ts");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    traceRequest(options)
    └─ withTracer()
       └─ makeTracer()
  `.trimEnd());
});

test("typescript: every arrow in the chain is peeled, not just one", () => {
  const host = workspace({
    "/src/middleware.ts": src`
      export const middleware = (store) => (next) => (action) => {
        log(action)
        return next(action)
      }
    `,
  });

  const result = host.run("calldiff tree -e middleware");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    middleware(store)
    ├─ log()
    └─ next()
  `.trimEnd());
});

test("typescript: generics and return annotations do not hide the body", () => {
  const host = workspace({
    "/src/aeTracer.ts": src`
      export const traceRequest =
        <E, R>(options: Options<E, R>) =>
        <A, E2>(effect: Effect.Effect<A, E2>): Effect.Effect<A, E2> =>
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

test("typescript: a curried class property is peeled too", () => {
  const host = workspace({
    "/src/Store.ts": src`
      export class Store {
        select = (key) => (state) => read(state, key)
      }
    `,
  });

  const result = host.run("calldiff tree -e Store.select");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    Store.select(key)
    └─ read()
  `.trimEnd());
});

test("typescript: an argument callback is still not the caller's", () => {
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

test("typescript: a function returned among statements stays out", () => {
  const host = workspace({
    "/src/counter.ts": src`
      export function makeCounter() {
        setup()
        return () => tick()
      }
    `,
  });

  const result = host.run("calldiff tree -e makeCounter");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    makeCounter()
    └─ setup()
  `.trimEnd());
  expect(result.stdout).not.toContain("tick");
});

test("javascript: a curried arrow chain keeps the outer name's steps", () => {
  const host = workspace({
    "/src/middleware.js": src`
      export const middleware = (store) => (next) => (action) => {
        log(action)
        return next(action)
      }
    `,
  });

  const result = host.run("calldiff tree -e middleware");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    middleware(store)
    ├─ log()
    └─ next()
  `.trimEnd());
});

test("tsx: a curried HOC reports the component it renders", () => {
  const host = workspace({
    "/src/withAuth.tsx": src`
      export const withAuth = (Component) => (props) => {
        useSession()
        return <Component {...props} />
      }
    `,
  });

  const result = host.run("calldiff tree -e withAuth");

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    withAuth(Component)
    ├─ useSession()
    └─ Component()
  `.trimEnd());
});

test("typescript: a curried combinator diffs under its own name", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/middleware.ts": src`
      export const middleware = (store) => (next) => (action) => {
        log(action);
        return next(action);
      };
    `,
  });
  const to = host.commit("after", {
    "/middleware.ts": src`
      export const middleware = (store) => (next) => (action) => {
        audit(action);
        return next(action);
      };
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e middleware`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      middleware(store)
    - ├─ log()
    + ├─ audit()
      └─ next()
  `));
});
