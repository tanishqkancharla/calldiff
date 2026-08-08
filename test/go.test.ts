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

test("go: else-if and switch as branches; skips nested funcs", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      package ctrl

      func Handle(x int) {
        if x == 1 {
          DoA()
        } else if x == 2 {
          DoB()
    +     DoExtra()
        } else {
          DoC()
        }
        switch x {
        case 1:
          DoA()
        default:
          DoC()
        }
        go func() { Hidden() }()
        f := func() { Nested() }
        _ = f
    +   Flush()
      }

      func DoA() {}
      func DoB() {}
    + func DoExtra() {}
      func DoC() {}
      func Hidden() {}
      func Nested() {}
    + func Flush() {}
    `,
    "Handle",
    { file: "ctrl.go" },
  ).toEqual(`
      Handle(x)
      ├─ if x == 1
         └─ DoA()
      ├─ else if x == 2
         ├─ DoB()
    +    └─ DoExtra()
      ├─ else
         └─ DoC()
      ├─ case 1
         └─ DoA()
      ├─ default
         └─ DoC()
    + └─ Flush()
  `);
});

test("go: NewThing() expands through new Thing alias", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      package ctor

      func Make() {
        NewThing()
    +   Also()
      }

      func NewThing() *Thing {
        init()
    +   ready()
        return &Thing{}
      }

    + func Also() {}
      func init() {}
    + func ready() {}
      type Thing struct{}
    `,
    "Make",
    { file: "ctor.go" },
  ).toEqual(`
      Make()
      ├─ Thing()
      │  ├─ init()
    + │  └─ ready()
    + └─ Also()
  `);
});
