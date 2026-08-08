import { test } from "./expectCallstack.js";

test("ruby: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      def create_agent_session(options)
    -   AuthStorage.create
    -   create_coding_tools
    +   services = get_services
    +   services.boot
        if !options.session_id
          SessionManager.create
        else
          SessionManager.open(options.session_id)
        end
      end

    + def get_services
    +   AuthStorage.create
    +   create_coding_tools
    + end

      def create_coding_tools; end
    `,
    "create_agent_session",
    { file: "pi.rb" },
  ).toEqual(`
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
  `);
});

test("ruby: bare/self methods resolve to Class.method", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      class Runner
        def start
          prepare
    +     validate
          run
        end
        def prepare; end
    +   def validate; end
        def run; end
      end
    `,
    "Runner.start",
    { file: "runner.rb" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});

test("ruby: Foo.new expands through initialize", ({ expectCallstack }) => {
  expectCallstack(
    `
      def make
        Thing.new
      end
      class Thing
        def initialize
          init
    +     ready
        end
        def init; end
    +   def ready; end
      end
    `,
    "make",
    { file: "ctor.rb" },
  ).toEqual(`
      make()
      └─ Thing()
         ├─ Thing.init()
    +    └─ Thing.ready()
  `);
});

test("ruby: lambdas/blocks not attributed to outer caller", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      def outer
        f = -> { hidden }
        g = lambda { also_hidden }
        visible
    +   also_visible
      end
      def hidden; end
      def also_hidden; end
      def visible; end
    + def also_visible; end
    `,
    "outer",
    { file: "nested.rb" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `);
});

test("ruby: elsif chains", ({ expectCallstack }) => {
  expectCallstack(
    `
      def handle(status)
        if status == "a"
          do_a
        elsif status == "b"
          do_b
    +     do_extra
        else
          do_other
        end
      end
      def do_a; end
      def do_b; end
    + def do_extra; end
      def do_other; end
    `,
    "handle",
    { file: "elsif.rb" },
  ).toEqual(`
      handle(status)
      ├─ if status == "a"
         └─ do_a()
      ├─ elsif status == "b"
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `);
});

test("ruby: begin/rescue/ensure and case/when as branches", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    +   flush
      end
      def open_; end
      def recover; end
      def close; end
      def do_a; end
      def do_other; end
    + def flush; end
    `,
    "boot",
    { file: "ctrl.rb" },
  ).toEqual(`
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
  `);
});

test("ruby: self.method and underscore helper still expand", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      class Vault
        def open
          self.unlock
          _prep
        end
        def unlock
          work
    +     audit
        end
        def _prep; end
        def work; end
    +   def audit; end
      end
    `,
    "Vault.open",
    { file: "self.rb" },
  ).toEqual(`
      Vault.open()
      ├─ Vault.unlock()
      │  ├─ Vault.work()
    + │  └─ Vault.audit()
      └─ Vault._prep()
  `);
});

test("ruby: singleton class methods expand", ({ expectCallstack }) => {
  expectCallstack(
    `
      def run
        Config.load
    +   Config.validate
      end
      class Config
        def self.load
          read
        end
    +   def self.validate
    +     check
    +   end
        def self.read; end
    +   def self.check; end
      end
    `,
    "run",
    { file: "singleton.rb" },
  ).toEqual(`
      run()
      ├─ Config.load()
      │  └─ Config.read()
    + └─ Config.validate()
    +    └─ Config.check()
  `);
});
