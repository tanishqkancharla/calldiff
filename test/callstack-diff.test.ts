import { test } from "./expectCallstack.js";

test("refactors calls into a helper, preserves if/else branch labels", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "PiService.createAgentSession",
  ).toEqual(`
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
  `);
});

test("adds and removes free function calls", ({ expectCallstack }) => {
  expectCallstack(
    `
      export function boot() {
        loadConfig();
    +   migrate();
        connect();
      }

      function loadConfig() {}
    + function migrate() {}
      function connect() {}
    `,
    "boot",
  ).toEqual(`
      boot()
      ├─ loadConfig()
    + ├─ migrate()
      └─ connect()
  `);
});

test("shows ClassName.method labels for this.method calls", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Runner.start",
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});

test("labels else-if chains from source text", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "handle",
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

test("marks a fully removed callee subtree", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "main",
  ).toEqual(`
      main()
    - ├─ setup()
    - │  └─ initDb()
      └─ work()
  `);
});

test("resolves optional chaining as a normal call", ({ expectCallstack }) => {
  expectCallstack(
    `
      export function boot(svc?: { start(): void }) {
        svc?.start();
    +   foo?.bar();
      }
    `,
    "boot",
  ).toEqual(`
      boot(svc)
      ├─ svc.start()
    + └─ foo.bar()
  `);
});

test("indexes and expands #private methods", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Vault.open",
  ).toEqual(`
      Vault.open()
      └─ Vault.#unlock()
         ├─ prep()
    +    └─ audit()
  `);
});

test("follows class field arrow functions", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Runner.start",
  ).toEqual(`
      Runner.start()
      └─ Runner.helper()
         ├─ work()
    +    └─ extra()
  `);
});

test("does not attribute nested function bodies to the caller", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "outer",
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ alsoVisible()
  `);
});

test("treats tagged templates as calls", ({ expectCallstack }) => {
  expectCallstack(
    `
      export function boot() {
        css\`color: red\`;
    +   html\`<div/>\`;
        work();
      }
      function css(_s: TemplateStringsArray) {}
    + function html(_s: TemplateStringsArray) {}
      function work() {}
    `,
    "boot",
  ).toEqual(`
      boot()
      ├─ css(_s)
    + ├─ html(_s)
      └─ work()
  `);
});

test("extracts methods on abstract classes", ({ expectCallstack }) => {
  expectCallstack(
    `
      export abstract class Service {
        abstract prep(): void;
        start() {
          this.prep();
    +     finish();
        }
      }
    + function finish() {}
    `,
    "Service.start",
  ).toEqual(`
      Service.start()
      ├─ Service.prep()
    + └─ finish()
  `);
});

test("expands new Class() through the constructor", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "make",
  ).toEqual(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `);
});

test("follows const arrow function declarations", ({ expectCallstack }) => {
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
  ).toEqual(`
      boot()
      ├─ load()
    + └─ migrate()
  `);
});

test("names anonymous default exports as default", ({ expectCallstack }) => {
  expectCallstack(
    `
      export default function () {
        work();
    +   extra();
      }
      function work() {}
    + function extra() {}
    `,
    "default",
  ).toEqual(`
      default()
      ├─ work()
    + └─ extra()
  `);
});

test("extracts generator function bodies", ({ expectCallstack }) => {
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
  ).toEqual(`
      gen()
      ├─ work()
    + ├─ extra()
      └─ done()
  `);
});

test("indexes getters and walks their bodies", ({ expectCallstack }) => {
  expectCallstack(
    `
      export class Config {
        get value() {
          load();
    +     validate();
          return 1;
        }
      }
      function load() {}
    + function validate() {}
    `,
    "Config.value",
  ).toEqual(`
      Config.value()
      ├─ load()
    + └─ validate()
  `);
});

test("labels super.method as ClassName.method without linking base", ({
  expectCallstack,
}) => {
  // super.setup() is keyed as Child.setup (current class), so Base.setup is not expanded.
  expectCallstack(
    `
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
    `,
    "Child.start",
  ).toEqual(`
      Child.start()
      ├─ Child.setup()
    + └─ work()
  `);
});

test("collects calls inside try/catch/finally and loops", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "boot",
  ).toEqual(`
      boot(items)
      ├─ open()
      ├─ recover()
      ├─ close()
      ├─ visit(_item)
    + ├─ pending()
    + └─ flush()
  `);
});

test("ignores computed member calls", ({ expectCallstack }) => {
  expectCallstack(
    `
      export function run(obj: Record<string, Function>, key: string) {
        obj[key]();
        obj.known();
    +   obj.other();
      }
    `,
    "run",
  ).toEqual(`
      run(obj, key)
      ├─ obj.known()
    + └─ obj.other()
  `);
});

test("marks recursive cycles with a turnstile", ({ expectCallstack }) => {
  expectCallstack(
    `
      export function a() {
        b();
      }
      function b() {
        a();
    +   c();
      }
    + function c() {}
    `,
    "a",
  ).toEqual(`
      a()
      └─ b()
         ├─ a() ⇄
    +    └─ c()
  `);
});

test("truncates expansion at maxDepth", ({ expectCallstack }) => {
  // Deeper edits under c() are hidden once maxDepth stops expanding it.
  expectCallstack(
    `
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
    `,
    "a",
    { maxDepth: 2 },
  ).toEqual(`
      a()
      ├─ b()
      │  └─ c()
    + └─ extra()
  `);
});

test("LCS-aligns reordered sibling calls", ({ expectCallstack }) => {
  expectCallstack(
    `
      export function boot() {
    -   first();
        second();
    +   first();
      }
      function first() {}
      function second() {}
    `,
    "boot",
  ).toEqual(`
      boot()
    - ├─ first()
      ├─ second()
    + └─ first()
  `);
});

test("shows a newly introduced callee subtree as added", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "main",
  ).toEqual(`
      main()
    + ├─ boot()
    + │  └─ setup()
      └─ work()
  `);
});
