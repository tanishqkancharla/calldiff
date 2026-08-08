import { test } from "./expectCallstack.js";

test("scala: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      object Pi {
        def createAgentSession(options: Options): Unit = {
    -     AuthStorage.create()
    -     createCodingTools()
    +     val services = getServices()
    +     services.boot()
          if (options.sessionId == null) {
            SessionManager.create()
          } else {
            SessionManager.open(options.sessionId)
          }
        }

    +   def getServices(): Services = {
    +     AuthStorage.create()
    +     createCodingTools()
    +     Services()
    +   }

        def createCodingTools(): Unit = {}
      }

      object SessionManager {
        def create(): Unit = {}
        def open(id: String): Unit = {}
      }

      object AuthStorage {
        def create(): Unit = {}
      }

    + class Services {
    +   def boot(): Unit = {}
    + }
    `,
    "Pi.createAgentSession",
    { file: "pi.scala" },
  ).toEqual(`
      Pi.createAgentSession(options)
    - ├─ AuthStorage.create()
    - ├─ Pi.createCodingTools()
    + ├─ Pi.getServices()
    + │  ├─ AuthStorage.create()
    + │  ├─ Pi.createCodingTools()
    + │  └─ new Services()
    + ├─ services.boot()
      ├─ if (options.sessionId == null)
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(id)
  `);
});

test("scala: this.method resolves to Class.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Runner {
        def start(): Unit = {
          this.prepare()
    +     this.validate()
          this.run()
        }

        def prepare(): Unit = {}
    +   def validate(): Unit = {}
        def run(): Unit = {}
      }
    `,
    "Runner.start",
    { file: "runner.scala" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});
