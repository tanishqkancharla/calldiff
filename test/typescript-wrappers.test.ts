import { expect, test } from "vitest";
import { outdent } from "outdent";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("typescript: extracts a named function passed to a wrapper call", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/api/create.post.ts": src`
       export default defineEventHandler(function handleCreate(event) {
         validateBody(event);
         if (!input) {
           throwBadRequest();
         } else {
           persist(input);
         }
       });
    `,
  });
  const to = host.commit("after", {
    "/api/create.post.ts": src`
       export default defineEventHandler(function handleCreate(event) {
         const input = parseBody(event);
         if (!input) {
           throwBadRequest();
         } else {
           persist(input);
         }
       });
      
       function parseBody(event) {
         readValidatedBody(event);
         return input;
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handleCreate`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      handleCreate(event)
    - ├─ validateBody()
    + ├─ parseBody(event)
    + │  └─ readValidatedBody()
      ├─ if (!input)
         └─ throwBadRequest()
      └─ else
         └─ persist()
  `));
});

test("anonymous wrapped default exports are keyed by file path", () => {
  const source = src`
    export default defineEventHandler(async (event) => {
      requireUserSession(event);
    });
  `;
  const host = workspace({
    "/apps/app/server/api/organization/index.post.ts": source,
    "/apps/admin/server/api/billing/plans/index.post.ts": source,
  });

  const organization = host.run(
    "calldiff tree --file apps/app/server/api/organization/index.post.ts",
  );
  const plans = host.run(
    "calldiff tree --file apps/admin/server/api/billing/plans/index.post.ts",
  );

  expect(organization.code).toBe(0);
  expect(plans.code).toBe(0);
  expect(organization.stdout).toContain(src`
    apps/app/server/api/organization/index.post(event)
    └─ requireUserSession()
  `.trimEnd());
  expect(plans.stdout).toContain(src`
    apps/admin/server/api/billing/plans/index.post(event)
    └─ requireUserSession()
  `.trimEnd());
});

test("wrapper arguments keep their call steps", () => {
  const host = workspace({
    "/apps/app/server/api/organization/index.post.ts": src`
      export default defineEventHandler(async (event) => {
        requireUserSession(event);
        readValidatedBody(event);
        useDrizzle();
      });
    `,
  });

  const result = host.run(
    "calldiff tree --file apps/app/server/api/organization/index.post.ts",
  );

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    apps/app/server/api/organization/index.post(event)
    ├─ requireUserSession()
    ├─ readValidatedBody()
    └─ useDrizzle()
  `.trimEnd());
});

test("wrapper calls in variable declarators are unwrapped", () => {
  const host = workspace({
    "/server/api/orders/index.post.ts": src`
      export const handler = defineEventHandler(async (event) => { charlie(event) })
      const cached = defineCachedFunction(async () => { delta() })
      export const named = defineEventHandler(function inner(event) { echo(event) })
      const plain = (input) => { golf(input) }
    `,
  });

  const exported = host.run("calldiff tree --file server/api/orders/index.post.ts");
  expect(exported.code).toBe(0);
  expect(exported.stdout).toContain(src`
    handler(event)
    └─ charlie()

    inner(event)
    └─ echo()
  `.trimEnd());

  const cached = host.run("calldiff tree -e cached");
  expect(cached.code).toBe(0);
  expect(cached.stdout).toContain("delta()");

  const plain = host.run("calldiff tree -e plain");
  expect(plain.code).toBe(0);
  expect(plain.stdout).toContain("golf()");
});

test("type wrappers around a callback are peeled off", () => {
  const host = workspace({
    "/server/handlers.ts": src`
      export const satisfied = defineEventHandler(((event) => { a(event) }) satisfies EventHandler)
      export const asserted = defineEventHandler(((event) => { b(event) }) as EventHandler)
      export const parenthesized = defineEventHandler(((event) => { c(event) }))
      export const angled = defineEventHandler(<EventHandler>((event) => { d(event) }))
      export const generated = Effect.gen((function* () { e() }) satisfies Gen)
    `,
  });

  const result = host.run("calldiff tree --file server/handlers.ts");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    angled(event)
    └─ d()

    asserted(event)
    └─ b()

    generated()
    └─ e()

    parenthesized(event)
    └─ c()

    satisfied(event)
    └─ a()
  `.trimEnd());
});

