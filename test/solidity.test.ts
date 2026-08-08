import { test } from "./expectCallstack.js";

test("solidity: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      function createAgentSession(bool ok) {
    -   authStorageCreate();
    -   createCodingTools();
    +   getServices();
        if (ok) {
          sessionManagerCreate();
        } else {
          sessionManagerOpen();
        }
      }

    + function getServices() {
    +   authStorageCreate();
    +   createCodingTools();
    + }

      function authStorageCreate() {}
      function createCodingTools() {}
      function sessionManagerCreate() {}
      function sessionManagerOpen() {}
    `,
    "createAgentSession",
    { file: "pi.sol" },
  ).toEqual(`
      createAgentSession(ok)
    - ├─ authStorageCreate()
    - ├─ createCodingTools()
    + ├─ getServices()
    + │  ├─ authStorageCreate()
    + │  └─ createCodingTools()
      ├─ if ok
         └─ sessionManagerCreate()
      └─ else
         └─ sessionManagerOpen()
  `);
});

test("solidity: this.method resolves to Contract.method", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      contract Runner {
          function start() public {
              this.prepare();
    +         this.validate();
              this.run();
          }
          function prepare() public {}
    +     function validate() public {}
          function run() public {}
      }
    `,
    "Runner.start",
    { file: "runner.sol" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});
