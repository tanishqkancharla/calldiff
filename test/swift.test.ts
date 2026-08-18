import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("swift: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.swift": src`
       func createAgentSession(options: Options) {
         AuthStorage.create()
         createCodingTools()
         if options.sessionId == nil {
           SessionManager.create()
         } else {
           SessionManager.open(options.sessionId)
         }
       }
      
      
       func createCodingTools() {}
      
       class SessionManager {
         static func create() {}
         static func open(id: String) {}
       }
      
       class AuthStorage {
         static func create() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/pi.swift": src`
       func createAgentSession(options: Options) {
         let services = getServices()
         services.boot()
         if options.sessionId == nil {
           SessionManager.create()
         } else {
           SessionManager.open(options.sessionId)
         }
       }
      
       func getServices() -> Services {
         AuthStorage.create()
         createCodingTools()
         return Services()
       }
      
       func createCodingTools() {}
      
       class SessionManager {
         static func create() {}
         static func open(id: String) {}
       }
      
       class AuthStorage {
         static func create() {}
       }
      
       class Services {
         func boot() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/runner.swift": src`
       class Runner {
         func start() {
           self.prepare()
           self.run()
         }
      
         func prepare() {}
         func run() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/runner.swift": src`
       class Runner {
         func start() {
           self.prepare()
           self.validate()
           self.run()
         }
      
         func prepare() {}
         func validate() {}
         func run() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("swift: Thing() expands through init", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.swift": src`
       func make() {
         Thing()
       }
       class Thing {
         init() {
           setup()
         }
       }
       func setup() {}
    `,
  });
  const to = host.commit("after", {
    "/ctor.swift": src`
       func make() {
         Thing()
       }
       class Thing {
         init() {
           setup()
           ready()
         }
       }
       func setup() {}
       func ready() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      └─ Thing()
         ├─ setup()
    +    └─ ready()
  `));
});

test("swift: skips nested functions and closures", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.swift": src`
       func outer() {
         func nested() { hidden() }
         let f = { alsoHidden() }
         visible()
       }
       func hidden() {}
       func alsoHidden() {}
       func visible() {}
    `,
  });
  const to = host.commit("after", {
    "/nested.swift": src`
       func outer() {
         func nested() { hidden() }
         let f = { alsoHidden() }
         visible()
         alsoVisible()
       }
       func hidden() {}
       func alsoHidden() {}
       func visible() {}
       func alsoVisible() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `));
});

test("swift: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.swift": src`
       func handle(status: String) {
         if status == "a" {
           doA()
         } else if status == "b" {
           doB()
         } else {
           doOther()
         }
       }
       func doA() {}
       func doB() {}
       func doOther() {}
    `,
  });
  const to = host.commit("after", {
    "/elif.swift": src`
       func handle(status: String) {
         if status == "a" {
           doA()
         } else if status == "b" {
           doB()
           doExtra()
         } else {
           doOther()
         }
       }
       func doA() {}
       func doB() {}
       func doExtra() {}
       func doOther() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.swift": src`
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
       }
       func openIt() {}
       func recover() {}
       func doA() {}
       func doOther() {}
    `,
  });
  const to = host.commit("after", {
    "/ctrl.swift": src`
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
         flush()
       }
       func openIt() {}
       func recover() {}
       func doA() {}
       func doOther() {}
       func flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/static.swift": src`
       func boot() {
         Thing.make()
       }
       class Thing {
         static func make() {
           work()
         }
       }
       func work() {}
    `,
  });
  const to = host.commit("after", {
    "/static.swift": src`
       func boot() {
         Thing.make()
         Thing.extra()
       }
       class Thing {
         static func make() {
           work()
         }
         static func extra() {
           more()
         }
       }
       func work() {}
       func more() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ Thing.make()
      │  └─ work()
    + └─ Thing.extra()
    +    └─ more()
  `));
});
