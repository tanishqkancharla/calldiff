import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("c: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      int CreateAgentSession(int options) {
    -   AuthStorageCreate();
    -   CreateCodingTools();
    +   GetServices();
    +   ServicesBoot();
        if (options == 0) {
          SessionManagerCreate();
        } else {
          SessionManagerOpen(options);
        }
        return 0;
      }

    + int GetServices(void) {
    +   AuthStorageCreate();
    +   CreateCodingTools();
    +   return 0;
    + }
    + void ServicesBoot(void) {}

      void AuthStorageCreate(void) {}
      void CreateCodingTools(void) {}
      void SessionManagerCreate(void) {}
      void SessionManagerOpen(int id) {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.c": before });
  const to = host.commit("after", { "/pi.c": after });

  const result = host.run(`calldiff diff ${from} ${to} -e CreateAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      CreateAgentSession(options)
    - ├─ AuthStorageCreate()
    - ├─ CreateCodingTools()
    + ├─ GetServices()
    + │  ├─ AuthStorageCreate()
    + │  └─ CreateCodingTools()
    + ├─ ServicesBoot()
      ├─ if options == 0
         └─ SessionManagerCreate()
      └─ else
         └─ SessionManagerOpen(id)
  `));
});

test("c: field/arrow receiver calls resolve to obj.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void Runner_Start(struct Runner *r) {
        r->Prepare();
    +   r->Validate();
        r->Run();
      }
      void Prepare(struct Runner *r) {}
    + void Validate(struct Runner *r) {}
      void Run(struct Runner *r) {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.c": before });
  const to = host.commit("after", { "/runner.c": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner_Start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner_Start(r)
      ├─ r.Prepare()
    + ├─ r.Validate()
      └─ r.Run()
  `));
});

test("c: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void handle(int status) {
        if (status == 1) {
          do_a();
        } else if (status == 2) {
          do_b();
    +     do_extra();
        } else {
          do_other();
        }
      }
      void do_a(void) {}
      void do_b(void) {}
    + void do_extra(void) {}
      void do_other(void) {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.c": before });
  const to = host.commit("after", { "/elif.c": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(status)
      ├─ if status == 1
         └─ do_a()
      ├─ else if status == 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `));
});

test("c: switch cases as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void boot(int x) {
        switch (x) {
          case 1:
            do_a();
            break;
          case 2:
            do_b();
    +       do_extra();
            break;
          default:
            do_other();
            break;
        }
    +   flush();
      }
      void do_a(void) {}
      void do_b(void) {}
    + void do_extra(void) {}
      void do_other(void) {}
    + void flush(void) {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/switch.c": before });
  const to = host.commit("after", { "/switch.c": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(x)
      ├─ case 1
         └─ do_a()
      ├─ case 2
         ├─ do_b()
    +    └─ do_extra()
      ├─ default
         └─ do_other()
    + └─ flush()
  `));
});

test("c: does not attribute nested function bodies to the caller", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void outer(void) {
        void nested(void) {
          hidden();
        }
        visible();
    +   also_visible();
      }
      void hidden(void) {}
      void visible(void) {}
    + void also_visible(void) {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.c": before });
  const to = host.commit("after", { "/nested.c": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `));
});

test("c: expands static helpers when called", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void boot(void) {
        helper();
    +   extra();
      }
      static void helper(void) {
        load();
    +   migrate();
      }
      void load(void) {}
    + void migrate(void) {}
    + void extra(void) {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/static.c": before });
  const to = host.commit("after", { "/static.c": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ helper()
      │  ├─ load()
    + │  └─ migrate()
    + └─ extra()
  `));
});

test("c: dot and arrow field calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void run(struct Runner r, struct Runner *p) {
        r.Prepare();
        p->Run();
    +   p->Validate();
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/fields.c": before });
  const to = host.commit("after", { "/fields.c": after });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      run(r, p)
      ├─ r.Prepare()
      ├─ p.Run()
    + └─ p.Validate()
  `));
});
