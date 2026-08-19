import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("ruby: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.rb": src`
       def create_agent_session(options)
         AuthStorage.create
         create_coding_tools
         if !options.session_id
           SessionManager.create
         else
           SessionManager.open(options.session_id)
         end
       end
      
      
       def create_coding_tools; end
    `,
  });
  const to = host.commit("after", {
    "/pi.rb": src`
       def create_agent_session(options)
         services = get_services
         services.boot
         if !options.session_id
           SessionManager.create
         else
           SessionManager.open(options.session_id)
         end
       end
      
       def get_services
         AuthStorage.create
         create_coding_tools
       end
      
       def create_coding_tools; end
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
      ├─ if !options.session_id
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open()
  `));
});

test("ruby: bare/self methods resolve to Class.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.rb": src`
       class Runner
         def start
           prepare
           run
         end
         def prepare; end
         def run; end
       end
    `,
  });
  const to = host.commit("after", {
    "/runner.rb": src`
       class Runner
         def start
           prepare
           validate
           run
         end
         def prepare; end
         def validate; end
         def run; end
       end
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

test("ruby: Foo.new expands through initialize", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.rb": src`
       def make
         Thing.new
       end
       class Thing
         def initialize
           init
         end
         def init; end
       end
    `,
  });
  const to = host.commit("after", {
    "/ctor.rb": src`
       def make
         Thing.new
       end
       class Thing
         def initialize
           init
           ready
         end
         def init; end
         def ready; end
       end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      └─ Thing()
         ├─ Thing.init()
    +    └─ Thing.ready()
  `));
});

test("ruby: lambdas/blocks not attributed to outer caller", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.rb": src`
       def outer
         f = -> { hidden }
         g = lambda { also_hidden }
         visible
       end
       def hidden; end
       def also_hidden; end
       def visible; end
    `,
  });
  const to = host.commit("after", {
    "/nested.rb": src`
       def outer
         f = -> { hidden }
         g = lambda { also_hidden }
         visible
         also_visible
       end
       def hidden; end
       def also_hidden; end
       def visible; end
       def also_visible; end
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

test("ruby: elsif chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elsif.rb": src`
       def handle(status)
         if status == "a"
           do_a
         elsif status == "b"
           do_b
         else
           do_other
         end
       end
       def do_a; end
       def do_b; end
       def do_other; end
    `,
  });
  const to = host.commit("after", {
    "/elsif.rb": src`
       def handle(status)
         if status == "a"
           do_a
         elsif status == "b"
           do_b
           do_extra
         else
           do_other
         end
       end
       def do_a; end
       def do_b; end
       def do_extra; end
       def do_other; end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      handle(status)
      ├─ if status == "a"
         └─ do_a()
      ├─ elsif status == "b"
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `));
});

test("ruby: begin/rescue/ensure and case/when as branches", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.rb": src`
       def boot(x)
         begin
           open_
         rescue StandardError
           recover
         ensure
           close
         end
         case x
         when 1
           do_a
         else
           do_other
         end
       end
       def open_; end
       def recover; end
       def close; end
       def do_a; end
       def do_other; end
    `,
  });
  const to = host.commit("after", {
    "/ctrl.rb": src`
       def boot(x)
         begin
           open_
         rescue StandardError
           recover
         ensure
           close
         end
         case x
         when 1
           do_a
         else
           do_other
         end
         flush
       end
       def open_; end
       def recover; end
       def close; end
       def do_a; end
       def do_other; end
       def flush; end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot(x)
      ├─ begin
         └─ open_()
      ├─ rescue StandardError
         └─ recover()
      ├─ ensure
         └─ close()
      ├─ when 1
         └─ do_a()
      ├─ else
         └─ do_other()
    + └─ flush()
  `));
});

test("ruby: self.method and underscore helper still expand", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/self.rb": src`
       class Vault
         def open
           self.unlock
           _prep
         end
         def unlock
           work
         end
         def _prep; end
         def work; end
       end
    `,
  });
  const to = host.commit("after", {
    "/self.rb": src`
       class Vault
         def open
           self.unlock
           _prep
         end
         def unlock
           work
           audit
         end
         def _prep; end
         def work; end
         def audit; end
       end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Vault.open`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Vault.open()
      ├─ Vault.unlock()
      │  ├─ Vault.work()
    + │  └─ Vault.audit()
      └─ Vault._prep()
  `));
});

test("ruby: singleton class methods expand", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/singleton.rb": src`
       def run
         Config.load
       end
       class Config
         def self.load
           read
         end
         def self.read; end
       end
    `,
  });
  const to = host.commit("after", {
    "/singleton.rb": src`
       def run
         Config.load
         Config.validate
       end
       class Config
         def self.load
           read
         end
         def self.validate
           check
         end
         def self.read; end
         def self.check; end
       end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e run`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      run()
      ├─ Config.load()
      │  └─ Config.read()
    + └─ Config.validate()
    +    └─ Config.check()
  `));
});
