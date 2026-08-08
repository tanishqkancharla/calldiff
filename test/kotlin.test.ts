import { test } from "./expectCallstack.js";

test("kotlin: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      fun createAgentSession(options: Options) {
    -   AuthStorage.create()
    -   createCodingTools()
    +   val services = getServices()
    +   services.boot()
        if (options.sessionId == null) {
          SessionManager.create()
        } else {
          SessionManager.open(options.sessionId)
        }
      }

    + fun getServices(): Services {
    +   AuthStorage.create()
    +   createCodingTools()
    +   return Services()
    + }

      fun createCodingTools() {}

      class SessionManager {
        companion object {
          fun create() {}
          fun open(id: String) {}
        }
      }

      class AuthStorage {
        companion object {
          fun create() {}
        }
      }

    + class Services {
    +   fun boot() {}
    + }
    `,
    "createAgentSession",
    { file: "pi.kt" },
  ).toEqual(`
      createAgentSession(options)
    - ├─ AuthStorage.create()
    - ├─ createCodingTools()
    + ├─ getServices()
    + │  ├─ AuthStorage.create()
    + │  ├─ createCodingTools()
    + │  └─ new Services()
    + ├─ services.boot()
      ├─ if options.sessionId == null
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(id)
  `);
});

test("kotlin: this.method resolves to Class.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Runner {
        fun start() {
          this.prepare()
    +     this.validate()
          this.run()
        }

        fun prepare() {}
    +   fun validate() {}
        fun run() {}
      }
    `,
    "Runner.start",
    { file: "runner.kt" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});
