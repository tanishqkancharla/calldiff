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
