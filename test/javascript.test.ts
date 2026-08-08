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
