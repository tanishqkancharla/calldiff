import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("python: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.py": before });
  const to = host.commit("after", { "/pi.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e PiService.create_agent_session`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  `));
});

test("python: self.method resolves to Class.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.py": before });
  const to = host.commit("after", { "/runner.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start(self)
      ├─ Runner.prepare(self)
    + ├─ Runner.validate(self)
      └─ Runner.run(self)
  `));
});

test("python: Class() expands through __init__", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.py": before });
  const to = host.commit("after", { "/ctor.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      └─ Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("python: indexes assigned lambdas; skips nested lambda bodies", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/lambdas.py": before });
  const to = host.commit("after", { "/lambdas.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `));
});

test("python: follows top-level assigned lambda entrypoints", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
    - boot = lambda: load()
    + boot = lambda: [load(), go()]
      def load():
          pass
    + def go():
    +     pass
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/boot.py": before });
  const to = host.commit("after", { "/boot.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ load()
    + └─ go()
  `));
});

test("python: indexes @property methods like getters", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/prop.py": before });
  const to = host.commit("after", { "/prop.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Config.value`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Config.value(self)
      ├─ load()
    + └─ validate()
  `));
});

test("python: try/except/finally and match/case as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.py": before });
  const to = host.commit("after", { "/ctrl.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  `));
});

test("python: super().method labeled as Class.method; ignores subscript calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Child(Base):
          def start(self):
              super().setup()
              obj[key]()
              obj.known()
    +         work()
      def work():
          pass
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/super.py": before });
  const to = host.commit("after", { "/super.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Child.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Child.start(self)
      ├─ Child.setup()
      ├─ obj.known()
    + └─ work()
  `));
});

test("python: elif chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.py": before });
  const to = host.commit("after", { "/elif.py": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(status)
      ├─ if status == "a"
         └─ do_a()
      ├─ elif status == "b"
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `));
});
