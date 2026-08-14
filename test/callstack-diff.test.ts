import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("refactors calls into a helper, preserves if/else branch labels", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export class PiService {
        static createAgentSession(options: { sessionId?: string }) {
    -     AuthStorage.create();
    -     new ModelRegistry();
    -     createCodingTools();
    +     const services = PiService.getServices();
    +     services.boot();
          if (!options.sessionId) {
            SessionManager.create();
          } else {
            SessionManager.open(options.sessionId);
          }
        }
    +
    +   static getServices() {
    +     SettingsManager.create();
    +     AuthStorage.create();
    +     new ModelRegistry();
    +     createCodingTools();
    +     return { boot() {} };
    +   }
      }

      class AuthStorage {
        static create() {}
      }

      class ModelRegistry {
        constructor() {}
      }

      class SessionManager {
        static create() {}
        static open(_id: string) {}
      }
    +
    + class SettingsManager {
    +   static create() {}
    + }

      function createCodingTools() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e PiService.createAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      PiService.createAgentSession(options)
    - ├─ AuthStorage.create()
    - ├─ new ModelRegistry()
    - ├─ createCodingTools()
    + ├─ PiService.getServices()
    + │  ├─ SettingsManager.create()
    + │  ├─ AuthStorage.create()
    + │  ├─ new ModelRegistry()
    + │  └─ createCodingTools()
    + ├─ services.boot()
      ├─ if (!options.sessionId)
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(_id)
  `));
});

test("adds and removes free function calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function boot() {
        loadConfig();
    +   migrate();
        connect();
      }

      function loadConfig() {}
    + function migrate() {}
      function connect() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ loadConfig()
    + ├─ migrate()
      └─ connect()
  `));
});

test("shows ClassName.method labels for this.method calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export class Runner {
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
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("labels else-if chains from source text", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function handle(status: string) {
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
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

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

test("marks a fully removed callee subtree", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function main() {
    -   setup();
        work();
      }
    -
    - function setup() {
    -   initDb();
    - }
    -
    - function initDb() {}
      function work() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e main`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      main()
    - ├─ setup()
    - │  └─ initDb()
      └─ work()
  `));
});

test("resolves optional chaining as a normal call", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function boot(svc?: { start(): void }) {
        svc?.start();
    +   foo?.bar();
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(svc)
      ├─ svc.start()
    + └─ foo.bar()
  `));
});

test("indexes and expands #private methods", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export class Vault {
        open() {
          this.#unlock();
        }
        #unlock() {
          prep();
    +     audit();
        }
      }
      function prep() {}
    + function audit() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Vault.open`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Vault.open()
      └─ Vault.#unlock()
         ├─ prep()
    +    └─ audit()
  `));
});

test("follows class field arrow functions", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export class Runner {
        start() {
          this.helper();
        }
        helper = () => {
          work();
    +     extra();
        };
      }
      function work() {}
    + function extra() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      └─ Runner.helper()
         ├─ work()
    +    └─ extra()
  `));
});

test("does not attribute nested function bodies to the caller", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function outer() {
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
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `));
});

test("treats tagged templates as calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function boot() {
        css\`color: red\`;
    +   html\`<div/>\`;
        work();
      }
      function css(_s: TemplateStringsArray) {}
    + function html(_s: TemplateStringsArray) {}
      function work() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ css(_s)
    + ├─ html(_s)
      └─ work()
  `));
});

test("extracts methods on abstract classes", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export abstract class Service {
        abstract prep(): void;
        start() {
          this.prep();
    +     finish();
        }
      }
    + function finish() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Service.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Service.start()
      ├─ Service.prep()
    + └─ finish()
  `));
});

test("expands new Class() through the constructor", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function make() {
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
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("follows const arrow function declarations", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export const boot = () => {
        load();
    +   migrate();
      };
      function load() {}
    + function migrate() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ load()
    + └─ migrate()
  `));
});

test("names anonymous default exports as default", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export default function () {
        work();
    +   extra();
      }
      function work() {}
    + function extra() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e default`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      default()
      ├─ work()
    + └─ extra()
  `));
});

test("extracts generator function bodies", () => {
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
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e gen`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      gen()
      ├─ work()
    + ├─ extra()
      └─ done()
  `));
});

test("indexes getters and walks their bodies", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export class Config {
        get value() {
          load();
    +     validate();
          return 1;
        }
      }
      function load() {}
    + function validate() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Config.value`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Config.value()
      ├─ load()
    + └─ validate()
  `));
});

test("labels super.method as ClassName.method without linking base", () => {
  // super.setup() is keyed as Child.setup (current class), so Base.setup is not expanded.
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Base {
        setup() {
          prep();
        }
      }
      export class Child extends Base {
        start() {
          super.setup();
    +     work();
        }
      }
      function prep() {}
    + function work() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Child.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Child.start()
      ├─ Child.setup()
    + └─ work()
  `));
});

test("collects calls inside try/catch/finally and loops", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function boot(items: string[]) {
        try {
          open();
        } catch {
          recover();
        } finally {
          close();
        }
        for (const item of items) {
          visit(item);
        }
    +   while (pending()) {
    +     flush();
    +   }
      }
      function open() {}
      function recover() {}
      function close() {}
      function visit(_item: string) {}
    + function pending() { return false; }
    + function flush() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(items)
      ├─ open()
      ├─ recover()
      ├─ close()
      ├─ visit(_item)
    + ├─ pending()
    + └─ flush()
  `));
});

test("ignores computed member calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function run(obj: Record<string, Function>, key: string) {
        obj[key]();
        obj.known();
    +   obj.other();
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      run(obj, key)
      ├─ obj.known()
    + └─ obj.other()
  `));
});

test("marks recursive cycles with a turnstile", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function a() {
        b();
      }
      function b() {
        a();
    +   c();
      }
    + function c() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e a`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      a()
      └─ b()
         ├─ a() ⇄
    +    └─ c()
  `));
});

test("truncates expansion at maxDepth", () => {
  // Deeper edits under c() are hidden once maxDepth stops expanding it.
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function a() {
        b();
    +   extra();
      }
      function b() {
        c();
      }
      function c() {
        d();
    +   e();
      }
      function d() {}
    + function e() {}
    + function extra() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e a --max-depth 2`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      a()
      ├─ b()
      │  └─ c()
    + └─ extra()
  `));
});

test("LCS-aligns reordered sibling calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function boot() {
    -   first();
        second();
    +   first();
      }
      function first() {}
      function second() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
    - ├─ first()
      ├─ second()
    + └─ first()
  `));
});

test("shows a newly introduced callee subtree as added", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function main() {
    +   boot();
        work();
      }
    +
    + function boot() {
    +   setup();
    + }
    + function setup() {}
      function work() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/file.ts": before });
  const to = host.commit("after", { "/file.ts": after });

  const result = host.run(`calldiff diff ${from} ${to} -e main`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      main()
    + ├─ boot()
    + │  └─ setup()
      └─ work()
  `));
});
