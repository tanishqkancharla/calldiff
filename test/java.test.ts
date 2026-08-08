import { test } from "./expectCallstack.js";

test("java: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      class Pi {
        void createAgentSession(Options options) {
    -     AuthStorage.create();
    -     createCodingTools();
    +     Services services = this.getServices();
    +     services.boot();
          if (options.sessionId == null) {
            SessionManager.create();
          } else {
            SessionManager.open(options.sessionId);
          }
        }

    +   Services getServices() {
    +     AuthStorage.create();
    +     createCodingTools();
    +     return null;
    +   }
      }

      class AuthStorage {
        static void create() {}
      }
      class SessionManager {
        static void create() {}
        static void open(String id) {}
      }
      class Options { String sessionId; }
      class Services { void boot() {} }
    `,
    "Pi.createAgentSession",
    { file: "Pi.java" },
  ).toEqual(`
      Pi.createAgentSession(options)
    - ├─ AuthStorage.create()
    - ├─ createCodingTools()
    + ├─ Pi.getServices()
    + │  ├─ AuthStorage.create()
    + │  └─ createCodingTools()
    + ├─ services.boot()
      ├─ if (options.sessionId == null)
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open()
  `);
});

test("java: this.method resolves to Class.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Runner {
        void start() {
          this.prepare();
    +     this.validate();
          this.run();
        }
        void prepare() {}
    +   void validate() {}
        void run() {}
      }
    `,
    "Runner.start",
    { file: "Runner.java" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});
