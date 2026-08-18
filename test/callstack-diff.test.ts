import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("refactors calls into a helper, preserves if/else branch labels", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export class PiService {
         static createAgentSession(options: { sessionId?: string }) {
           AuthStorage.create();
           new ModelRegistry();
           createCodingTools();
           if (!options.sessionId) {
             SessionManager.create();
           } else {
             SessionManager.open(options.sessionId);
           }
         }
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
      
       function createCodingTools() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export class PiService {
         static createAgentSession(options: { sessionId?: string }) {
           const services = PiService.getServices();
           services.boot();
           if (!options.sessionId) {
             SessionManager.create();
           } else {
             SessionManager.open(options.sessionId);
           }
         }
      
         static getServices() {
           SettingsManager.create();
           AuthStorage.create();
           new ModelRegistry();
           createCodingTools();
           return { boot() {} };
         }
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
      
       class SettingsManager {
         static create() {}
       }
      
       function createCodingTools() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e PiService.createAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function boot() {
         loadConfig();
         connect();
       }
      
       function loadConfig() {}
       function connect() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function boot() {
         loadConfig();
         migrate();
         connect();
       }
      
       function loadConfig() {}
       function migrate() {}
       function connect() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ loadConfig()
    + ├─ migrate()
      └─ connect()
  `));
});

test("shows ClassName.method labels for this.method calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export class Runner {
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
    "/file.ts": src`
       export class Runner {
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

test("labels else-if chains from source text", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function handle(status: string) {
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
    "/file.ts": src`
       export function handle(status: string) {
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

test("marks a fully removed callee subtree", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function main() {
         setup();
         work();
       }
      
       function setup() {
         initDb();
       }
      
       function initDb() {}
       function work() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function main() {
         work();
       }
       function work() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e main`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      main()
    - ├─ setup()
    - │  └─ initDb()
      └─ work()
  `));
});

test("resolves optional chaining as a normal call", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function boot(svc?: { start(): void }) {
         svc?.start();
       }
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function boot(svc?: { start(): void }) {
         svc?.start();
         foo?.bar();
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot(svc)
      ├─ svc.start()
    + └─ foo.bar()
  `));
});

test("indexes and expands #private methods", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export class Vault {
         open() {
           this.#unlock();
         }
         #unlock() {
           prep();
         }
       }
       function prep() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export class Vault {
         open() {
           this.#unlock();
         }
         #unlock() {
           prep();
           audit();
         }
       }
       function prep() {}
       function audit() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Vault.open`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Vault.open()
      └─ Vault.#unlock()
         ├─ prep()
    +    └─ audit()
  `));
});

test("follows class field arrow functions", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export class Runner {
         start() {
           this.helper();
         }
         helper = () => {
           work();
         };
       }
       function work() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export class Runner {
         start() {
           this.helper();
         }
         helper = () => {
           work();
           extra();
         };
       }
       function work() {}
       function extra() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.start()
      └─ Runner.helper()
         ├─ work()
    +    └─ extra()
  `));
});

test("does not attribute nested function bodies to the caller", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function outer() {
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
    "/file.ts": src`
       export function outer() {
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

test("treats tagged templates as calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function boot() {
         css\`color: red\`;
         work();
       }
       function css(_s: TemplateStringsArray) {}
       function work() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function boot() {
         css\`color: red\`;
         html\`<div/>\`;
         work();
       }
       function css(_s: TemplateStringsArray) {}
       function html(_s: TemplateStringsArray) {}
       function work() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ css(_s)
    + ├─ html(_s)
      └─ work()
  `));
});

test("extracts methods on abstract classes", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export abstract class Service {
         abstract prep(): void;
         start() {
           this.prep();
         }
       }
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export abstract class Service {
         abstract prep(): void;
         start() {
           this.prep();
           finish();
         }
       }
       function finish() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Service.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Service.start()
      ├─ Service.prep()
    + └─ finish()
  `));
});

test("expands new Class() through the constructor", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function make() {
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
    "/file.ts": src`
       export function make() {
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

test("follows const arrow function declarations", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export const boot = () => {
         load();
       };
       function load() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export const boot = () => {
         load();
         migrate();
       };
       function load() {}
       function migrate() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ load()
    + └─ migrate()
  `));
});

test("names anonymous default exports as default", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export default function () {
         work();
       }
       function work() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export default function () {
         work();
         extra();
       }
       function work() {}
       function extra() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e default`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      default()
      ├─ work()
    + └─ extra()
  `));
});

test("extracts generator function bodies", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function* gen() {
         yield work();
         done();
       }
       function work() { return 1; }
       function done() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
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

test("indexes getters and walks their bodies", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export class Config {
         get value() {
           load();
           return 1;
         }
       }
       function load() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export class Config {
         get value() {
           load();
           validate();
           return 1;
         }
       }
       function load() {}
       function validate() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Config.value`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Config.value()
      ├─ load()
    + └─ validate()
  `));
});

test("labels super.method as ClassName.method without linking base", () => {
  // super.setup() is keyed as Child.setup (current class), so Base.setup is not expanded.
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       class Base {
         setup() {
           prep();
         }
       }
       export class Child extends Base {
         start() {
           super.setup();
         }
       }
       function prep() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       class Base {
         setup() {
           prep();
         }
       }
       export class Child extends Base {
         start() {
           super.setup();
           work();
         }
       }
       function prep() {}
       function work() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Child.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Child.start()
      ├─ Child.setup()
    + └─ work()
  `));
});

test("collects calls inside try/catch/finally and loops", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
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
       }
       function open() {}
       function recover() {}
       function close() {}
       function visit(_item: string) {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
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
         while (pending()) {
           flush();
         }
       }
       function open() {}
       function recover() {}
       function close() {}
       function visit(_item: string) {}
       function pending() { return false; }
       function flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function run(obj: Record<string, Function>, key: string) {
         obj[key]();
         obj.known();
       }
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function run(obj: Record<string, Function>, key: string) {
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

test("marks recursive cycles with a turnstile", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function a() {
         b();
       }
       function b() {
         a();
       }
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function a() {
         b();
       }
       function b() {
         a();
         c();
       }
       function c() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e a`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      a()
      └─ b()
         ├─ a() ⇄
    +    └─ c()
  `));
});

test("truncates expansion at maxDepth", () => {
  // Deeper edits under c() are hidden once maxDepth stops expanding it.
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function a() {
         b();
       }
       function b() {
         c();
       }
       function c() {
         d();
       }
       function d() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function a() {
         b();
         extra();
       }
       function b() {
         c();
       }
       function c() {
         d();
         e();
       }
       function d() {}
       function e() {}
       function extra() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e a --max-depth 2`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      a()
      ├─ b()
      │  └─ c()
    + └─ extra()
  `));
});

test("LCS-aligns reordered sibling calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function boot() {
         first();
         second();
       }
       function first() {}
       function second() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function boot() {
         second();
         first();
       }
       function first() {}
       function second() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
    - ├─ first()
      ├─ second()
    + └─ first()
  `));
});

test("shows a newly introduced callee subtree as added", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/file.ts": src`
       export function main() {
         work();
       }
       function work() {}
    `,
  });
  const to = host.commit("after", {
    "/file.ts": src`
       export function main() {
         boot();
         work();
       }
      
       function boot() {
         setup();
       }
       function setup() {}
       function work() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e main`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      main()
    + ├─ boot()
    + │  └─ setup()
      └─ work()
  `));
});
