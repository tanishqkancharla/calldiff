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

test("python: Class() expands through __init__", ({ expectCallstack }) => {
  expectCallstack(
    `
      def make():
          Thing()
      class Thing:
          def __init__(self):
              init()
    +         ready()
      def init():
          pass
    + def ready():
    +     pass
    `,
    "make",
    { file: "ctor.py" },
  ).toEqual(`
      make()
      └─ Thing()
         ├─ init()
    +    └─ ready()
  `);
});

test("python: indexes assigned lambdas; skips nested lambda bodies", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      def outer():
          f = lambda: hidden()
          visible()
    +     also_visible()
      public = lambda: work()
    + extra = lambda: more()
      def hidden():
          pass
      def visible():
          pass
    + def also_visible():
    +     pass
      def work():
          pass
    + def more():
    +     pass
    `,
    "outer",
    { file: "lambdas.py" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `);
});

test("python: follows top-level assigned lambda entrypoints", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
    - boot = lambda: load()
    + boot = lambda: [load(), go()]
      def load():
          pass
    + def go():
    +     pass
    `,
    "boot",
    { file: "boot.py" },
  ).toEqual(`
      boot()
      ├─ load()
    + └─ go()
  `);
});

test("python: indexes @property methods like getters", ({ expectCallstack }) => {
  expectCallstack(
    `
      class Config:
          @property
          def value(self):
              load()
    +         validate()
              return 1
      def load():
          pass
    + def validate():
    +     pass
    `,
    "Config.value",
    { file: "prop.py" },
  ).toEqual(`
      Config.value(self)
      ├─ load()
    + └─ validate()
  `);
});

test("python: try/except/finally and match/case as branches", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      def boot(x):
          try:
              open_()
          except Exception:
              recover()
          finally:
              close()
          match x:
              case 1:
                  do_a()
              case _:
                  do_other()
    +     flush()
      def open_():
          pass
      def recover():
          pass
      def close():
          pass
      def do_a():
          pass
      def do_other():
          pass
    + def flush():
    +     pass
    `,
    "boot",
    { file: "ctrl.py" },
  ).toEqual(`
      boot(x)
      ├─ try
         └─ open_()
      ├─ except Exception
         └─ recover()
      ├─ finally
         └─ close()
      ├─ case 1
         └─ do_a()
      ├─ case _
         └─ do_other()
    + └─ flush()
  `);
});

test("python: super().method labeled as Class.method; ignores subscript calls", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      class Child(Base):
          def start(self):
              super().setup()
              obj[key]()
              obj.known()
    +         work()
      def work():
          pass
    `,
    "Child.start",
    { file: "super.py" },
  ).toEqual(`
      Child.start(self)
      ├─ Child.setup()
      ├─ obj.known()
    + └─ work()
  `);
});

test("python: elif chains", ({ expectCallstack }) => {
  expectCallstack(
    `
      def handle(status):
          if status == "a":
              do_a()
          elif status == "b":
              do_b()
    +         do_extra()
          else:
              do_other()
      def do_a():
          pass
      def do_b():
          pass
    + def do_extra():
    +     pass
      def do_other():
          pass
    `,
    "handle",
    { file: "elif.py" },
  ).toEqual(`
      handle(status)
      ├─ if status == "a"
         └─ do_a()
      ├─ elif status == "b"
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `);
});
