import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("javascript: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      function createAgentSession(options) {
    -   AuthStorage.create();
    -   createCodingTools();
    +   const services = getServices();
    +   services.boot();
        if (!options.sessionId) {
          SessionManager.create();
        } else {
          SessionManager.open(options.sessionId);
        }
      }

    + function getServices() {
    +   AuthStorage.create();
    +   createCodingTools();
    +   return services;
    + }

      function createCodingTools() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.js": before });
  const to = host.commit("after", { "/pi.js": after });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      createAgentSession(options)
    - ├─ AuthStorage.create()
    - ├─ createCodingTools()
    + ├─ getServices()
    + │  ├─ AuthStorage.create()
    + │  └─ createCodingTools()
    + ├─ services.boot()
      ├─ if (!options.sessionId)
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open()
  `));
});

test("javascript: this.method resolves to Class.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Runner {
        start() {
          this.prepare();
    +     this.validate();
          this.run();
        }
        prepare() {}
    +   validate() {}
        run() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.js": before });
  const to = host.commit("after", { "/runner.js": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("javascript: new Class() expands through constructor", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      function make() {
        new Thing();
      }
      class Thing {
        constructor() {
          init();
    +     ready();
        }
      }
      function init() {}
    + function ready() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.js": before });
  const to = host.commit("after", { "/ctor.js": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("javascript: nested functions/arrows not attributed to caller", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      function outer() {
        function inner() {
          hidden();
        }
        const f = () => {
          alsoHidden();
        };
        visible();
    +   alsoVisible();
      }
      function hidden() {}
      function alsoHidden() {}
      function visible() {}
    + function alsoVisible() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.js": before });
  const to = host.commit("after", { "/nested.js": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `));
});

test("javascript: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      function handle(status) {
        if (status === "a") {
          doA();
        } else if (status === "b") {
          doB();
    +     doExtra();
        } else {
          doOther();
        }
      }
      function doA() {}
      function doB() {}
    + function doExtra() {}
      function doOther() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.js": before });
  const to = host.commit("after", { "/elif.js": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(status)
      ├─ if (status === "a")
         └─ doA()
      ├─ else if (status === "b")
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doOther()
  `));
});

test("javascript: try/catch/finally and switch as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      function boot(x) {
        try {
          open();
        } catch (e) {
          recover();
        } finally {
          close();
        }
        switch (x) {
          case 1:
            doA();
            break;
          default:
            doOther();
        }
    +   flush();
      }
      function open() {}
      function recover() {}
      function close() {}
      function doA() {}
      function doOther() {}
    + function flush() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.js": before });
  const to = host.commit("after", { "/ctrl.js": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(x)
      ├─ try
         └─ open()
      ├─ catch (e)
         └─ recover()
      ├─ finally
         └─ close()
      ├─ case 1
         └─ doA()
      ├─ default
         └─ doOther()
    + └─ flush()
  `));
});

test("javascript: ignores computed member calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      function run(obj, key) {
        obj[key]();
        obj.known();
    +   obj.other();
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/computed.js": before });
  const to = host.commit("after", { "/computed.js": after });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      run(obj, key)
      ├─ obj.known()
    + └─ obj.other()
  `));
});

test("javascript: extracts generator and exported arrow bodies", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function* gen() {
        yield work();
    +   yield extra();
        done();
      }
      function work() { return 1; }
    + function extra() { return 2; }
      function done() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/gen.js": before });
  const to = host.commit("after", { "/gen.js": after });

  const result = host.run(`calldiff diff ${from} ${to} -e gen`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      gen()
      ├─ work()
    + ├─ extra()
      └─ done()
  `));
});
