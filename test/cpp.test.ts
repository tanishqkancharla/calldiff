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
