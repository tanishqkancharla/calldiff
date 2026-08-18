import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("javascript: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.js": src`
       function createAgentSession(options) {
         AuthStorage.create();
         createCodingTools();
         if (!options.sessionId) {
           SessionManager.create();
         } else {
           SessionManager.open(options.sessionId);
         }
       }
      
      
       function createCodingTools() {}
    `,
  });
  const to = host.commit("after", {
    "/pi.js": src`
       function createAgentSession(options) {
         const services = getServices();
         services.boot();
         if (!options.sessionId) {
           SessionManager.create();
         } else {
           SessionManager.open(options.sessionId);
         }
       }
      
       function getServices() {
         AuthStorage.create();
         createCodingTools();
         return services;
       }
      
       function createCodingTools() {}
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
    + │  └─ createCodingTools()
    + ├─ services.boot()
      ├─ if (!options.sessionId)
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open()
  `));
});

test("javascript: this.method resolves to Class.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.js": src`
       class Runner {
         start() {
           this.prepare();
           this.run();
         }
         prepare() {}
         run() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/runner.js": src`
       class Runner {
         start() {
           this.prepare();
           this.validate();
           this.run();
         }
         prepare() {}
         validate() {}
         run() {}
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

test("javascript: new Class() expands through constructor", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.js": src`
       function make() {
         new Thing();
       }
       class Thing {
         constructor() {
           init();
         }
       }
       function init() {}
    `,
  });
  const to = host.commit("after", {
    "/ctor.js": src`
       function make() {
         new Thing();
       }
       class Thing {
         constructor() {
           init();
           ready();
         }
       }
       function init() {}
       function ready() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("javascript: nested functions/arrows not attributed to caller", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.js": src`
       function outer() {
         function inner() {
           hidden();
         }
         const f = () => {
           alsoHidden();
         };
         visible();
       }
       function hidden() {}
       function alsoHidden() {}
       function visible() {}
    `,
  });
  const to = host.commit("after", {
    "/nested.js": src`
       function outer() {
         function inner() {
           hidden();
         }
         const f = () => {
           alsoHidden();
         };
         visible();
         alsoVisible();
       }
       function hidden() {}
       function alsoHidden() {}
       function visible() {}
       function alsoVisible() {}
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

test("javascript: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.js": src`
       function handle(status) {
         if (status === "a") {
           doA();
         } else if (status === "b") {
           doB();
         } else {
           doOther();
         }
       }
       function doA() {}
       function doB() {}
       function doOther() {}
    `,
  });
  const to = host.commit("after", {
    "/elif.js": src`
       function handle(status) {
         if (status === "a") {
           doA();
         } else if (status === "b") {
           doB();
           doExtra();
         } else {
           doOther();
         }
       }
       function doA() {}
       function doB() {}
       function doExtra() {}
       function doOther() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.js": src`
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
       }
       function open() {}
       function recover() {}
       function close() {}
       function doA() {}
       function doOther() {}
    `,
  });
  const to = host.commit("after", {
    "/ctrl.js": src`
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
         flush();
       }
       function open() {}
       function recover() {}
       function close() {}
       function doA() {}
       function doOther() {}
       function flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/computed.js": src`
       function run(obj, key) {
         obj[key]();
         obj.known();
       }
    `,
  });
  const to = host.commit("after", {
    "/computed.js": src`
       function run(obj, key) {
         obj[key]();
         obj.known();
         obj.other();
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      run(obj, key)
      ├─ obj.known()
    + └─ obj.other()
  `));
});

test("javascript: extracts generator and exported arrow bodies", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/gen.js": src`
       export function* gen() {
         yield work();
         done();
       }
       function work() { return 1; }
       function done() {}
    `,
  });
  const to = host.commit("after", {
    "/gen.js": src`
       export function* gen() {
         yield work();
         yield extra();
         done();
       }
       function work() { return 1; }
       function extra() { return 2; }
       function done() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e gen`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      gen()
      ├─ work()
    + ├─ extra()
      └─ done()
  `));
});
