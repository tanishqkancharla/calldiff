import { test } from "./expectCallstack.js";

test("python: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      class PiService:
          @staticmethod
          def create_agent_session(options):
    -         AuthStorage.create()
    -         create_coding_tools()
    +         services = PiService.get_services()
    +         services.boot()
              if not options.session_id:
                  SessionManager.create()
              else:
                  SessionManager.open(options.session_id)

    +     @staticmethod
    +     def get_services():
    +         AuthStorage.create()
    +         create_coding_tools()
    +         return services

      class AuthStorage:
          @staticmethod
          def create():
              pass

      class SessionManager:
          @staticmethod
          def create():
              pass

          @staticmethod
          def open(_id):
              pass

      def create_coding_tools():
          pass
    +
    + services = None
    `,
    "PiService.create_agent_session",
    { file: "pi.py" },
  ).toEqual(`
      PiService.create_agent_session(options)
    - ├─ AuthStorage.create()
    - ├─ create_coding_tools()
    + ├─ PiService.get_services()
    + │  ├─ AuthStorage.create()
    + │  └─ create_coding_tools()
    + ├─ services.boot()
      ├─ if not options.session_id
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(_id)
  `);
});

test("python: self.method resolves to Class.method", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Runner:
          def start(self):
              self.prepare()
    +         self.validate()
              self.run()

          def prepare(self):
              pass

    +     def validate(self):
    +         pass

          def run(self):
              pass
    `,
    "Runner.start",
    { file: "runner.py" },
  ).toEqual(`
      Runner.start(self)
      ├─ Runner.prepare(self)
    + ├─ Runner.validate(self)
      └─ Runner.run(self)
  `);
});
