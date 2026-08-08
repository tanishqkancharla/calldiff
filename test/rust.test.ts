import { test } from "./expectCallstack.js";

test("rust: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      fn create_agent_session(options: Options) {
    -   auth_storage_create();
    -   create_coding_tools();
    +   let services = get_services();
    +   services.boot();
        if options.session_id.is_empty() {
            session_manager_create();
        } else {
            session_manager_open(options.session_id);
        }
      }

    + fn get_services() -> Services {
    +   auth_storage_create();
    +   create_coding_tools();
    +   Services {}
    + }

      fn auth_storage_create() {}
      fn create_coding_tools() {}
      fn session_manager_create() {}
      fn session_manager_open(_id: String) {}
    `,
    "create_agent_session",
    { file: "pi.rs" },
  ).toEqual(`
      create_agent_session(options)
    - ├─ auth_storage_create()
    - ├─ create_coding_tools()
    + ├─ get_services()
    + │  ├─ auth_storage_create()
    + │  └─ create_coding_tools()
    + ├─ services.boot()
      ├─ if options.session_id.is_empty()
         └─ session_manager_create()
      └─ else
         └─ session_manager_open(_id)
  `);
});

test("rust: self.method resolves to Type.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      struct Runner;

      impl Runner {
          fn start(&self) {
              self.prepare();
    +         self.validate();
              self.run();
          }
          fn prepare(&self) {}
    +     fn validate(&self) {}
          fn run(&self) {}
      }
    `,
    "Runner.start",
    { file: "runner.rs" },
  ).toEqual(`
      Runner.start(self)
      ├─ Runner.prepare(self)
    + ├─ Runner.validate(self)
      └─ Runner.run(self)
  `);
});

test("rust: Type::new expands through constructor body", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      fn make() {
          Thing::new();
      }

      struct Thing;

      impl Thing {
          fn new() -> Self {
              init();
    +         ready();
              Thing
          }
      }

      fn init() {}
    + fn ready() {}
    `,
    "make",
    { file: "ctor.rs" },
  ).toEqual(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `);
});

test("rust: closures not attributed to outer caller", ({ expectCallstack }) => {
  expectCallstack(
    `
      fn outer() {
          let f = || {
              hidden();
          };
          let _ = f;
          visible();
    +     also_visible();
      }
      fn hidden() {}
      fn visible() {}
    + fn also_visible() {}
    `,
    "outer",
    { file: "closures.rs" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `);
});

test("rust: else if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
      fn handle(status: i32) {
          if status == 1 {
              do_a();
          } else if status == 2 {
              do_b();
    +         do_extra();
          } else {
              do_other();
          }
      }
      fn do_a() {}
      fn do_b() {}
    + fn do_extra() {}
      fn do_other() {}
    `,
    "handle",
    { file: "elif.rs" },
  ).toEqual(`
      handle(status)
      ├─ if status == 1
         └─ do_a()
      ├─ else if status == 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `);
});

test("rust: match arms as branches", ({ expectCallstack }) => {
  expectCallstack(
    `
      fn boot(x: i32) {
          match x {
              1 => do_a(),
              _ => do_other(),
          }
    +     flush();
      }
      fn do_a() {}
      fn do_other() {}
    + fn flush() {}
    `,
    "boot",
    { file: "match.rs" },
  ).toEqual(`
      boot(x)
      ├─ case 1
         └─ do_a()
      ├─ case _
         └─ do_other()
    + └─ flush()
  `);
});

test("rust: async fn bodies and pub visibility still expand", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      pub async fn boot() {
          load().await;
    +     migrate().await;
          _helper();
      }
      async fn load() {}
    + async fn migrate() {}
      fn _helper() {}
    `,
    "boot",
    { file: "async.rs" },
  ).toEqual(`
      boot()
      ├─ load()
    + ├─ migrate()
      └─ _helper()
  `);
});

test("rust: Type::method scoped calls and ignores bare field reads", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      fn run() {
          Runner::start();
          obj.known();
    +     obj.other();
      }

      struct Runner;
      impl Runner {
          fn start() {
              prep();
    +         go();
          }
      }
      fn prep() {}
    + fn go() {}
    `,
    "run",
    { file: "scoped.rs" },
  ).toEqual(`
      run()
      ├─ Runner.start()
      │  ├─ prep()
    + │  └─ go()
      ├─ obj.known()
    + └─ obj.other()
  `);
});
