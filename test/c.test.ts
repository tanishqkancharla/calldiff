import { test } from "./expectCallstack.js";

test("c: refactors calls into a helper with if/else", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "CreateAgentSession",
    { file: "pi.c" },
  ).toEqual(`
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
  `);
});

test("c: field/arrow receiver calls resolve to obj.method", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      void Runner_Start(struct Runner *r) {
        r->Prepare();
    +   r->Validate();
        r->Run();
      }
      void Prepare(struct Runner *r) {}
    + void Validate(struct Runner *r) {}
      void Run(struct Runner *r) {}
    `,
    "Runner_Start",
    { file: "runner.c" },
  ).toEqual(`
      Runner_Start(r)
      ├─ r.Prepare()
    + ├─ r.Validate()
      └─ r.Run()
  `);
});

test("c: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "handle",
    { file: "elif.c" },
  ).toEqual(`
      handle(status)
      ├─ if status == 1
         └─ do_a()
      ├─ else if status == 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `);
});

test("c: switch cases as branches", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "switch.c" },
  ).toEqual(`
      boot(x)
      ├─ case 1
         └─ do_a()
      ├─ case 2
         ├─ do_b()
    +    └─ do_extra()
      ├─ default
         └─ do_other()
    + └─ flush()
  `);
});

test("c: does not attribute nested function bodies to the caller", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "outer",
    { file: "nested.c" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `);
});

test("c: expands static helpers when called", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "static.c" },
  ).toEqual(`
      boot()
      ├─ helper()
      │  ├─ load()
    + │  └─ migrate()
    + └─ extra()
  `);
});

test("c: dot and arrow field calls", ({ expectCallstack }) => {
  expectCallstack(
    `
      void run(struct Runner r, struct Runner *p) {
        r.Prepare();
        p->Run();
    +   p->Validate();
      }
    `,
    "run",
    { file: "fields.c" },
  ).toEqual(`
      run(r, p)
      ├─ r.Prepare()
      ├─ p.Run()
    + └─ p.Validate()
  `);
});
