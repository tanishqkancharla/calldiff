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

test("swift: Thing() expands through init", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "make",
    { file: "ctor.swift" },
  ).toEqual(`
      make()
      └─ Thing()
         ├─ setup()
    +    └─ ready()
  `);
});

test("swift: skips nested functions and closures", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "outer",
    { file: "nested.swift" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `);
});

test("swift: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "handle",
    { file: "elif.swift" },
  ).toEqual(`
      handle(status)
      ├─ if status == "a"
         └─ doA()
      ├─ else if status == "b"
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doOther()
  `);
});

test("swift: do/catch and switch as branches", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "ctrl.swift" },
  ).toEqual(`
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
  `);
});

test("swift: static methods expand like Type.method", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "static.swift" },
  ).toEqual(`
      boot()
      ├─ Thing.make()
      │  └─ work()
    + └─ Thing.extra()
    +    └─ more()
  `);
});
