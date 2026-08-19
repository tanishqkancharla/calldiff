import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("c: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.c": src`
       int CreateAgentSession(int options) {
         AuthStorageCreate();
         CreateCodingTools();
         if (options == 0) {
           SessionManagerCreate();
         } else {
           SessionManagerOpen(options);
         }
         return 0;
       }
      
      
       void AuthStorageCreate(void) {}
       void CreateCodingTools(void) {}
       void SessionManagerCreate(void) {}
       void SessionManagerOpen(int id) {}
    `,
  });
  const to = host.commit("after", {
    "/pi.c": src`
       int CreateAgentSession(int options) {
         GetServices();
         ServicesBoot();
         if (options == 0) {
           SessionManagerCreate();
         } else {
           SessionManagerOpen(options);
         }
         return 0;
       }
      
       int GetServices(void) {
         AuthStorageCreate();
         CreateCodingTools();
         return 0;
       }
       void ServicesBoot(void) {}
      
       void AuthStorageCreate(void) {}
       void CreateCodingTools(void) {}
       void SessionManagerCreate(void) {}
       void SessionManagerOpen(int id) {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e CreateAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/runner.c": src`
       void Runner_Start(struct Runner *r) {
         r->Prepare();
         r->Run();
       }
       void Prepare(struct Runner *r) {}
       void Run(struct Runner *r) {}
    `,
  });
  const to = host.commit("after", {
    "/runner.c": src`
       void Runner_Start(struct Runner *r) {
         r->Prepare();
         r->Validate();
         r->Run();
       }
       void Prepare(struct Runner *r) {}
       void Validate(struct Runner *r) {}
       void Run(struct Runner *r) {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner_Start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner_Start(r)
      ├─ r.Prepare()
    + ├─ r.Validate()
      └─ r.Run()
  `));
});

test("c: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.c": src`
       void handle(int status) {
         if (status == 1) {
           do_a();
         } else if (status == 2) {
           do_b();
         } else {
           do_other();
         }
       }
       void do_a(void) {}
       void do_b(void) {}
       void do_other(void) {}
    `,
  });
  const to = host.commit("after", {
    "/elif.c": src`
       void handle(int status) {
         if (status == 1) {
           do_a();
         } else if (status == 2) {
           do_b();
           do_extra();
         } else {
           do_other();
         }
       }
       void do_a(void) {}
       void do_b(void) {}
       void do_extra(void) {}
       void do_other(void) {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/switch.c": src`
       void boot(int x) {
         switch (x) {
           case 1:
             do_a();
             break;
           case 2:
             do_b();
             break;
           default:
             do_other();
             break;
         }
       }
       void do_a(void) {}
       void do_b(void) {}
       void do_other(void) {}
    `,
  });
  const to = host.commit("after", {
    "/switch.c": src`
       void boot(int x) {
         switch (x) {
           case 1:
             do_a();
             break;
           case 2:
             do_b();
             do_extra();
             break;
           default:
             do_other();
             break;
         }
         flush();
       }
       void do_a(void) {}
       void do_b(void) {}
       void do_extra(void) {}
       void do_other(void) {}
       void flush(void) {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/nested.c": src`
       void outer(void) {
         void nested(void) {
           hidden();
         }
         visible();
       }
       void hidden(void) {}
       void visible(void) {}
    `,
  });
  const to = host.commit("after", {
    "/nested.c": src`
       void outer(void) {
         void nested(void) {
           hidden();
         }
         visible();
         also_visible();
       }
       void hidden(void) {}
       void visible(void) {}
       void also_visible(void) {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `));
});

test("c: expands static helpers when called", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/static.c": src`
       void boot(void) {
         helper();
       }
       static void helper(void) {
         load();
       }
       void load(void) {}
    `,
  });
  const to = host.commit("after", {
    "/static.c": src`
       void boot(void) {
         helper();
         extra();
       }
       static void helper(void) {
         load();
         migrate();
       }
       void load(void) {}
       void migrate(void) {}
       void extra(void) {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ helper()
      │  ├─ load()
    + │  └─ migrate()
    + └─ extra()
  `));
});

test("c: dot and arrow field calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/fields.c": src`
       void run(struct Runner r, struct Runner *p) {
         r.Prepare();
         p->Run();
       }
    `,
  });
  const to = host.commit("after", {
    "/fields.c": src`
       void run(struct Runner r, struct Runner *p) {
         r.Prepare();
         p->Run();
         p->Validate();
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      run(r, p)
      ├─ r.Prepare()
      ├─ p.Run()
    + └─ p.Validate()
  `));
});
