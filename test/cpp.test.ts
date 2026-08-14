import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("cpp: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void CreateAgentSession(int options) {
    -   AuthStorage_create();
    -   create_coding_tools();
    +   GetServices();
    +   services_boot();
        if (options == 0) {
          SessionManager_create();
        } else {
          SessionManager_open(options);
        }
      }

    + void GetServices() {
    +   AuthStorage_create();
    +   create_coding_tools();
    + }

      void AuthStorage_create() {}
      void create_coding_tools() {}
      void SessionManager_create() {}
      void SessionManager_open(int id) {}
    + void services_boot() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.cpp": before });
  const to = host.commit("after", { "/pi.cpp": after });

  const result = host.run(`calldiff diff ${from} ${to} -e CreateAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      CreateAgentSession(options)
    - ├─ AuthStorage_create()
    - ├─ create_coding_tools()
    + ├─ GetServices()
    + │  ├─ AuthStorage_create()
    + │  └─ create_coding_tools()
    + ├─ services_boot()
      ├─ if options == 0
         └─ SessionManager_create()
      └─ else
         └─ SessionManager_open(id)
  `));
});

test("cpp: this->method resolves to Class.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Runner {
      public:
        void start() {
          this->prepare();
    +     this->validate();
          this->run();
        }
        void prepare() {}
    +   void validate() {}
        void run() {}
      };
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.cpp": before });
  const to = host.commit("after", { "/runner.cpp": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("cpp: new Class() expands through the constructor", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void make() {
        new Thing();
      }
      class Thing {
      public:
        Thing() {
          init();
    +     ready();
        }
      };
      void init() {}
    + void ready() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.cpp": before });
  const to = host.commit("after", { "/ctor.cpp": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("cpp: does not attribute lambda bodies to the caller", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void outer() {
        auto f = []() { hidden(); };
        visible();
    +   also_visible();
      }
      void hidden() {}
      void visible() {}
    + void also_visible() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/lambda.cpp": before });
  const to = host.commit("after", { "/lambda.cpp": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `));
});

test("cpp: else-if chains", () => {
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
      void do_a() {}
      void do_b() {}
    + void do_extra() {}
      void do_other() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.cpp": before });
  const to = host.commit("after", { "/elif.cpp": after });

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

test("cpp: try/catch as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      void boot() {
        try {
          open_();
        } catch (int e) {
          recover();
        } catch (...) {
          other();
        }
    +   flush();
      }
      void open_() {}
      void recover() {}
      void other() {}
    + void flush() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/try.cpp": before });
  const to = host.commit("after", { "/try.cpp": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ try
         └─ open_()
      ├─ catch (int e)
         └─ recover()
      ├─ catch (...)
         └─ other()
    + └─ flush()
  `));
});

test("cpp: static Class::method resolves and expands", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Runner {
      public:
        void start() {
          Runner::helper();
    +     Runner::extra();
        }
        static void helper() {
          work();
    +     more();
        }
    +   static void extra() {
    +     also();
    +   }
      };
      void work() {}
    + void more() {}
    + void also() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/static.cpp": before });
  const to = host.commit("after", { "/static.cpp": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.helper()
      │  ├─ work()
    + │  └─ more()
    + └─ Runner.extra()
    +    └─ also()
  `));
});

test("cpp: pointer arrow calls on receivers", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Runner {
      public:
        void prepare() {}
        void run() {}
    +   void validate() {}
      };
      void go(Runner *r) {
        r->prepare();
        r->run();
    +   r->validate();
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/arrow.cpp": before });
  const to = host.commit("after", { "/arrow.cpp": after });

  const result = host.run(`calldiff diff ${from} ${to} -e go`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      go(r)
      ├─ r.prepare()
      ├─ r.run()
    + └─ r.validate()
  `));
});
