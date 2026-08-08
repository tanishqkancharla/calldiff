import { test } from "./test.js";

test("refactors calls into a helper, preserves if/else branch labels", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
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
    fixture`
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
    `,
  );
});

test("adds and removes free function calls", ({ fixture, expectCallstack }) => {
  expectCallstack(
    fixture`
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
    fixture`
      boot()
      ├─ loadConfig()
    + ├─ migrate()
      └─ connect()
    `,
  );
});

test("shows ClassName.method labels for this.method calls", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
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
    fixture`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
    `,
  );
});

test("labels else-if chains from source text", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
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
    fixture`
      handle(status)
      ├─ if (status === "a")
         └─ doA()
      ├─ else if (status === "b")
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doOther()
    `,
  );
});

test("marks a fully removed callee subtree", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
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
    fixture`
      main()
    - ├─ setup()
    - │  └─ initDb()
      └─ work()
    `,
  );
});

test("resolves optional chaining as a normal call", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
      export function boot(svc?: { start(): void }) {
        svc?.start();
    +   foo?.bar();
      }
    `,
    "boot",
    fixture`
      boot(svc)
      ├─ svc.start()
    + └─ foo.bar()
    `,
  );
});

test("indexes and expands #private methods", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
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
    fixture`
      Vault.open()
      └─ Vault.#unlock()
         ├─ prep()
    +    └─ audit()
    `,
  );
});

test("follows class field arrow functions", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
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
    fixture`
      Runner.start()
      └─ Runner.helper()
         ├─ work()
    +    └─ extra()
    `,
  );
});

test("does not attribute nested function bodies to the caller", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
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
    fixture`
      outer()
      ├─ visible()
    + └─ alsoVisible()
    `,
  );
});

test("treats tagged templates as calls", ({ fixture, expectCallstack }) => {
  expectCallstack(
    [
      "export function boot() {",
      "  css`color: red`;",
      "+ html`<div/>`;",
      "  work();",
      "}",
      "function css(_s: TemplateStringsArray) {}",
      "+ function html(_s: TemplateStringsArray) {}",
      "function work() {}",
    ].join("\n"),
    "boot",
    fixture`
      boot()
      ├─ css(_s)
    + ├─ html(_s)
      └─ work()
    `,
  );
});

test("extracts methods on abstract classes", ({
  fixture,
  expectCallstack,
}) => {
  expectCallstack(
    fixture`
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
    fixture`
      Service.start()
      ├─ Service.prep()
    + └─ finish()
    `,
  );
});
