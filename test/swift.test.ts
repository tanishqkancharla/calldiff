import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("swift: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.swift": before });
  const to = host.commit("after", { "/pi.swift": after });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  `));
});

test("swift: self.method resolves to Class.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.swift": before });
  const to = host.commit("after", { "/runner.swift": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("swift: Thing() expands through init", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      func make() {
        Thing()
      }
      class Thing {
        init() {
          setup()
    +     ready()
        }
      }
      func setup() {}
    + func ready() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.swift": before });
  const to = host.commit("after", { "/ctor.swift": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      └─ Thing()
         ├─ setup()
    +    └─ ready()
  `));
});

test("swift: skips nested functions and closures", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      func outer() {
        func nested() { hidden() }
        let f = { alsoHidden() }
        visible()
    +   alsoVisible()
      }
      func hidden() {}
      func alsoHidden() {}
      func visible() {}
    + func alsoVisible() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.swift": before });
  const to = host.commit("after", { "/nested.swift": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `));
});

test("swift: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      func handle(status: String) {
        if status == "a" {
          doA()
        } else if status == "b" {
          doB()
    +     doExtra()
        } else {
          doOther()
        }
      }
      func doA() {}
      func doB() {}
    + func doExtra() {}
      func doOther() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.swift": before });
  const to = host.commit("after", { "/elif.swift": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(status)
      ├─ if status == "a"
         └─ doA()
      ├─ else if status == "b"
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doOther()
  `));
});

test("swift: do/catch and switch as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      func boot(x: Int) {
        do {
          try openIt()
        } catch {
          recover()
        }
        switch x {
        case 1:
          doA()
        default:
          doOther()
        }
    +   flush()
      }
      func openIt() {}
      func recover() {}
      func doA() {}
      func doOther() {}
    + func flush() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.swift": before });
  const to = host.commit("after", { "/ctrl.swift": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(x)
      ├─ do
         └─ openIt()
      ├─ catch
         └─ recover()
      ├─ case 1
         └─ doA()
      ├─ default
         └─ doOther()
    + └─ flush()
  `));
});

test("swift: static methods expand like Type.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      func boot() {
        Thing.make()
    +   Thing.extra()
      }
      class Thing {
        static func make() {
          work()
        }
    +   static func extra() {
    +     more()
    +   }
      }
      func work() {}
    + func more() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/static.swift": before });
  const to = host.commit("after", { "/static.swift": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ Thing.make()
      │  └─ work()
    + └─ Thing.extra()
    +    └─ more()
  `));
});