test("type wrappers around the wrapper call itself are peeled off", () => {
  const host = workspace({
    "/server/api/orders/index.post.ts": src`
      export default (defineEventHandler((event) => { chargeCard(event) })) as EventHandler
    `,
  });

  const result = host.run("calldiff tree --file server/api/orders/index.post.ts");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    server/api/orders/index.post(event)
    └─ chargeCard()
  `.trimEnd());
});

test("a call argument holding no function does not stop the scan", () => {
  const host = workspace({
    "/server/handlers.ts": src`
      export const handler = createHandler(makeOptions(), async () => { chargeCard() })
      export const effectful = Layer.effect(makeTag(), Effect.gen(function* () { init() }))
    `,
  });

  const result = host.run("calldiff tree --file server/handlers.ts");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    effectful()
    └─ init()

    handler()
    └─ chargeCard()
  `.trimEnd());
});

test("generator arguments to wrapper calls are unwrapped", () => {
  const host = workspace({
    "/svc/user.ts": src`
      export const getUser = Effect.gen(function* () {
        const cfg = yield* Config
        return yield* findUser(cfg.id)
      })
      export const layer = Layer.effect(Tag, Effect.gen(function* () { init() }))
    `,
  });

  const result = host.run("calldiff tree --file svc/user.ts");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    getUser()
    └─ findUser()

    layer()
    └─ init()
  `.trimEnd());
});

test("tsx: diffs a component wrapped in React.memo", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/OrderRow.tsx": src`
       export default memo(function OrderRow({ order }) {
         const total = formatCurrency(order.total);
         if (order.isPending) {
           return <Spinner />;
         }
         return <Row total={total} />;
       });
    `,
  });
  const to = host.commit("after", {
    "/OrderRow.tsx": src`
       export default memo(function OrderRow({ order }) {
         const total = formatCurrency(order.total);
         if (order.isPending) {
           return <SkeletonRow />;
         }
         trackImpression(order.id);
         return <Row total={total} />;
       });
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e OrderRow`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      OrderRow({})
      ├─ formatCurrency()
      ├─ if (order.isPending)
    -    ├─ Spinner()
    +    └─ SkeletonRow()
    + ├─ trackImpression()
      └─ Row()
  `));
});

test("tsx: composed wrappers are unwrapped to the inner function", () => {
  const host = workspace({
    "/components/Input.tsx": src`
      export default memo(forwardRef(function Input(props, ref) { focusOnMount(ref) }))
    `,
  });

  const result = host.run("calldiff tree -e Input");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    Input(props, ref)
    └─ focusOnMount()
  `.trimEnd());
});

test("tsx: a wrapper over a bare reference adds nothing", () => {
  const host = workspace({
    "/components/Row.tsx": src`
      function RowBase({ item }) { renderCell(item) }
      export const Row = memo(RowBase)
    `,
  });

  const alias = host.run("calldiff tree -e Row");
  expect(alias.code).not.toBe(0);
  expect(`${alias.stdout}\n${alias.stderr}`).toMatch(/Entrypoint not found/);

  const base = host.run("calldiff tree -e RowBase");
  expect(base.code).toBe(0);
  expect(base.stdout).toContain("renderCell()");
});

test("tsx: an anonymous memo callback keys off the declared name", () => {
  const host = workspace({
    "/components/OrderBadge.tsx": src`
      export const OrderBadge = memo(({ status }) => {
        return <Badge tone={toneFor(status)} />
      })
    `,
  });

  const result = host.run("calldiff tree -e OrderBadge");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("OrderBadge(");
  expect(result.stdout).toContain("Badge()");
});

test("an exported wrapped declarator is selectable as an entry", () => {
  const host = workspace({
    "/server/api/orders/index.post.ts": src`
      export const handler = defineEventHandler(async (event) => { chargeCard() })
    `,
  });

  const result = host.run("calldiff tree -e handler");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(src`
    handler(event)
    └─ chargeCard()
  `.trimEnd());
});

test("typescript: a wrapped local helper expands from the caller", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/boot.ts": src`
       export function boot() {
         const handler = defineEventHandler(async (event) => {
           chargeCard(event);
         });
         handler();
       }
    `,
  });
  const to = host.commit("after", {
    "/boot.ts": src`
       export function boot() {
         const handler = defineEventHandler(async (event) => {
           refund(event);
         });
         handler();
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ defineEventHandler()
      └─ handler(event)
    -    ├─ chargeCard()
    +    └─ refund()
  `));
});
