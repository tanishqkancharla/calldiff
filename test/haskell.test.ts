import { test } from "./expectCallstack.js";

test("haskell: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  // File diff markers at column 0 so reconstructed Haskell stays layout-safe.
  expectCallstack(
    `
createAgentSession options = do {
-  authStorageCreate;
-  createCodingTools;
+  getServices;
   if null (sessionId options)
     then sessionManagerCreate
     else sessionManagerOpen (sessionId options);
}

+getServices = do {
+  authStorageCreate;
+  createCodingTools;
+}

authStorageCreate = return ()
createCodingTools = return ()
sessionManagerCreate = return ()
sessionManagerOpen _ = return ()
sessionId _ = Nothing
`,
    "createAgentSession",
    { file: "pi.hs" },
  ).toEqual(`
      createAgentSession(options)
    - ├─ authStorageCreate()
    - ├─ createCodingTools()
    + ├─ getServices()
    + │  ├─ authStorageCreate()
    + │  └─ createCodingTools()
      ├─ if null (sessionId options)
         └─ sessionManagerCreate()
      └─ else
         ├─ sessionManagerOpen(_)
         └─ sessionId(_)
  `);
});

test("haskell: apply chain resolves callees", ({ expectCallstack }) => {
  expectCallstack(
    `
start r =
  prepare r >>
+  validate r >>
  run r

prepare _ = return ()
+validate _ = return ()
run _ = return ()
`,
    "start",
    { file: "runner.hs" },
  ).toEqual(`
      start(r)
      ├─ prepare(_)
    + ├─ validate(_)
      └─ run(_)
  `);
});

test("haskell: qualified Module.fun calls", ({ expectCallstack }) => {
  expectCallstack(
    `
start = do {
  Mod.prepare;
  Other.run;
+ Flush.go;
}
`,
    "start",
    { file: "qual.hs" },
  ).toEqual(`
      start()
      ├─ Mod.prepare()
      ├─ Other.run()
    + └─ Flush.go()
  `);
});

test("haskell: case-of branches; skips let-bound nested bodies", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
boot x = do {
  case x of {
    1 -> doA;
    _ -> doOther;
  };
  let nested = hidden in visible;
+ flush;
}

doA = return ()
doOther = return ()
hidden = return ()
visible = return ()
+flush = return ()
`,
    "boot",
    { file: "ctrl.hs" },
  ).toEqual(`
      boot(x)
      ├─ case 1
         └─ doA()
      ├─ case _
         └─ doOther()
      ├─ visible()
    + └─ flush()
  `);
});

test("haskell: braced do-block sequences calls", ({ expectCallstack }) => {
  expectCallstack(
    `
boot = do {
  open_;
  work;
+ close_;
}

open_ = return ()
work = return ()
+close_ = return ()
`,
    "boot",
    { file: "doblock.hs" },
  ).toEqual(`
      boot()
      ├─ open_()
      ├─ work()
    + └─ close_()
  `);
});

test("haskell: where-bound helpers not attributed to outer", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
start = do {
  visible;
+ also;
}
  where {
    nested = hidden;
  }

visible = return ()
+also = return ()
hidden = return ()
`,
    "start",
    { file: "where.hs" },
  ).toEqual(`
      start()
      ├─ visible()
    + └─ also()
  `);
});

test("haskell: if/else without do braces", ({ expectCallstack }) => {
  expectCallstack(
    `
handle x =
  if x == 1
    then doA
    else doOther
+     >> flush

doA = return ()
doOther = return ()
+flush = return ()
`,
    "handle",
    { file: "if.hs" },
  ).toEqual(`
      handle(x)
      ├─ if x == 1
         └─ doA()
      └─ else
         ├─ doOther()
    +    └─ flush()
  `);
});
