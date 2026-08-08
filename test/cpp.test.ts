import { test } from "./expectCallstack.js";

test("cpp: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "CreateAgentSession",
    { file: "pi.cpp" },
  ).toEqual(`
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
  `);
});

test("cpp: this->method resolves to Class.method", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Runner.start",
    { file: "runner.cpp" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});

test("cpp: new Class() expands through the constructor", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "make",
    { file: "ctor.cpp" },
  ).toEqual(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `);
});

test("cpp: does not attribute lambda bodies to the caller", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      void outer() {
        auto f = []() { hidden(); };
        visible();
    +   also_visible();
      }
      void hidden() {}
      void visible() {}
    + void also_visible() {}
    `,
    "outer",
    { file: "lambda.cpp" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `);
});

test("cpp: else-if chains", ({ expectCallstack }) => {
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
      void do_a() {}
      void do_b() {}
    + void do_extra() {}
      void do_other() {}
    `,
    "handle",
    { file: "elif.cpp" },
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

test("cpp: try/catch as branches", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "try.cpp" },
  ).toEqual(`
      boot()
      ├─ try
         └─ open_()
      ├─ catch (int e)
         └─ recover()
      ├─ catch (...)
         └─ other()
    + └─ flush()
  `);
});

test("cpp: static Class::method resolves and expands", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Runner.start",
    { file: "static.cpp" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.helper()
      │  ├─ work()
    + │  └─ more()
    + └─ Runner.extra()
    +    └─ also()
  `);
});

test("cpp: pointer arrow calls on receivers", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "go",
    { file: "arrow.cpp" },
  ).toEqual(`
      go(r)
      ├─ r.prepare()
      ├─ r.run()
    + └─ r.validate()
  `);
});
