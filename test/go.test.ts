import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("go: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.go": before });
  const to = host.commit("after", { "/pi.go": after });

  const result = host.run(`calldiff diff ${from} ${to} -e CreateAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.go": before });
  const to = host.commit("after", { "/runner.go": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.Start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.Start()
      ├─ Runner.Prepare()
    + ├─ Runner.Validate()
      └─ Runner.Run()
  `));
});

test("go: else-if and switch as branches; skips nested funcs", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.go": before });
  const to = host.commit("after", { "/ctrl.go": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.go": before });
  const to = host.commit("after", { "/ctor.go": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Make()
      ├─ Thing()
      │  ├─ init()
    + │  └─ ready()
    + └─ Also()
  `));
});

test("go: defer as branch; skips deferred func literals", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      package main

      func Boot() {
        defer cleanup()
        defer func() { hidden() }()
        visible()
    +   also()
      }

      func cleanup() {}
      func hidden() {}
      func visible() {}
    + func also() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/defer.go": before });
  const to = host.commit("after", { "/defer.go": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Boot()
      ├─ defer
         └─ cleanup()
      ├─ defer
      ├─ visible()
    + └─ also()
  `));
});

test("go: value receiver methods resolve to Type.Method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      package runner

      type Worker struct{}

      func (w Worker) Start() {
        w.Prepare()
    +   w.Validate()
        w.Run()
      }

      func (w Worker) Prepare() {}
    + func (w Worker) Validate() {}
      func (w Worker) Run() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/value.go": before });
  const to = host.commit("after", { "/value.go": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Worker.Start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Worker.Start()
      ├─ Worker.Prepare()
    + ├─ Worker.Validate()
      └─ Worker.Run()
  `));
});

test("go: type switch as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      package ctrl

      func Handle(x any) {
        switch x.(type) {
        case int:
          DoInt()
        default:
          DoOther()
        }
    +   Flush()
      }

      func DoInt() {}
      func DoOther() {}
    + func Flush() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/typeswitch.go": before });
  const to = host.commit("after", { "/typeswitch.go": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Handle(x)
      ├─ case int
         └─ DoInt()
      ├─ default
         └─ DoOther()
    + └─ Flush()
  `));
});

test("go: skips nested function bodies (standalone)", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      package nest

      func Outer() {
        visible()
        f := func() {
          hidden()
        }
        _ = f
    +   also()
      }

      func visible() {}
      func hidden() {}
    + func also() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.go": before });
  const to = host.commit("after", { "/nested.go": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Outer()
      ├─ visible()
    + └─ also()
  `));
});

test("go: NewThing entrypoint itself expands constructor body", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      package ctor

      func NewThing() *Thing {
        init()
    +   ready()
        return &Thing{}
      }

      func init() {}
    + func ready() {}
      type Thing struct{}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/newentry.go": before });
  const to = host.commit("after", { "/newentry.go": after });

  const result = host.run(["diff", from, to, "-e", "new Thing"]);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Thing()
      ├─ init()
    + └─ ready()
  `));
});
