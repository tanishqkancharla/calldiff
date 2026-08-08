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

test("solidity: bare local calls resolve to Contract.fn", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      contract Svc {
          function start() public {
              prepare();
    +         validate();
              run();
          }
          function prepare() public {}
    +     function validate() public {}
          function run() public {}
      }
    `,
    "Svc.start",
    { file: "bare.sol" },
  ).toEqual(`
      Svc.start()
      ├─ Svc.prepare()
    + ├─ Svc.validate()
      └─ Svc.run()
  `);
});

test("solidity: new Contract expands through constructor", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      contract Thing {
          constructor() {
              init();
    +         ready();
          }
          function init() private {}
    +     function ready() private {}
      }
      function make() {
          new Thing();
    +     also();
      }
    + function also() {}
    `,
    "make",
    { file: "ctor.sol" },
  ).toEqual(`
      make()
      ├─ new Thing()
      │  ├─ Thing.init()
    + │  └─ Thing.ready()
    + └─ also()
  `);
});

test("solidity: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
      contract Runner {
          function handle(uint x) public {
              if (x == 1) {
                  doA();
              } else if (x == 2) {
                  doB();
    +             doExtra();
              } else {
                  doC();
              }
          }
          function doA() public {}
          function doB() public {}
    +     function doExtra() public {}
          function doC() public {}
      }
    `,
    "Runner.handle",
    { file: "elseif.sol" },
  ).toEqual(`
      Runner.handle(x)
      ├─ if x == 1
         └─ Runner.doA()
      ├─ else if x == 2
         ├─ Runner.doB()
    +    └─ Runner.doExtra()
      └─ else
         └─ Runner.doC()
  `);
});

test("solidity: constructor entrypoint body", ({ expectCallstack }) => {
  expectCallstack(
    `
      contract Thing {
          constructor() {
              init();
    +         ready();
          }
          function init() private {}
    +     function ready() private {}
      }
    `,
    "Thing.constructor",
    { file: "ctorentry.sol" },
  ).toEqual(`
      new Thing()
      ├─ Thing.init()
    + └─ Thing.ready()
  `);
});

test("solidity: this. + bare calls together", ({ expectCallstack }) => {
  expectCallstack(
    `
      contract Mix {
          function boot() public {
              this.prepare();
              flush();
    +         finish();
          }
          function prepare() public {}
          function flush() public {}
    +     function finish() public {}
      }
    `,
    "Mix.boot",
    { file: "mix.sol" },
  ).toEqual(`
      Mix.boot()
      ├─ Mix.prepare()
      ├─ Mix.flush()
    + └─ Mix.finish()
  `);
});
