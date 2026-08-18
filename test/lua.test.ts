import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("lua: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.lua": src`
       function create_agent_session(options)
         AuthStorage.create()
         create_coding_tools()
         if options.session_id == nil then
           SessionManager.create()
         else
           SessionManager.open(options.session_id)
         end
       end
      
      
       function create_coding_tools() end
      
       function SessionManager.create() end
       function SessionManager.open(id) end
       function AuthStorage.create() end
    `,
  });
  const to = host.commit("after", {
    "/pi.lua": src`
       function create_agent_session(options)
         local services = get_services()
         services:boot()
         if options.session_id == nil then
           SessionManager.create()
         else
           SessionManager.open(options.session_id)
         end
       end
      
       function get_services()
         AuthStorage.create()
         create_coding_tools()
       end
      
       function create_coding_tools() end
      
       function SessionManager.create() end
       function SessionManager.open(id) end
       function AuthStorage.create() end
       function Services:boot() end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e create_agent_session`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  `));
});

test("lua: self:method resolves to Type.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.lua": src`
       function Runner:start()
         self:prepare()
         self:run()
       end
      
       function Runner:prepare() end
       function Runner:run() end
    `,
  });
  const to = host.commit("after", {
    "/runner.lua": src`
       function Runner:start()
         self:prepare()
         self:validate()
         self:run()
       end
      
       function Runner:prepare() end
       function Runner:validate() end
       function Runner:run() end
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

test("lua: Thing:new expands like a constructor", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.lua": src`
       function make()
         Thing:new()
       end
       function Thing:new()
         init()
       end
       function init() end
    `,
  });
  const to = host.commit("after", {
    "/ctor.lua": src`
       function make()
         Thing:new()
       end
       function Thing:new()
         init()
         ready()
       end
       function init() end
       function ready() end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      └─ Thing.new()
         ├─ init()
    +    └─ ready()
  `));
});

test("lua: skips nested local functions and closures", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.lua": src`
       function outer()
         local function nested()
           hidden()
         end
         local f = function()
           also_hidden()
         end
         visible()
       end
       function hidden() end
       function also_hidden() end
       function visible() end
    `,
  });
  const to = host.commit("after", {
    "/nested.lua": src`
       function outer()
         local function nested()
           hidden()
         end
         local f = function()
           also_hidden()
         end
         visible()
         also_visible()
       end
       function hidden() end
       function also_hidden() end
       function visible() end
       function also_visible() end
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

test("lua: elseif chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.lua": src`
       function handle(status)
         if status == "a" then
           do_a()
         elseif status == "b" then
           do_b()
         else
           do_other()
         end
       end
       function do_a() end
       function do_b() end
       function do_other() end
    `,
  });
  const to = host.commit("after", {
    "/elif.lua": src`
       function handle(status)
         if status == "a" then
           do_a()
         elseif status == "b" then
           do_b()
           do_extra()
         else
           do_other()
         end
       end
       function do_a() end
       function do_b() end
       function do_extra() end
       function do_other() end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      handle(status)
      ├─ if status == "a"
         └─ do_a()
      ├─ elseif status == "b"
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `));
});

test("lua: colon and dot method calls both resolve to Type.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/colon.lua": src`
       function boot(obj)
         obj:method()
         obj.method()
         Thing.static()
       end
       function Thing:method() end
       function Thing.static()
         work()
       end
       function work() end
    `,
  });
  const to = host.commit("after", {
    "/colon.lua": src`
       function boot(obj)
         obj:method()
         obj.method()
         Thing.static()
         Thing:extra()
       end
       function Thing:method() end
       function Thing.static()
         work()
       end
       function Thing:extra()
         more()
       end
       function work() end
       function more() end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot(obj)
      ├─ obj.method()
      ├─ obj.method()
      ├─ Thing.static()
      │  └─ work()
    + └─ Thing.extra()
    +    └─ more()
  `));
});

test("lua: dotted Type.method definitions expand", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/static.lua": src`
       function boot()
         AuthStorage.create()
       end
       function AuthStorage.create()
         load()
       end
       function load() end
    `,
  });
  const to = host.commit("after", {
    "/static.lua": src`
       function boot()
         AuthStorage.create()
         AuthStorage.reset()
       end
       function AuthStorage.create()
         load()
       end
       function AuthStorage.reset()
         clear()
       end
       function load() end
       function clear() end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ AuthStorage.create()
      │  └─ load()
    + └─ AuthStorage.reset()
    +    └─ clear()
  `));
});
