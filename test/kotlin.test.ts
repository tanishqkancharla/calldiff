import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("kotlin: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.kt": src`
       fun createAgentSession(options: Options) {
         AuthStorage.create()
         createCodingTools()
         if (options.sessionId == null) {
           SessionManager.create()
         } else {
           SessionManager.open(options.sessionId)
         }
       }
      
      
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
    `,
  });
  const to = host.commit("after", {
    "/pi.kt": src`
       fun createAgentSession(options: Options) {
         val services = getServices()
         services.boot()
         if (options.sessionId == null) {
           SessionManager.create()
         } else {
           SessionManager.open(options.sessionId)
         }
       }
      
       fun getServices(): Services {
         AuthStorage.create()
         createCodingTools()
         return Services()
       }
      
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
      
       class Services {
         fun boot() {}
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
      ├─ if options.sessionId == null
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(id)
  `));
});

test("kotlin: this.method resolves to Class.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.kt": src`
       class Runner {
         fun start() {
           this.prepare()
           this.run()
         }
      
         fun prepare() {}
         fun run() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/runner.kt": src`
       class Runner {
         fun start() {
           this.prepare()
           this.validate()
           this.run()
         }
      
         fun prepare() {}
         fun validate() {}
         fun run() {}
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

test("kotlin: Thing() expands through init block", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.kt": src`
       fun make() {
         Thing()
       }
       class Thing {
         init {
           setup()
         }
       }
       fun setup() {}
    `,
  });
  const to = host.commit("after", {
    "/ctor.kt": src`
       fun make() {
         Thing()
       }
       class Thing {
         init {
           setup()
           ready()
         }
       }
       fun setup() {}
       fun ready() {}
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

test("kotlin: skips nested functions and lambdas", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.kt": src`
       fun outer() {
         fun nested() { hidden() }
         val f = { alsoHidden() }
         visible()
       }
       fun hidden() {}
       fun alsoHidden() {}
       fun visible() {}
    `,
  });
  const to = host.commit("after", {
    "/nested.kt": src`
       fun outer() {
         fun nested() { hidden() }
         val f = { alsoHidden() }
         visible()
         alsoVisible()
       }
       fun hidden() {}
       fun alsoHidden() {}
       fun visible() {}
       fun alsoVisible() {}
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

test("kotlin: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.kt": src`
       fun handle(status: String) {
         if (status == "a") {
           doA()
         } else if (status == "b") {
           doB()
         } else {
           doOther()
         }
       }
       fun doA() {}
       fun doB() {}
       fun doOther() {}
    `,
  });
  const to = host.commit("after", {
    "/elif.kt": src`
       fun handle(status: String) {
         if (status == "a") {
           doA()
         } else if (status == "b") {
           doB()
           doExtra()
         } else {
           doOther()
         }
       }
       fun doA() {}
       fun doB() {}
       fun doExtra() {}
       fun doOther() {}
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

test("kotlin: try/catch/finally and when as branches", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.kt": src`
       fun boot(x: Int) {
         try {
           openIt()
         } catch (e: Exception) {
           recover()
         } finally {
           closeIt()
         }
         when (x) {
           1 -> doA()
           else -> doOther()
         }
       }
       fun openIt() {}
       fun recover() {}
       fun closeIt() {}
       fun doA() {}
       fun doOther() {}
    `,
  });
  const to = host.commit("after", {
    "/ctrl.kt": src`
       fun boot(x: Int) {
         try {
           openIt()
         } catch (e: Exception) {
           recover()
         } finally {
           closeIt()
         }
         when (x) {
           1 -> doA()
           else -> doOther()
         }
         flush()
       }
       fun openIt() {}
       fun recover() {}
       fun closeIt() {}
       fun doA() {}
       fun doOther() {}
       fun flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot(x)
      ├─ try
         └─ openIt()
      ├─ catch Exception
         └─ recover()
      ├─ finally
         └─ closeIt()
      ├─ case 1
         └─ doA()
      ├─ else
         └─ doOther()
    + └─ flush()
  `));
});

test("kotlin: companion object and object methods", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/companion.kt": src`
       fun boot() {
         Helper.run()
         Thing.make()
       }
       object Helper {
         fun run() {
           go()
         }
       }
       class Thing {
         companion object {
           fun make() {
             work()
           }
         }
       }
       fun go() {}
       fun work() {}
    `,
  });
  const to = host.commit("after", {
    "/companion.kt": src`
       fun boot() {
         Helper.run()
         Thing.make()
         Thing.extra()
       }
       object Helper {
         fun run() {
           go()
         }
       }
       class Thing {
         companion object {
           fun make() {
             work()
           }
           fun extra() {
             more()
           }
         }
       }
       fun go() {}
       fun work() {}
       fun more() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ Helper.run()
      │  └─ go()
      ├─ Thing.make()
      │  └─ work()
    + └─ Thing.extra()
    +    └─ more()
  `));
});

test("kotlin: trailing-lambda body nests under the receiving call", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/lambda.kt": src`
       fun work() {}
    `,
  });
  const to = host.commit("after", {
    "/lambda.kt": src`
       fun outer() {
         runBlocking {
           work()
         }
       }
       fun work() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
    + outer()
    + └─ runBlocking()
    +    └─ work()
  `));
});

test("kotlin: nested trailing lambdas nest transitively", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested-lambda.kt": src`
       fun work() {}
    `,
  });
  const to = host.commit("after", {
    "/nested-lambda.kt": src`
       fun outer() {
         wrap {
           use {
             work()
           }
         }
       }
       fun work() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
    + outer()
    + └─ wrap()
    +    └─ use()
    +       └─ work()
  `));
});

test("kotlin: parenthesized lambda argument nests under the call", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/paren-lambda.kt": src`
       fun work() {}
    `,
  });
  const to = host.commit("after", {
    "/paren-lambda.kt": src`
       fun outer() {
         submit(3, { work() })
       }
       fun work() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
    + outer()
    + └─ submit()
    +    └─ work()
  `));
});

test("kotlin: call added inside an existing lambda diffs as an added child", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/lambda-diff.kt": src`
       fun outer() {
         runBlocking {
           work()
         }
       }
       fun work() {}
    `,
  });
  const to = host.commit("after", {
    "/lambda-diff.kt": src`
       fun outer() {
         runBlocking {
           work()
           extra()
         }
       }
       fun work() {}
       fun extra() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      outer()
      └─ runBlocking()
         ├─ work()
    +    └─ extra()
  `));
});

test("kotlin: args plus trailing lambda keeps the call and nests the body", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/args-lambda.kt": src`
       fun handle(row: String) {}
    `,
  });
  const to = host.commit("after", {
    "/args-lambda.kt": src`
       fun outer(roots: List<String>) {
         store.read(roots) { row ->
           handle(row)
         }
       }
       fun handle(row: String) {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
    + outer(roots)
    + └─ store.read()
    +    └─ handle(row)
  `));
});
