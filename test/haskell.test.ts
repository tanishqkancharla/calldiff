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
