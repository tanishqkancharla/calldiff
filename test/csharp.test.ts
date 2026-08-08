import { test } from "./expectCallstack.js";

test("csharp: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "PiService.CreateAgentSession",
    { file: "pi.cs" },
  ).toEqual(`
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
  `);
});

test("csharp: this.Method resolves to Class.Method", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Runner.Start",
    { file: "runner.cs" },
  ).toEqual(`
      Runner.Start()
      ├─ Runner.Prepare()
    + ├─ Runner.Validate()
      └─ Runner.Run()
  `);
});

test("csharp: new Class() expands through the constructor", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Maker.Go",
    { file: "ctor.cs" },
  ).toEqual(`
      Maker.Go()
      └─ new Thing()
         ├─ Init()
    +    └─ Ready()
  `);
});

test("csharp: does not attribute nested local/lambda bodies", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Runner.Outer",
    { file: "nested.cs" },
  ).toEqual(`
      Runner.Outer()
      ├─ Visible()
    + └─ AlsoVisible()
  `);
});

test("csharp: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Handler.Handle",
    { file: "elif.cs" },
  ).toEqual(`
      Handler.Handle(status)
      ├─ if status == 1
         └─ DoA()
      ├─ else if status == 2
         ├─ DoB()
    +    └─ DoExtra()
      └─ else
         └─ DoOther()
  `);
});

test("csharp: try/catch/finally and switch as branches", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Booter.Boot",
    { file: "ctrl.cs" },
  ).toEqual(`
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
  `);
});

test("csharp: static methods expand; private methods still indexed", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Runner.Start",
    { file: "static.cs" },
  ).toEqual(`
      Runner.Start()
      ├─ Runner.Helper()
      │  ├─ Work()
    + │  └─ More()
      ├─ Runner.Secret()
      │  ├─ Hidden()
    + │  └─ Audit()
    + └─ Runner.Extra()
    +    └─ Also()
  `);
});
