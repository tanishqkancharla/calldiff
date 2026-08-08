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
