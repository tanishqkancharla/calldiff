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
