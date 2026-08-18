import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("rust: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.rs": src`
       fn create_agent_session(options: Options) {
         auth_storage_create();
         create_coding_tools();
         if options.session_id.is_empty() {
             session_manager_create();
         } else {
             session_manager_open(options.session_id);
         }
       }
      
      
       fn auth_storage_create() {}
       fn create_coding_tools() {}
       fn session_manager_create() {}
       fn session_manager_open(_id: String) {}
    `,
  });
  const to = host.commit("after", {
    "/pi.rs": src`
       fn create_agent_session(options: Options) {
         let services = get_services();
         services.boot();
         if options.session_id.is_empty() {
             session_manager_create();
         } else {
             session_manager_open(options.session_id);
         }
       }
      
       fn get_services() -> Services {
         auth_storage_create();
         create_coding_tools();
         Services {}
       }
      
       fn auth_storage_create() {}
       fn create_coding_tools() {}
       fn session_manager_create() {}
       fn session_manager_open(_id: String) {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e create_agent_session`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  `));
});

test("rust: self.method resolves to Type.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.rs": src`
       struct Runner;
      
       impl Runner {
           fn start(&self) {
               self.prepare();
               self.run();
           }
           fn prepare(&self) {}
           fn run(&self) {}
       }
    `,
  });
  const to = host.commit("after", {
    "/runner.rs": src`
       struct Runner;
      
       impl Runner {
           fn start(&self) {
               self.prepare();
               self.validate();
               self.run();
           }
           fn prepare(&self) {}
           fn validate(&self) {}
           fn run(&self) {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.start(self)
      ├─ Runner.prepare(self)
    + ├─ Runner.validate(self)
      └─ Runner.run(self)
  `));
});

test("rust: Type::new expands through constructor body", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.rs": src`
       fn make() {
           Thing::new();
       }
      
       struct Thing;
      
       impl Thing {
           fn new() -> Self {
               init();
               Thing
           }
       }
      
       fn init() {}
    `,
  });
  const to = host.commit("after", {
    "/ctor.rs": src`
       fn make() {
           Thing::new();
       }
      
       struct Thing;
      
       impl Thing {
           fn new() -> Self {
               init();
               ready();
               Thing
           }
       }
      
       fn init() {}
       fn ready() {}
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

test("rust: closures not attributed to outer caller", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/closures.rs": src`
       fn outer() {
           let f = || {
               hidden();
           };
           let _ = f;
           visible();
       }
       fn hidden() {}
       fn visible() {}
    `,
  });
  const to = host.commit("after", {
    "/closures.rs": src`
       fn outer() {
           let f = || {
               hidden();
           };
           let _ = f;
           visible();
           also_visible();
       }
       fn hidden() {}
       fn visible() {}
       fn also_visible() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `));
});

test("rust: else if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.rs": src`
       fn handle(status: i32) {
           if status == 1 {
               do_a();
           } else if status == 2 {
               do_b();
           } else {
               do_other();
           }
       }
       fn do_a() {}
       fn do_b() {}
       fn do_other() {}
    `,
  });
  const to = host.commit("after", {
    "/elif.rs": src`
       fn handle(status: i32) {
           if status == 1 {
               do_a();
           } else if status == 2 {
               do_b();
               do_extra();
           } else {
               do_other();
           }
       }
       fn do_a() {}
       fn do_b() {}
       fn do_extra() {}
       fn do_other() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      handle(status)
      ├─ if status == 1
         └─ do_a()
      ├─ else if status == 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `));
});

test("rust: match arms as branches", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/match.rs": src`
       fn boot(x: i32) {
           match x {
               1 => do_a(),
               _ => do_other(),
           }
       }
       fn do_a() {}
       fn do_other() {}
    `,
  });
  const to = host.commit("after", {
    "/match.rs": src`
       fn boot(x: i32) {
           match x {
               1 => do_a(),
               _ => do_other(),
           }
           flush();
       }
       fn do_a() {}
       fn do_other() {}
       fn flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot(x)
      ├─ case 1
         └─ do_a()
      ├─ case _
         └─ do_other()
    + └─ flush()
  `));
});

test("rust: async fn bodies and pub visibility still expand", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/async.rs": src`
       pub async fn boot() {
           load().await;
           _helper();
       }
       async fn load() {}
       fn _helper() {}
    `,
  });
  const to = host.commit("after", {
    "/async.rs": src`
       pub async fn boot() {
           load().await;
           migrate().await;
           _helper();
       }
       async fn load() {}
       async fn migrate() {}
       fn _helper() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ load()
    + ├─ migrate()
      └─ _helper()
  `));
});

test("rust: Type::method scoped calls and ignores bare field reads", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/scoped.rs": src`
       fn run() {
           Runner::start();
           obj.known();
       }
      
       struct Runner;
       impl Runner {
           fn start() {
               prep();
           }
       }
       fn prep() {}
    `,
  });
  const to = host.commit("after", {
    "/scoped.rs": src`
       fn run() {
           Runner::start();
           obj.known();
           obj.other();
       }
      
       struct Runner;
       impl Runner {
           fn start() {
               prep();
               go();
           }
       }
       fn prep() {}
       fn go() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      run()
      ├─ Runner.start()
      │  ├─ prep()
    + │  └─ go()
      ├─ obj.known()
    + └─ obj.other()
  `));
});
