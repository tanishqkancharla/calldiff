import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("solidity: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.sol": before });
  const to = host.commit("after", { "/pi.sol": after });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  `));
});

test("solidity: this.method resolves to Contract.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.sol": before });
  const to = host.commit("after", { "/runner.sol": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("solidity: bare local calls resolve to Contract.fn", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/bare.sol": before });
  const to = host.commit("after", { "/bare.sol": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Svc.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Svc.start()
      ├─ Svc.prepare()
    + ├─ Svc.validate()
      └─ Svc.run()
  `));
});

test("solidity: new Contract expands through constructor", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.sol": before });
  const to = host.commit("after", { "/ctor.sol": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      ├─ new Thing()
      │  ├─ Thing.init()
    + │  └─ Thing.ready()
    + └─ also()
  `));
});

test("solidity: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elseif.sol": before });
  const to = host.commit("after", { "/elseif.sol": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.handle(x)
      ├─ if x == 1
         └─ Runner.doA()
      ├─ else if x == 2
         ├─ Runner.doB()
    +    └─ Runner.doExtra()
      └─ else
         └─ Runner.doC()
  `));
});

test("solidity: constructor entrypoint body", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      contract Thing {
          constructor() {
              init();
    +         ready();
          }
          function init() private {}
    +     function ready() private {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctorentry.sol": before });
  const to = host.commit("after", { "/ctorentry.sol": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Thing.constructor`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      new Thing()
      ├─ Thing.init()
    + └─ Thing.ready()
  `));
});

test("solidity: this. + bare calls together", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/mix.sol": before });
  const to = host.commit("after", { "/mix.sol": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Mix.boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Mix.boot()
      ├─ Mix.prepare()
      ├─ Mix.flush()
    + └─ Mix.finish()
  `));
});
