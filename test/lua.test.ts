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

test("lua: Thing:new expands like a constructor", ({ expectCallstack }) => {
  expectCallstack(
    `
      function make()
        Thing:new()
      end
      function Thing:new()
        init()
    +   ready()
      end
      function init() end
    + function ready() end
    `,
    "make",
    { file: "ctor.lua" },
  ).toEqual(`
      make()
      └─ Thing.new()
         ├─ init()
    +    └─ ready()
  `);
});

test("lua: skips nested local functions and closures", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      function outer()
        local function nested()
          hidden()
        end
        local f = function()
          also_hidden()
        end
        visible()
    +   also_visible()
      end
      function hidden() end
      function also_hidden() end
      function visible() end
    + function also_visible() end
    `,
    "outer",
    { file: "nested.lua" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `);
});

test("lua: elseif chains", ({ expectCallstack }) => {
  expectCallstack(
    `
      function handle(status)
        if status == "a" then
          do_a()
        elseif status == "b" then
          do_b()
    +     do_extra()
        else
          do_other()
        end
      end
      function do_a() end
      function do_b() end
    + function do_extra() end
      function do_other() end
    `,
    "handle",
    { file: "elif.lua" },
  ).toEqual(`
      handle(status)
      ├─ if status == "a"
         └─ do_a()
      ├─ elseif status == "b"
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `);
});

test("lua: colon and dot method calls both resolve to Type.method", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      function boot(obj)
        obj:method()
        obj.method()
        Thing.static()
    +   Thing:extra()
      end
      function Thing:method() end
      function Thing.static()
        work()
      end
    + function Thing:extra()
    +   more()
    + end
      function work() end
    + function more() end
    `,
    "boot",
    { file: "colon.lua" },
  ).toEqual(`
      boot(obj)
      ├─ obj.method()
      ├─ obj.method()
      ├─ Thing.static()
      │  └─ work()
    + └─ Thing.extra()
    +    └─ more()
  `);
});

test("lua: dotted Type.method definitions expand", ({ expectCallstack }) => {
  expectCallstack(
    `
      function boot()
        AuthStorage.create()
    +   AuthStorage.reset()
      end
      function AuthStorage.create()
        load()
      end
    + function AuthStorage.reset()
    +   clear()
    + end
      function load() end
    + function clear() end
    `,
    "boot",
    { file: "static.lua" },
  ).toEqual(`
      boot()
      ├─ AuthStorage.create()
      │  └─ load()
    + └─ AuthStorage.reset()
    +    └─ clear()
  `);
});
