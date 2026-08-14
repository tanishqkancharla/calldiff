import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("scala: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.scala": before });
  const to = host.commit("after", { "/pi.scala": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Pi.createAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  `));
});

test("scala: this.method resolves to Class.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.scala": before });
  const to = host.commit("after", { "/runner.scala": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("scala: Maker() expands through object apply", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.scala": before });
  const to = host.commit("after", { "/ctor.scala": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Main.make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Main.make()
      └─ Maker()
         ├─ Maker.work()
    +    └─ Maker.ready()
  `));
});

test("scala: skips nested defs and lambdas", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.scala": before });
  const to = host.commit("after", { "/nested.scala": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Main.outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Main.outer()
      ├─ Main.visible()
    + └─ Main.alsoVisible()
  `));
});

test("scala: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.scala": before });
  const to = host.commit("after", { "/elif.scala": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Ctrl.handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Ctrl.handle(status)
      ├─ if (status == "a")
         └─ Ctrl.doA()
      ├─ else if (status == "b")
         ├─ Ctrl.doB()
    +    └─ Ctrl.doExtra()
      └─ else
         └─ Ctrl.doOther()
  `));
});

test("scala: try/catch/finally and match as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.scala": before });
  const to = host.commit("after", { "/ctrl.scala": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Ctrl.boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  `));
});

test("scala: object methods resolve as Type.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/object.scala": before });
  const to = host.commit("after", { "/object.scala": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Main.boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Main.boot()
      ├─ Helper.run()
      │  └─ Helper.go()
    + └─ Helper.extra()
    +    └─ Helper.more()
  `));
});
