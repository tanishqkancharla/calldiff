import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("zig: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fn createAgentSession(options: Options) void {
    -   authStorageCreate();
    -   createCodingTools();
    +   const services = getServices();
    +   services.boot();
        if (options.session_id == null) {
          sessionManagerCreate();
        } else {
          sessionManagerOpen(options.session_id);
        }
      }

    + fn getServices() Services {
    +   authStorageCreate();
    +   createCodingTools();
    +   return .{};
    + }

      fn authStorageCreate() void {}
      fn createCodingTools() void {}
      fn sessionManagerCreate() void {}
      fn sessionManagerOpen(id: ?[]const u8) void {}
      const Options = struct { session_id: ?[]const u8 };
    + const Services = struct {
    +   fn boot(self: Services) void {}
    + };
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.zig": before });
  const to = host.commit("after", { "/pi.zig": after });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      createAgentSession(options)
    - ├─ authStorageCreate()
    - ├─ createCodingTools()
    + ├─ getServices()
    + │  ├─ authStorageCreate()
    + │  └─ createCodingTools()
    + ├─ services.boot()
      ├─ if options.session_id == null
         └─ sessionManagerCreate()
      └─ else
         └─ sessionManagerOpen(id)
  `));
});

test("zig: self.method resolves to Type.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      const Runner = struct {
          fn start(self: *Runner) void {
              self.prepare();
    +         self.validate();
              self.run();
          }
          fn prepare(self: *Runner) void {}
    +     fn validate(self: *Runner) void {}
          fn run(self: *Runner) void {}
      };
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.zig": before });
  const to = host.commit("after", { "/runner.zig": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start(self)
      ├─ Runner.prepare(self)
    + ├─ Runner.validate(self)
      └─ Runner.run(self)
  `));
});

test("zig: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fn handle(x: i32) void {
        if (x == 1) {
          doA();
        } else if (x == 2) {
          doB();
    +     doExtra();
        } else {
          doC();
        }
      }
      fn doA() void {}
      fn doB() void {}
    + fn doExtra() void {}
      fn doC() void {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elseif.zig": before });
  const to = host.commit("after", { "/elseif.zig": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(x)
      ├─ if x == 1
         └─ doA()
      ├─ else if x == 2
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doC()
  `));
});

test("zig: try and defer as branches; skips nested struct fns", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fn boot(x: i32) !void {
        try open_();
        defer close();
        const Nested = struct {
          fn hidden() void {}
        };
        visible();
    +   flush();
      }
      fn open_() !void {}
      fn close() void {}
      fn visible() void {}
    + fn flush() void {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/try.zig": before });
  const to = host.commit("after", { "/try.zig": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(x)
      ├─ try
         └─ open_()
      ├─ defer
         └─ close()
      ├─ visible()
    + └─ flush()
  `));
});

test("zig: switch cases as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fn handle(x: i32) void {
        switch (x) {
          1 => doA(),
          else => doC(),
        }
    +   flush();
      }
      fn doA() void {}
      fn doC() void {}
    + fn flush() void {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/switch.zig": before });
  const to = host.commit("after", { "/switch.zig": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(x)
      ├─ case 1
         └─ doA()
      ├─ else
         └─ doC()
    + └─ flush()
  `));
});

test("zig: free function helper expansion", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fn make() void {
        init();
    +   ready();
      }
      fn init() void {}
    + fn ready() void {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/init.zig": before });
  const to = host.commit("after", { "/init.zig": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      ├─ init()
    + └─ ready()
  `));
});

test("zig: else-if + try combined control flow", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      fn boot(x: i32) !void {
        if (x == 1) {
          doA();
        } else if (x == 2) {
          doB();
        } else {
          doC();
        }
        try open_();
    +   visible();
      }
      fn doA() void {}
      fn doB() void {}
      fn doC() void {}
      fn open_() !void {}
    + fn visible() void {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/combo.zig": before });
  const to = host.commit("after", { "/combo.zig": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(x)
      ├─ if x == 1
         └─ doA()
      ├─ else if x == 2
         └─ doB()
      ├─ else
         └─ doC()
      ├─ try
         └─ open_()
    + └─ visible()
  `));
});
