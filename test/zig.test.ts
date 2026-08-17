import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("zig: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.zig": src`
       fn createAgentSession(options: Options) void {
         authStorageCreate();
         createCodingTools();
         if (options.session_id == null) {
           sessionManagerCreate();
         } else {
           sessionManagerOpen(options.session_id);
         }
       }
      
      
       fn authStorageCreate() void {}
       fn createCodingTools() void {}
       fn sessionManagerCreate() void {}
       fn sessionManagerOpen(id: ?[]const u8) void {}
       const Options = struct { session_id: ?[]const u8 };
    `,
  });
  const to = host.commit("after", {
    "/pi.zig": src`
       fn createAgentSession(options: Options) void {
         const services = getServices();
         services.boot();
         if (options.session_id == null) {
           sessionManagerCreate();
         } else {
           sessionManagerOpen(options.session_id);
         }
       }
      
       fn getServices() Services {
         authStorageCreate();
         createCodingTools();
         return .{};
       }
      
       fn authStorageCreate() void {}
       fn createCodingTools() void {}
       fn sessionManagerCreate() void {}
       fn sessionManagerOpen(id: ?[]const u8) void {}
       const Options = struct { session_id: ?[]const u8 };
       const Services = struct {
         fn boot(self: Services) void {}
       };
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/runner.zig": src`
       const Runner = struct {
           fn start(self: *Runner) void {
               self.prepare();
               self.run();
           }
           fn prepare(self: *Runner) void {}
           fn run(self: *Runner) void {}
       };
    `,
  });
  const to = host.commit("after", {
    "/runner.zig": src`
       const Runner = struct {
           fn start(self: *Runner) void {
               self.prepare();
               self.validate();
               self.run();
           }
           fn prepare(self: *Runner) void {}
           fn validate(self: *Runner) void {}
           fn run(self: *Runner) void {}
       };
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.start(self)
      ├─ Runner.prepare(self)
    + ├─ Runner.validate(self)
      └─ Runner.run(self)
  `));
});

test("zig: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elseif.zig": src`
       fn handle(x: i32) void {
         if (x == 1) {
           doA();
         } else if (x == 2) {
           doB();
         } else {
           doC();
         }
       }
       fn doA() void {}
       fn doB() void {}
       fn doC() void {}
    `,
  });
  const to = host.commit("after", {
    "/elseif.zig": src`
       fn handle(x: i32) void {
         if (x == 1) {
           doA();
         } else if (x == 2) {
           doB();
           doExtra();
         } else {
           doC();
         }
       }
       fn doA() void {}
       fn doB() void {}
       fn doExtra() void {}
       fn doC() void {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/try.zig": src`
       fn boot(x: i32) !void {
         try open_();
         defer close();
         const Nested = struct {
           fn hidden() void {}
         };
         visible();
       }
       fn open_() !void {}
       fn close() void {}
       fn visible() void {}
    `,
  });
  const to = host.commit("after", {
    "/try.zig": src`
       fn boot(x: i32) !void {
         try open_();
         defer close();
         const Nested = struct {
           fn hidden() void {}
         };
         visible();
         flush();
       }
       fn open_() !void {}
       fn close() void {}
       fn visible() void {}
       fn flush() void {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/switch.zig": src`
       fn handle(x: i32) void {
         switch (x) {
           1 => doA(),
           else => doC(),
         }
       }
       fn doA() void {}
       fn doC() void {}
    `,
  });
  const to = host.commit("after", {
    "/switch.zig": src`
       fn handle(x: i32) void {
         switch (x) {
           1 => doA(),
           else => doC(),
         }
         flush();
       }
       fn doA() void {}
       fn doC() void {}
       fn flush() void {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      handle(x)
      ├─ case 1
         └─ doA()
      ├─ else
         └─ doC()
    + └─ flush()
  `));
});

test("zig: free function helper expansion", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/init.zig": src`
       fn make() void {
         init();
       }
       fn init() void {}
    `,
  });
  const to = host.commit("after", {
    "/init.zig": src`
       fn make() void {
         init();
         ready();
       }
       fn init() void {}
       fn ready() void {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      ├─ init()
    + └─ ready()
  `));
});

test("zig: else-if + try combined control flow", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/combo.zig": src`
       fn boot(x: i32) !void {
         if (x == 1) {
           doA();
         } else if (x == 2) {
           doB();
         } else {
           doC();
         }
         try open_();
       }
       fn doA() void {}
       fn doB() void {}
       fn doC() void {}
       fn open_() !void {}
    `,
  });
  const to = host.commit("after", {
    "/combo.zig": src`
       fn boot(x: i32) !void {
         if (x == 1) {
           doA();
         } else if (x == 2) {
           doB();
         } else {
           doC();
         }
         try open_();
         visible();
       }
       fn doA() void {}
       fn doB() void {}
       fn doC() void {}
       fn open_() !void {}
       fn visible() void {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
