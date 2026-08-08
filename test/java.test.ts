import { test } from "./expectCallstack.js";

test("java: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      class Pi {
        void createAgentSession(Options options) {
    -     AuthStorage.create();
    -     createCodingTools();
    +     Services services = this.getServices();
    +     services.boot();
          if (options.sessionId == null) {
            SessionManager.create();
          } else {
            SessionManager.open(options.sessionId);
          }
        }

    +   Services getServices() {
    +     AuthStorage.create();
    +     createCodingTools();
    +     return null;
    +   }
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
    "Pi.createAgentSession",
    { file: "Pi.java" },
  ).toEqual(`
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
  `);
});

test("java: this.method resolves to Class.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Runner {
        void start() {
          this.prepare();
    +     this.validate();
          this.run();
        }
        void prepare() {}
    +   void validate() {}
        void run() {}
      }
    `,
    "Runner.start",
    { file: "Runner.java" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});

test("java: new Class() expands through constructor", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      class Maker {
        void make() {
          new Thing();
        }
      }
      class Thing {
        Thing() {
          this.init();
    +     this.ready();
        }
        void init() {}
    +   void ready() {}
      }
    `,
    "Maker.make",
    { file: "Ctor.java" },
  ).toEqual(`
      Maker.make()
      └─ new Thing()
         ├─ Thing.init()
    +    └─ Thing.ready()
  `);
});

test("java: lambdas not attributed to outer caller", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Outer {
        void outer() {
          Runnable r = () -> { hidden(); };
          visible();
    +     alsoVisible();
        }
        void hidden() {}
        void visible() {}
    +   void alsoVisible() {}
      }
    `,
    "Outer.outer",
    { file: "Nested.java" },
  ).toEqual(`
      Outer.outer()
      ├─ visible()
    + └─ alsoVisible()
  `);
});

test("java: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Handler {
        void handle(int status) {
          if (status == 1) {
            doA();
          } else if (status == 2) {
            doB();
    +       doExtra();
          } else {
            doOther();
          }
        }
        void doA() {}
        void doB() {}
    +   void doExtra() {}
        void doOther() {}
      }
    `,
    "Handler.handle",
    { file: "Elif.java" },
  ).toEqual(`
      Handler.handle(status)
      ├─ if (status == 1)
         └─ doA()
      ├─ else if (status == 2)
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doOther()
  `);
});

test("java: try/catch/finally and switch as branches", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    +     flush();
        }
        void open() {}
        void recover() {}
        void close() {}
        void doA() {}
        void doOther() {}
    +   void flush() {}
      }
    `,
    "Boot.boot",
    { file: "Ctrl.java" },
  ).toEqual(`
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
  `);
});

test("java: private methods still expand when called via this", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      class Vault {
        void open() {
          this.unlock();
        }
        private void unlock() {
          prep();
    +     audit();
        }
        void prep() {}
    +   void audit() {}
      }
    `,
    "Vault.open",
    { file: "Private.java" },
  ).toEqual(`
      Vault.open()
      └─ Vault.unlock()
         ├─ prep()
    +    └─ audit()
  `);
});

test("java: static Class.method calls expand", ({ expectCallstack }) => {
  expectCallstack(
    `
      class App {
        void run() {
          Config.load();
    +     Config.validate();
        }
      }
      class Config {
        static void load() {
          read();
        }
    +   static void validate() {
    +     check();
    +   }
        static void read() {}
    +   static void check() {}
      }
    `,
    "App.run",
    { file: "Static.java" },
  ).toEqual(`
      App.run()
      ├─ Config.load()
      │  └─ read()
    + └─ Config.validate()
    +    └─ check()
  `);
});
