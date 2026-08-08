import { test } from "./expectCallstack.js";

test("lua: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      function create_agent_session(options)
    -   AuthStorage.create()
    -   create_coding_tools()
    +   local services = get_services()
    +   services:boot()
        if options.session_id == nil then
          SessionManager.create()
        else
          SessionManager.open(options.session_id)
        end
      end

    + function get_services()
    +   AuthStorage.create()
    +   create_coding_tools()
    + end

      function create_coding_tools() end

      function SessionManager.create() end
      function SessionManager.open(id) end
      function AuthStorage.create() end
    + function Services:boot() end
    `,
    "create_agent_session",
    { file: "pi.lua" },
  ).toEqual(`
      create_agent_session(options)
    - ├─ AuthStorage.create()
    - ├─ create_coding_tools()
    + ├─ get_services()
    + │  ├─ AuthStorage.create()
    + │  └─ create_coding_tools()
    + ├─ services.boot()
      ├─ if options.session_id == nil
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(id)
  `);
});

test("lua: self:method resolves to Type.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      function Runner:start()
        self:prepare()
    +   self:validate()
        self:run()
      end

      function Runner:prepare() end
    + function Runner:validate() end
      function Runner:run() end
    `,
    "Runner.start",
    { file: "runner.lua" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});
