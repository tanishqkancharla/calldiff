import { test } from "./expectCallstack.js";

test("swift: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      func createAgentSession(options: Options) {
    -   AuthStorage.create()
    -   createCodingTools()
    +   let services = getServices()
    +   services.boot()
        if options.sessionId == nil {
          SessionManager.create()
        } else {
          SessionManager.open(options.sessionId)
        }
      }

    + func getServices() -> Services {
    +   AuthStorage.create()
    +   createCodingTools()
    +   return Services()
    + }

      func createCodingTools() {}

      class SessionManager {
        static func create() {}
        static func open(id: String) {}
      }

      class AuthStorage {
        static func create() {}
      }

    + class Services {
    +   func boot() {}
    + }
    `,
    "createAgentSession",
    { file: "pi.swift" },
  ).toEqual(`
      createAgentSession(options)
    - ├─ AuthStorage.create()
    - ├─ createCodingTools()
    + ├─ getServices()
    + │  ├─ AuthStorage.create()
    + │  ├─ createCodingTools()
    + │  └─ new Services()
    + ├─ services.boot()
      ├─ if options.sessionId == nil
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(id)
  `);
});

test("swift: self.method resolves to Class.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Runner {
        func start() {
          self.prepare()
    +     self.validate()
          self.run()
        }

        func prepare() {}
    +   func validate() {}
        func run() {}
      }
    `,
    "Runner.start",
    { file: "runner.swift" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});
