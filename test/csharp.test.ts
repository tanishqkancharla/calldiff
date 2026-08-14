import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("csharp: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class PiService {
        public static void CreateAgentSession(int options) {
    -     AuthStorage.Create();
    -     Tools.CreateCodingTools();
    +     var services = PiService.GetServices();
    +     services.Boot();
          if (options == 0) {
            SessionManager.Create();
          } else {
            SessionManager.Open(options);
          }
        }
    +   public static Services GetServices() {
    +     AuthStorage.Create();
    +     Tools.CreateCodingTools();
    +     return new Services();
    +   }
      }
      class AuthStorage {
        public static void Create() {}
      }
      class SessionManager {
        public static void Create() {}
        public static void Open(int id) {}
      }
      class Services {
        public void Boot() {}
      }
      class Tools {
        public static void CreateCodingTools() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.cs": before });
  const to = host.commit("after", { "/pi.cs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e PiService.CreateAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      PiService.CreateAgentSession(options)
    - ├─ AuthStorage.Create()
    - ├─ Tools.CreateCodingTools()
    + ├─ PiService.GetServices()
    + │  ├─ AuthStorage.Create()
    + │  ├─ Tools.CreateCodingTools()
    + │  └─ new Services()
    + ├─ services.Boot()
      ├─ if options == 0
         └─ SessionManager.Create()
      └─ else
         └─ SessionManager.Open(id)
  `));
});

test("csharp: this.Method resolves to Class.Method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Runner {
        public void Start() {
          this.Prepare();
    +     this.Validate();
          this.Run();
        }
        public void Prepare() {}
    +   public void Validate() {}
        public void Run() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.cs": before });
  const to = host.commit("after", { "/runner.cs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.Start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.Start()
      ├─ Runner.Prepare()
    + ├─ Runner.Validate()
      └─ Runner.Run()
  `));
});

test("csharp: new Class() expands through the constructor", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Maker {
        public void Go() {
          new Thing();
        }
      }
      class Thing {
        public Thing() {
          Init();
    +     Ready();
        }
      }
      class Helpers {
        public static void Init() {}
    +   public static void Ready() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.cs": before });
  const to = host.commit("after", { "/ctor.cs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Maker.Go`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Maker.Go()
      └─ new Thing()
         ├─ Init()
    +    └─ Ready()
  `));
});

test("csharp: does not attribute nested local/lambda bodies", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Runner {
        public void Outer() {
          void Nested() {
            Hidden();
          }
          System.Action f = () => { AlsoHidden(); };
          Visible();
    +     AlsoVisible();
        }
      }
      class Helpers {
        public static void Hidden() {}
        public static void AlsoHidden() {}
        public static void Visible() {}
    +   public static void AlsoVisible() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.cs": before });
  const to = host.commit("after", { "/nested.cs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.Outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.Outer()
      ├─ Visible()
    + └─ AlsoVisible()
  `));
});

test("csharp: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Handler {
        public void Handle(int status) {
          if (status == 1) {
            DoA();
          } else if (status == 2) {
            DoB();
    +       DoExtra();
          } else {
            DoOther();
          }
        }
      }
      class Helpers {
        public static void DoA() {}
        public static void DoB() {}
    +   public static void DoExtra() {}
        public static void DoOther() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.cs": before });
  const to = host.commit("after", { "/elif.cs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Handler.Handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Handler.Handle(status)
      ├─ if status == 1
         └─ DoA()
      ├─ else if status == 2
         ├─ DoB()
    +    └─ DoExtra()
      └─ else
         └─ DoOther()
  `));
});

test("csharp: try/catch/finally and switch as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Booter {
        public void Boot(int x) {
          try {
            Open();
          } catch (System.Exception e) {
            Recover();
          } finally {
            Close();
          }
          switch (x) {
            case 1:
              DoA();
              break;
            default:
              DoOther();
              break;
          }
    +     Flush();
        }
      }
      class Helpers {
        public static void Open() {}
        public static void Recover() {}
        public static void Close() {}
        public static void DoA() {}
        public static void DoOther() {}
    +   public static void Flush() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.cs": before });
  const to = host.commit("after", { "/ctrl.cs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Booter.Boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Booter.Boot(x)
      ├─ try
         └─ Open()
      ├─ catch (System.Exception e)
         └─ Recover()
      ├─ finally
         └─ Close()
      ├─ case 1
         └─ DoA()
      ├─ default
         └─ DoOther()
    + └─ Flush()
  `));
});

test("csharp: static methods expand; private methods still indexed", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      class Runner {
        public void Start() {
          Runner.Helper();
          this.Secret();
    +     Runner.Extra();
        }
        public static void Helper() {
          Work();
    +     More();
        }
    +   public static void Extra() {
    +     Also();
    +   }
        private void Secret() {
          Hidden();
    +     Audit();
        }
      }
      class Helpers {
        public static void Work() {}
    +   public static void More() {}
    +   public static void Also() {}
        public static void Hidden() {}
    +   public static void Audit() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/static.cs": before });
  const to = host.commit("after", { "/static.cs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.Start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.Start()
      ├─ Runner.Helper()
      │  ├─ Work()
    + │  └─ More()
      ├─ Runner.Secret()
      │  ├─ Hidden()
    + │  └─ Audit()
    + └─ Runner.Extra()
    +    └─ Also()
  `));
});
