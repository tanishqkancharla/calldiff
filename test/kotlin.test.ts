import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("kotlin: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.kt": before });
  const to = host.commit("after", { "/pi.kt": after });

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
      ├─ if options.sessionId == null
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(id)
  `));
});

test("kotlin: this.method resolves to Class.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.kt": before });
  const to = host.commit("after", { "/runner.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("kotlin: Thing() expands through init block", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fun make() {
        Thing()
      }
      class Thing {
        init {
          setup()
    +     ready()
        }
      }
      fun setup() {}
    + fun ready() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.kt": before });
  const to = host.commit("after", { "/ctor.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      └─ Thing()
         ├─ setup()
    +    └─ ready()
  `));
});

test("kotlin: skips nested functions and lambdas", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fun outer() {
        fun nested() { hidden() }
        val f = { alsoHidden() }
        visible()
    +   alsoVisible()
      }
      fun hidden() {}
      fun alsoHidden() {}
      fun visible() {}
    + fun alsoVisible() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.kt": before });
  const to = host.commit("after", { "/nested.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `));
});

test("kotlin: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fun handle(status: String) {
        if (status == "a") {
          doA()
        } else if (status == "b") {
          doB()
    +     doExtra()
        } else {
          doOther()
        }
      }
      fun doA() {}
      fun doB() {}
    + fun doExtra() {}
      fun doOther() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.kt": before });
  const to = host.commit("after", { "/elif.kt": after });

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

test("kotlin: try/catch/finally and when as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    +   flush()
      }
      fun openIt() {}
      fun recover() {}
      fun closeIt() {}
      fun doA() {}
      fun doOther() {}
    + fun flush() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.kt": before });
  const to = host.commit("after", { "/ctrl.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fun boot() {
        Helper.run()
        Thing.make()
    +   Thing.extra()
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
    +     fun extra() {
    +       more()
    +     }
        }
      }
      fun go() {}
      fun work() {}
    + fun more() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/companion.kt": before });
  const to = host.commit("after", { "/companion.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
    + fun outer() {
    +   runBlocking {
    +     work()
    +   }
    + }
      fun work() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/lambda.kt": before });
  const to = host.commit("after", { "/lambda.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
    + outer()
    + └─ runBlocking()
    +    └─ work()
  `));
});

test("kotlin: nested trailing lambdas nest transitively", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
    + fun outer() {
    +   wrap {
    +     use {
    +       work()
    +     }
    +   }
    + }
      fun work() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested-lambda.kt": before });
  const to = host.commit("after", { "/nested-lambda.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
    + outer()
    + └─ wrap()
    +    └─ use()
    +       └─ work()
  `));
});

test("kotlin: parenthesized lambda argument nests under the call", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
    + fun outer() {
    +   submit(3, { work() })
    + }
      fun work() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/paren-lambda.kt": before });
  const to = host.commit("after", { "/paren-lambda.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
    + outer()
    + └─ submit()
    +    └─ work()
  `));
});

test("kotlin: call added inside an existing lambda diffs as an added child", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fun outer() {
        runBlocking {
          work()
    +     extra()
        }
      }
      fun work() {}
    + fun extra() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/lambda-diff.kt": before });
  const to = host.commit("after", { "/lambda-diff.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      └─ runBlocking()
         ├─ work()
    +    └─ extra()
  `));
});

test("kotlin: args plus trailing lambda keeps the call and nests the body", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
    + fun outer(roots: List<String>) {
    +   store.read(roots) { row ->
    +     handle(row)
    +   }
    + }
      fun handle(row: String) {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/args-lambda.kt": before });
  const to = host.commit("after", { "/args-lambda.kt": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
    + outer(roots)
    + └─ store.read()
    +    └─ handle(row)
  `));
});
