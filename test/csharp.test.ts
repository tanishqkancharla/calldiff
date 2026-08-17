import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("csharp: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.cs": src`
       class PiService {
         public static void CreateAgentSession(int options) {
           AuthStorage.Create();
           Tools.CreateCodingTools();
           if (options == 0) {
             SessionManager.Create();
           } else {
             SessionManager.Open(options);
           }
         }
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
  });
  const to = host.commit("after", {
    "/pi.cs": src`
       class PiService {
         public static void CreateAgentSession(int options) {
           var services = PiService.GetServices();
           services.Boot();
           if (options == 0) {
             SessionManager.Create();
           } else {
             SessionManager.Open(options);
           }
         }
         public static Services GetServices() {
           AuthStorage.Create();
           Tools.CreateCodingTools();
           return new Services();
         }
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
  });

  const result = host.run(`calldiff diff ${from} ${to} -e PiService.CreateAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/runner.cs": src`
       class Runner {
         public void Start() {
           this.Prepare();
           this.Run();
         }
         public void Prepare() {}
         public void Run() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/runner.cs": src`
       class Runner {
         public void Start() {
           this.Prepare();
           this.Validate();
           this.Run();
         }
         public void Prepare() {}
         public void Validate() {}
         public void Run() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.Start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.Start()
      ├─ Runner.Prepare()
    + ├─ Runner.Validate()
      └─ Runner.Run()
  `));
});

test("csharp: new Class() expands through the constructor", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.cs": src`
       class Maker {
         public void Go() {
           new Thing();
         }
       }
       class Thing {
         public Thing() {
           Init();
         }
       }
       class Helpers {
         public static void Init() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/ctor.cs": src`
       class Maker {
         public void Go() {
           new Thing();
         }
       }
       class Thing {
         public Thing() {
           Init();
           Ready();
         }
       }
       class Helpers {
         public static void Init() {}
         public static void Ready() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Maker.Go`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Maker.Go()
      └─ new Thing()
         ├─ Init()
    +    └─ Ready()
  `));
});

test("csharp: does not attribute nested local/lambda bodies", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.cs": src`
       class Runner {
         public void Outer() {
           void Nested() {
             Hidden();
           }
           System.Action f = () => { AlsoHidden(); };
           Visible();
         }
       }
       class Helpers {
         public static void Hidden() {}
         public static void AlsoHidden() {}
         public static void Visible() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/nested.cs": src`
       class Runner {
         public void Outer() {
           void Nested() {
             Hidden();
           }
           System.Action f = () => { AlsoHidden(); };
           Visible();
           AlsoVisible();
         }
       }
       class Helpers {
         public static void Hidden() {}
         public static void AlsoHidden() {}
         public static void Visible() {}
         public static void AlsoVisible() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.Outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.Outer()
      ├─ Visible()
    + └─ AlsoVisible()
  `));
});

test("csharp: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.cs": src`
       class Handler {
         public void Handle(int status) {
           if (status == 1) {
             DoA();
           } else if (status == 2) {
             DoB();
           } else {
             DoOther();
           }
         }
       }
       class Helpers {
         public static void DoA() {}
         public static void DoB() {}
         public static void DoOther() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/elif.cs": src`
       class Handler {
         public void Handle(int status) {
           if (status == 1) {
             DoA();
           } else if (status == 2) {
             DoB();
             DoExtra();
           } else {
             DoOther();
           }
         }
       }
       class Helpers {
         public static void DoA() {}
         public static void DoB() {}
         public static void DoExtra() {}
         public static void DoOther() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Handler.Handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.cs": src`
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
         }
       }
       class Helpers {
         public static void Open() {}
         public static void Recover() {}
         public static void Close() {}
         public static void DoA() {}
         public static void DoOther() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/ctrl.cs": src`
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
           Flush();
         }
       }
       class Helpers {
         public static void Open() {}
         public static void Recover() {}
         public static void Close() {}
         public static void DoA() {}
         public static void DoOther() {}
         public static void Flush() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Booter.Boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/static.cs": src`
       class Runner {
         public void Start() {
           Runner.Helper();
           this.Secret();
         }
         public static void Helper() {
           Work();
         }
         private void Secret() {
           Hidden();
         }
       }
       class Helpers {
         public static void Work() {}
         public static void Hidden() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/static.cs": src`
       class Runner {
         public void Start() {
           Runner.Helper();
           this.Secret();
           Runner.Extra();
         }
         public static void Helper() {
           Work();
           More();
         }
         public static void Extra() {
           Also();
         }
         private void Secret() {
           Hidden();
           Audit();
         }
       }
       class Helpers {
         public static void Work() {}
         public static void More() {}
         public static void Also() {}
         public static void Hidden() {}
         public static void Audit() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.Start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
