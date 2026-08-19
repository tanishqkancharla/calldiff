import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("solidity: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.sol": src`
       function createAgentSession(bool ok) {
         authStorageCreate();
         createCodingTools();
         if (ok) {
           sessionManagerCreate();
         } else {
           sessionManagerOpen();
         }
       }
      
      
       function authStorageCreate() {}
       function createCodingTools() {}
       function sessionManagerCreate() {}
       function sessionManagerOpen() {}
    `,
  });
  const to = host.commit("after", {
    "/pi.sol": src`
       function createAgentSession(bool ok) {
         getServices();
         if (ok) {
           sessionManagerCreate();
         } else {
           sessionManagerOpen();
         }
       }
      
       function getServices() {
         authStorageCreate();
         createCodingTools();
       }
      
       function authStorageCreate() {}
       function createCodingTools() {}
       function sessionManagerCreate() {}
       function sessionManagerOpen() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/runner.sol": src`
       contract Runner {
           function start() public {
               this.prepare();
               this.run();
           }
           function prepare() public {}
           function run() public {}
       }
    `,
  });
  const to = host.commit("after", {
    "/runner.sol": src`
       contract Runner {
           function start() public {
               this.prepare();
               this.validate();
               this.run();
           }
           function prepare() public {}
           function validate() public {}
           function run() public {}
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

test("solidity: bare local calls resolve to Contract.fn", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/bare.sol": src`
       contract Svc {
           function start() public {
               prepare();
               run();
           }
           function prepare() public {}
           function run() public {}
       }
    `,
  });
  const to = host.commit("after", {
    "/bare.sol": src`
       contract Svc {
           function start() public {
               prepare();
               validate();
               run();
           }
           function prepare() public {}
           function validate() public {}
           function run() public {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Svc.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Svc.start()
      ├─ Svc.prepare()
    + ├─ Svc.validate()
      └─ Svc.run()
  `));
});

test("solidity: new Contract expands through constructor", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.sol": src`
       contract Thing {
           constructor() {
               init();
           }
           function init() private {}
       }
       function make() {
           new Thing();
       }
    `,
  });
  const to = host.commit("after", {
    "/ctor.sol": src`
       contract Thing {
           constructor() {
               init();
               ready();
           }
           function init() private {}
           function ready() private {}
       }
       function make() {
           new Thing();
           also();
       }
       function also() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      ├─ new Thing()
      │  ├─ Thing.init()
    + │  └─ Thing.ready()
    + └─ also()
  `));
});

test("solidity: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elseif.sol": src`
       contract Runner {
           function handle(uint x) public {
               if (x == 1) {
                   doA();
               } else if (x == 2) {
                   doB();
               } else {
                   doC();
               }
           }
           function doA() public {}
           function doB() public {}
           function doC() public {}
       }
    `,
  });
  const to = host.commit("after", {
    "/elseif.sol": src`
       contract Runner {
           function handle(uint x) public {
               if (x == 1) {
                   doA();
               } else if (x == 2) {
                   doB();
                   doExtra();
               } else {
                   doC();
               }
           }
           function doA() public {}
           function doB() public {}
           function doExtra() public {}
           function doC() public {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/ctorentry.sol": src`
       contract Thing {
           constructor() {
               init();
           }
           function init() private {}
       }
    `,
  });
  const to = host.commit("after", {
    "/ctorentry.sol": src`
       contract Thing {
           constructor() {
               init();
               ready();
           }
           function init() private {}
           function ready() private {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Thing.constructor`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      new Thing()
      ├─ Thing.init()
    + └─ Thing.ready()
  `));
});

test("solidity: this. + bare calls together", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/mix.sol": src`
       contract Mix {
           function boot() public {
               this.prepare();
               flush();
           }
           function prepare() public {}
           function flush() public {}
       }
    `,
  });
  const to = host.commit("after", {
    "/mix.sol": src`
       contract Mix {
           function boot() public {
               this.prepare();
               flush();
               finish();
           }
           function prepare() public {}
           function flush() public {}
           function finish() public {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Mix.boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Mix.boot()
      ├─ Mix.prepare()
      ├─ Mix.flush()
    + └─ Mix.finish()
  `));
});
