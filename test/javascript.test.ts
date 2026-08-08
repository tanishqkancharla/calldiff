import { test } from "./expectCallstack.js";

test("javascript: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "createAgentSession",
    { file: "pi.js" },
  ).toEqual(`
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
  `);
});

test("javascript: this.method resolves to Class.method", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Runner.start",
    { file: "runner.js" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});

test("javascript: new Class() expands through constructor", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "make",
    { file: "ctor.js" },
  ).toEqual(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `);
});

test("javascript: nested functions/arrows not attributed to caller", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "outer",
    { file: "nested.js" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `);
});

test("javascript: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "handle",
    { file: "elif.js" },
  ).toEqual(`
      handle(status)
      ├─ if (status === "a")
         └─ doA()
      ├─ else if (status === "b")
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doOther()
  `);
});

test("javascript: try/catch/finally and switch as branches", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "ctrl.js" },
  ).toEqual(`
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
  `);
});

test("javascript: ignores computed member calls", ({ expectCallstack }) => {
  expectCallstack(
    `
      function run(obj, key) {
        obj[key]();
        obj.known();
    +   obj.other();
      }
    `,
    "run",
    { file: "computed.js" },
  ).toEqual(`
      run(obj, key)
      ├─ obj.known()
    + └─ obj.other()
  `);
});

test("javascript: extracts generator and exported arrow bodies", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export function* gen() {
        yield work();
    +   yield extra();
        done();
      }
      function work() { return 1; }
    + function extra() { return 2; }
      function done() {}
    `,
    "gen",
    { file: "gen.js" },
  ).toEqual(`
      gen()
      ├─ work()
    + ├─ extra()
      └─ done()
  `);
});

test("javascript: follows export const arrow entrypoints", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export const boot = () => {
        load();
    +   migrate();
      };
      function load() {}
    + function migrate() {}
    `,
    "boot",
    { file: "boot.js" },
  ).toEqual(`
      boot()
      ├─ load()
    + └─ migrate()
  `);
});
