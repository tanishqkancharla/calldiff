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

test("scala: Maker() expands through object apply", ({ expectCallstack }) => {
  expectCallstack(
    `
      object Main {
        def make(): Unit = {
          Maker()
        }
      }
      object Maker {
        def apply(): Maker.type = {
          work()
    +     ready()
          this
        }
        def work(): Unit = {}
    +   def ready(): Unit = {}
      }
    `,
    "Main.make",
    { file: "ctor.scala" },
  ).toEqual(`
      Main.make()
      └─ Maker()
         ├─ Maker.work()
    +    └─ Maker.ready()
  `);
});

test("scala: skips nested defs and lambdas", ({ expectCallstack }) => {
  expectCallstack(
    `
      object Main {
        def outer(): Unit = {
          def nested(): Unit = { hidden() }
          val f = () => alsoHidden()
          visible()
    +     alsoVisible()
        }
        def hidden(): Unit = {}
        def alsoHidden(): Unit = {}
        def visible(): Unit = {}
    +   def alsoVisible(): Unit = {}
      }
    `,
    "Main.outer",
    { file: "nested.scala" },
  ).toEqual(`
      Main.outer()
      ├─ Main.visible()
    + └─ Main.alsoVisible()
  `);
});

test("scala: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
      object Ctrl {
        def handle(status: String): Unit = {
          if (status == "a") {
            doA()
          } else if (status == "b") {
            doB()
    +       doExtra()
          } else {
            doOther()
          }
        }
        def doA(): Unit = {}
        def doB(): Unit = {}
    +   def doExtra(): Unit = {}
        def doOther(): Unit = {}
      }
    `,
    "Ctrl.handle",
    { file: "elif.scala" },
  ).toEqual(`
      Ctrl.handle(status)
      ├─ if (status == "a")
         └─ Ctrl.doA()
      ├─ else if (status == "b")
         ├─ Ctrl.doB()
    +    └─ Ctrl.doExtra()
      └─ else
         └─ Ctrl.doOther()
  `);
});

test("scala: try/catch/finally and match as branches", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      object Ctrl {
        def boot(x: Int): Unit = {
          try {
            openIt()
          } catch {
            case e: Exception => recover()
          } finally {
            closeIt()
          }
          x match {
            case 1 => doA()
            case _ => doOther()
          }
    +     flush()
        }
        def openIt(): Unit = {}
        def recover(): Unit = {}
        def closeIt(): Unit = {}
        def doA(): Unit = {}
        def doOther(): Unit = {}
    +   def flush(): Unit = {}
      }
    `,
    "Ctrl.boot",
    { file: "ctrl.scala" },
  ).toEqual(`
      Ctrl.boot(x)
      ├─ try
         └─ Ctrl.openIt()
      ├─ catch e: Exception
         └─ Ctrl.recover()
      ├─ finally
         └─ Ctrl.closeIt()
      ├─ case 1
         └─ Ctrl.doA()
      ├─ case _
         └─ Ctrl.doOther()
    + └─ Ctrl.flush()
  `);
});

test("scala: object methods resolve as Type.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      object Main {
        def boot(): Unit = {
          Helper.run()
    +     Helper.extra()
        }
      }
      object Helper {
        def run(): Unit = {
          go()
        }
    +   def extra(): Unit = {
    +     more()
    +   }
        def go(): Unit = {}
    +   def more(): Unit = {}
      }
    `,
    "Main.boot",
    { file: "object.scala" },
  ).toEqual(`
      Main.boot()
      ├─ Helper.run()
      │  └─ Helper.go()
    + └─ Helper.extra()
    +    └─ Helper.more()
  `);
});
