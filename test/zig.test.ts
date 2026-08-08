import { test } from "./expectCallstack.js";

test("zig: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "createAgentSession",
    { file: "pi.zig" },
  ).toEqual(`
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
  `);
});

test("zig: self.method resolves to Type.method", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Runner.start",
    { file: "runner.zig" },
  ).toEqual(`
      Runner.start(self)
      ├─ Runner.prepare(self)
    + ├─ Runner.validate(self)
      └─ Runner.run(self)
  `);
});

test("zig: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "handle",
    { file: "elseif.zig" },
  ).toEqual(`
      handle(x)
      ├─ if x == 1
         └─ doA()
      ├─ else if x == 2
         ├─ doB()
    +    └─ doExtra()
      └─ else
         └─ doC()
  `);
});

test("zig: try and defer as branches; skips nested struct fns", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "try.zig" },
  ).toEqual(`
      boot(x)
      ├─ try
         └─ open_()
      ├─ defer
         └─ close()
      ├─ visible()
    + └─ flush()
  `);
});

test("zig: switch cases as branches", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "handle",
    { file: "switch.zig" },
  ).toEqual(`
      handle(x)
      ├─ case 1
         └─ doA()
      ├─ else
         └─ doC()
    + └─ flush()
  `);
});

test("zig: free function helper expansion", ({ expectCallstack }) => {
  expectCallstack(
    `
      fn make() void {
        init();
    +   ready();
      }
      fn init() void {}
    + fn ready() void {}
    `,
    "make",
    { file: "init.zig" },
  ).toEqual(`
      make()
      ├─ init()
    + └─ ready()
  `);
});

test("zig: else-if + try combined control flow", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "combo.zig" },
  ).toEqual(`
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
  `);
});
