import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("rust: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.rs": before });
  const to = host.commit("after", { "/pi.rs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e create_agent_session`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.rs": before });
  const to = host.commit("after", { "/runner.rs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start(self)
      ├─ Runner.prepare(self)
    + ├─ Runner.validate(self)
      └─ Runner.run(self)
  `));
});

test("rust: Type::new expands through constructor body", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.rs": before });
  const to = host.commit("after", { "/ctor.rs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("rust: closures not attributed to outer caller", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/closures.rs": before });
  const to = host.commit("after", { "/closures.rs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `));
});

test("rust: else if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.rs": before });
  const to = host.commit("after", { "/elif.rs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/match.rs": before });
  const to = host.commit("after", { "/match.rs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(x)
      ├─ case 1
         └─ do_a()
      ├─ case _
         └─ do_other()
    + └─ flush()
  `));
});

test("rust: async fn bodies and pub visibility still expand", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      pub async fn boot() {
          load().await;
    +     migrate().await;
          _helper();
      }
      async fn load() {}
    + async fn migrate() {}
      fn _helper() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/async.rs": before });
  const to = host.commit("after", { "/async.rs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ load()
    + ├─ migrate()
      └─ _helper()
  `));
});

test("rust: Type::method scoped calls and ignores bare field reads", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/scoped.rs": before });
  const to = host.commit("after", { "/scoped.rs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      run()
      ├─ Runner.start()
      │  ├─ prep()
    + │  └─ go()
      ├─ obj.known()
    + └─ obj.other()
  `));
});
