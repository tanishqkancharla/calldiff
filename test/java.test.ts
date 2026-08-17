import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("java: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Pi.java": src`
       class Pi {
         void createAgentSession(Options options) {
           AuthStorage.create();
           createCodingTools();
           if (options.sessionId == null) {
             SessionManager.create();
           } else {
             SessionManager.open(options.sessionId);
           }
         }
      
       }
      
       class AuthStorage {
         static void create() {}
       }
       class SessionManager {
         static void create() {}
         static void open(String id) {}
       }
       class Options { String sessionId; }
       class Services { void boot() {} }
    `,
  });
  const to = host.commit("after", {
    "/Pi.java": src`
       class Pi {
         void createAgentSession(Options options) {
           Services services = this.getServices();
           services.boot();
           if (options.sessionId == null) {
             SessionManager.create();
           } else {
             SessionManager.open(options.sessionId);
           }
         }
      
         Services getServices() {
           AuthStorage.create();
           createCodingTools();
           return null;
         }
       }
      
       class AuthStorage {
         static void create() {}
       }
       class SessionManager {
         static void create() {}
         static void open(String id) {}
       }
       class Options { String sessionId; }
       class Services { void boot() {} }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Pi.createAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Pi.createAgentSession(options)
    - ├─ AuthStorage.create()
    - ├─ createCodingTools()
    + ├─ Pi.getServices()
    + │  ├─ AuthStorage.create()
    + │  └─ createCodingTools()
    + ├─ services.boot()
      ├─ if (options.sessionId == null)
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(id)
  `));
});

test("java: this.method resolves to Class.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Runner.java": src`
       class Runner {
         void start() {
           this.prepare();
           this.run();
         }
         void prepare() {}
         void run() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/Runner.java": src`
       class Runner {
         void start() {
           this.prepare();
           this.validate();
           this.run();
         }
         void prepare() {}
         void validate() {}
         void run() {}
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

test("java: new Class() expands through constructor", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Ctor.java": src`
       class Maker {
         void make() {
           new Thing();
         }
       }
       class Thing {
         Thing() {
           this.init();
         }
         void init() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/Ctor.java": src`
       class Maker {
         void make() {
           new Thing();
         }
       }
       class Thing {
         Thing() {
           this.init();
           this.ready();
         }
         void init() {}
         void ready() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Maker.make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Maker.make()
      └─ new Thing()
         ├─ Thing.init()
    +    └─ Thing.ready()
  `));
});

test("java: lambdas not attributed to outer caller", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Nested.java": src`
       class Outer {
         void outer() {
           Runnable r = () -> { hidden(); };
           visible();
         }
         void hidden() {}
         void visible() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/Nested.java": src`
       class Outer {
         void outer() {
           Runnable r = () -> { hidden(); };
           visible();
           alsoVisible();
         }
         void hidden() {}
         void visible() {}
         void alsoVisible() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Outer.outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Outer.outer()
      ├─ visible()
    + └─ alsoVisible()
  `));
});

test("java: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Elif.java": src`
       class Handler {
         void handle(int status) {
           if (status == 1) {
             doA();
           } else if (status == 2) {
             doB();
           } else {
             doOther();
           }
         }
         void doA() {}
         void doB() {}
         void doOther() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/Elif.java": src`
       class Handler {
         void handle(int status) {
           if (status == 1) {
             doA();
           } else if (status == 2) {
             doB();
             doExtra();
           } else {
             doOther();
           }
         }
         void doA() {}
         void doB() {}
         void doExtra() {}
         void doOther() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Handler.handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Handler.handle(status)
      ├─ if (status == 1)
         └─ doA()
      ├─ else if (status == 2)
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doOther()
  `));
});

test("java: try/catch/finally and switch as branches", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Ctrl.java": src`
       class Boot {
         void boot(int x) {
           try {
             open();
           } catch (Exception e) {
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
         }
         void open() {}
         void recover() {}
         void close() {}
         void doA() {}
         void doOther() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/Ctrl.java": src`
       class Boot {
         void boot(int x) {
           try {
             open();
           } catch (Exception e) {
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
           flush();
         }
         void open() {}
         void recover() {}
         void close() {}
         void doA() {}
         void doOther() {}
         void flush() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Boot.boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Boot.boot(x)
      ├─ try
         └─ open()
      ├─ catch (Exception)
         └─ recover()
      ├─ finally
         └─ close()
      ├─ case 1
         └─ doA()
      ├─ default
         └─ doOther()
    + └─ flush()
  `));
});

test("java: private methods still expand when called via this", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Private.java": src`
       class Vault {
         void open() {
           this.unlock();
         }
         private void unlock() {
           prep();
         }
         void prep() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/Private.java": src`
       class Vault {
         void open() {
           this.unlock();
         }
         private void unlock() {
           prep();
           audit();
         }
         void prep() {}
         void audit() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Vault.open`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Vault.open()
      └─ Vault.unlock()
         ├─ prep()
    +    └─ audit()
  `));
});

test("java: static Class.method calls expand", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Static.java": src`
       class App {
         void run() {
           Config.load();
         }
       }
       class Config {
         static void load() {
           read();
         }
         static void read() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/Static.java": src`
       class App {
         void run() {
           Config.load();
           Config.validate();
         }
       }
       class Config {
         static void load() {
           read();
         }
         static void validate() {
           check();
         }
         static void read() {}
         static void check() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e App.run`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      App.run()
      ├─ Config.load()
      │  └─ read()
    + └─ Config.validate()
    +    └─ check()
  `));
});
