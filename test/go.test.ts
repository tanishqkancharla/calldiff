import { test } from "./expectCallstack.js";

test("go: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      package pi

      func CreateAgentSession(options Options) {
    -   AuthStorageCreate()
    -   CreateCodingTools()
    +   services := GetServices()
    +   services.Boot()
        if options.SessionID == "" {
          SessionManagerCreate()
        } else {
          SessionManagerOpen(options.SessionID)
        }
      }

    + func GetServices() Services {
    +   AuthStorageCreate()
    +   CreateCodingTools()
    +   return Services{}
    + }

      func AuthStorageCreate() {}
      func CreateCodingTools() {}
      func SessionManagerCreate() {}
      func SessionManagerOpen(id string) {}

      type Options struct{ SessionID string }
    + type Services struct{}
    + func (s Services) Boot() {}
    `,
    "CreateAgentSession",
    { file: "pi.go" },
  ).toEqual(`
      CreateAgentSession(options)
    - ├─ AuthStorageCreate()
    - ├─ CreateCodingTools()
    + ├─ GetServices()
    + │  ├─ AuthStorageCreate()
    + │  └─ CreateCodingTools()
    + ├─ services.Boot()
      ├─ if options.SessionID == ""
         └─ SessionManagerCreate()
      └─ else
         └─ SessionManagerOpen(id)
  `);
});

test("go: receiver methods resolve to Type.Method", ({ expectCallstack }) => {
  expectCallstack(
    `
      package runner

      type Runner struct{}

      func (r *Runner) Start() {
        r.Prepare()
    +   r.Validate()
        r.Run()
      }

      func (r *Runner) Prepare() {}
    + func (r *Runner) Validate() {}
      func (r *Runner) Run() {}
    `,
    "Runner.Start",
    { file: "runner.go" },
  ).toEqual(`
      Runner.Start()
      ├─ Runner.Prepare()
    + ├─ Runner.Validate()
      └─ Runner.Run()
  `);
});
