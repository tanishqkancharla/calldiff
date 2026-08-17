import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("go: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.go": src`
       package pi
      
       func CreateAgentSession(options Options) {
         AuthStorageCreate()
         CreateCodingTools()
         if options.SessionID == "" {
           SessionManagerCreate()
         } else {
           SessionManagerOpen(options.SessionID)
         }
       }
      
      
       func AuthStorageCreate() {}
       func CreateCodingTools() {}
       func SessionManagerCreate() {}
       func SessionManagerOpen(id string) {}
      
       type Options struct{ SessionID string }
    `,
  });
  const to = host.commit("after", {
    "/pi.go": src`
       package pi
      
       func CreateAgentSession(options Options) {
         services := GetServices()
         services.Boot()
         if options.SessionID == "" {
           SessionManagerCreate()
         } else {
           SessionManagerOpen(options.SessionID)
         }
       }
      
       func GetServices() Services {
         AuthStorageCreate()
         CreateCodingTools()
         return Services{}
       }
      
       func AuthStorageCreate() {}
       func CreateCodingTools() {}
       func SessionManagerCreate() {}
       func SessionManagerOpen(id string) {}
      
       type Options struct{ SessionID string }
       type Services struct{}
       func (s Services) Boot() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e CreateAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  `));
});

test("go: receiver methods resolve to Type.Method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.go": src`
       package runner
      
       type Runner struct{}
      
       func (r *Runner) Start() {
         r.Prepare()
         r.Run()
       }
      
       func (r *Runner) Prepare() {}
       func (r *Runner) Run() {}
    `,
  });
  const to = host.commit("after", {
    "/runner.go": src`
       package runner
      
       type Runner struct{}
      
       func (r *Runner) Start() {
         r.Prepare()
         r.Validate()
         r.Run()
       }
      
       func (r *Runner) Prepare() {}
       func (r *Runner) Validate() {}
       func (r *Runner) Run() {}
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

test("go: else-if and switch as branches; skips nested funcs", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.go": src`
       package ctrl
      
       func Handle(x int) {
         if x == 1 {
           DoA()
         } else if x == 2 {
           DoB()
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
       }
      
       func DoA() {}
       func DoB() {}
       func DoC() {}
       func Hidden() {}
       func Nested() {}
    `,
  });
  const to = host.commit("after", {
    "/ctrl.go": src`
       package ctrl
      
       func Handle(x int) {
         if x == 1 {
           DoA()
         } else if x == 2 {
           DoB()
           DoExtra()
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
         Flush()
       }
      
       func DoA() {}
       func DoB() {}
       func DoExtra() {}
       func DoC() {}
       func Hidden() {}
       func Nested() {}
       func Flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  `));
});

test("go: NewThing() expands through new Thing alias", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.go": src`
       package ctor
      
       func Make() {
         NewThing()
       }
      
       func NewThing() *Thing {
         init()
         return &Thing{}
       }
      
       func init() {}
       type Thing struct{}
    `,
  });
  const to = host.commit("after", {
    "/ctor.go": src`
       package ctor
      
       func Make() {
         NewThing()
         Also()
       }
      
       func NewThing() *Thing {
         init()
         ready()
         return &Thing{}
       }
      
       func Also() {}
       func init() {}
       func ready() {}
       type Thing struct{}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Make()
      ├─ Thing()
      │  ├─ init()
    + │  └─ ready()
    + └─ Also()
  `));
});

test("go: defer as branch; skips deferred func literals", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/defer.go": src`
       package main
      
       func Boot() {
         defer cleanup()
         defer func() { hidden() }()
         visible()
       }
      
       func cleanup() {}
       func hidden() {}
       func visible() {}
    `,
  });
  const to = host.commit("after", {
    "/defer.go": src`
       package main
      
       func Boot() {
         defer cleanup()
         defer func() { hidden() }()
         visible()
         also()
       }
      
       func cleanup() {}
       func hidden() {}
       func visible() {}
       func also() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Boot()
      ├─ defer
         └─ cleanup()
      ├─ defer
      ├─ visible()
    + └─ also()
  `));
});

test("go: value receiver methods resolve to Type.Method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/value.go": src`
       package runner
      
       type Worker struct{}
      
       func (w Worker) Start() {
         w.Prepare()
         w.Run()
       }
      
       func (w Worker) Prepare() {}
       func (w Worker) Run() {}
    `,
  });
  const to = host.commit("after", {
    "/value.go": src`
       package runner
      
       type Worker struct{}
      
       func (w Worker) Start() {
         w.Prepare()
         w.Validate()
         w.Run()
       }
      
       func (w Worker) Prepare() {}
       func (w Worker) Validate() {}
       func (w Worker) Run() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Worker.Start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Worker.Start()
      ├─ Worker.Prepare()
    + ├─ Worker.Validate()
      └─ Worker.Run()
  `));
});

test("go: type switch as branches", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/typeswitch.go": src`
       package ctrl
      
       func Handle(x any) {
         switch x.(type) {
         case int:
           DoInt()
         default:
           DoOther()
         }
       }
      
       func DoInt() {}
       func DoOther() {}
    `,
  });
  const to = host.commit("after", {
    "/typeswitch.go": src`
       package ctrl
      
       func Handle(x any) {
         switch x.(type) {
         case int:
           DoInt()
         default:
           DoOther()
         }
         Flush()
       }
      
       func DoInt() {}
       func DoOther() {}
       func Flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Handle(x)
      ├─ case int
         └─ DoInt()
      ├─ default
         └─ DoOther()
    + └─ Flush()
  `));
});

test("go: skips nested function bodies (standalone)", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.go": src`
       package nest
      
       func Outer() {
         visible()
         f := func() {
           hidden()
         }
         _ = f
       }
      
       func visible() {}
       func hidden() {}
    `,
  });
  const to = host.commit("after", {
    "/nested.go": src`
       package nest
      
       func Outer() {
         visible()
         f := func() {
           hidden()
         }
         _ = f
         also()
       }
      
       func visible() {}
       func hidden() {}
       func also() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Outer()
      ├─ visible()
    + └─ also()
  `));
});

test("go: NewThing entrypoint itself expands constructor body", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/newentry.go": src`
       package ctor
      
       func NewThing() *Thing {
         init()
         return &Thing{}
       }
      
       func init() {}
       type Thing struct{}
    `,
  });
  const to = host.commit("after", {
    "/newentry.go": src`
       package ctor
      
       func NewThing() *Thing {
         init()
         ready()
         return &Thing{}
       }
      
       func init() {}
       func ready() {}
       type Thing struct{}
    `,
  });

  const result = host.run(["diff", from, to, "-e", "new Thing"]);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Thing()
      ├─ init()
    + └─ ready()
  `));
});
