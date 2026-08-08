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
