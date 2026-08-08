import { test } from "./expectCallstack.js";

test("c: refactors calls into a helper with if/else", ({ expectCallstack }) => {
  expectCallstack(
    `
      int CreateAgentSession(int options) {
    -   AuthStorageCreate();
    -   CreateCodingTools();
    +   GetServices();
    +   ServicesBoot();
        if (options == 0) {
          SessionManagerCreate();
        } else {
          SessionManagerOpen(options);
        }
        return 0;
      }

    + int GetServices(void) {
    +   AuthStorageCreate();
    +   CreateCodingTools();
    +   return 0;
    + }
    + void ServicesBoot(void) {}

      void AuthStorageCreate(void) {}
      void CreateCodingTools(void) {}
      void SessionManagerCreate(void) {}
      void SessionManagerOpen(int id) {}
    `,
    "CreateAgentSession",
    { file: "pi.c" },
  ).toEqual(`
      CreateAgentSession(options)
    - ├─ AuthStorageCreate()
    - ├─ CreateCodingTools()
    + ├─ GetServices()
    + │  ├─ AuthStorageCreate()
    + │  └─ CreateCodingTools()
    + ├─ ServicesBoot()
      ├─ if options == 0
         └─ SessionManagerCreate()
      └─ else
         └─ SessionManagerOpen(id)
  `);
});

test("c: field/arrow receiver calls resolve to obj.method", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      void Runner_Start(struct Runner *r) {
        r->Prepare();
    +   r->Validate();
        r->Run();
      }
      void Prepare(struct Runner *r) {}
    + void Validate(struct Runner *r) {}
      void Run(struct Runner *r) {}
    `,
    "Runner_Start",
    { file: "runner.c" },
  ).toEqual(`
      Runner_Start(r)
      ├─ r.Prepare()
    + ├─ r.Validate()
      └─ r.Run()
  `);
});
