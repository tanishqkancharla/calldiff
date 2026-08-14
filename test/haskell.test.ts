import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("haskell: refactors calls into a helper with if/else", () => {
  // File diff markers at column 0 so reconstructed Haskell stays layout-safe.
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
`),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.hs": before });
  const to = host.commit("after", { "/pi.hs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e createAgentSession`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
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
  `));
});

test("haskell: apply chain resolves callees", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
start r =
  prepare r >>
+  validate r >>
  run r

prepare _ = return ()
+validate _ = return ()
run _ = return ()
`),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.hs": before });
  const to = host.commit("after", { "/runner.hs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      start(r)
      ├─ prepare(_)
    + ├─ validate(_)
      └─ run(_)
  `));
});

test("haskell: qualified Module.fun calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
start = do {
  Mod.prepare;
  Other.run;
+ Flush.go;
}
`),
  );

  const host = workspace();
  const from = host.commit("before", { "/qual.hs": before });
  const to = host.commit("after", { "/qual.hs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      start()
      ├─ Mod.prepare()
      ├─ Other.run()
    + └─ Flush.go()
  `));
});

test("haskell: case-of branches; skips let-bound nested bodies", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
`),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.hs": before });
  const to = host.commit("after", { "/ctrl.hs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(x)
      ├─ case 1
         └─ doA()
      ├─ case _
         └─ doOther()
      ├─ visible()
    + └─ flush()
  `));
});

test("haskell: braced do-block sequences calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
boot = do {
  open_;
  work;
+ close_;
}

open_ = return ()
work = return ()
+close_ = return ()
`),
  );

  const host = workspace();
  const from = host.commit("before", { "/doblock.hs": before });
  const to = host.commit("after", { "/doblock.hs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ open_()
      ├─ work()
    + └─ close_()
  `));
});

test("haskell: where-bound helpers not attributed to outer", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
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
`),
  );

  const host = workspace();
  const from = host.commit("before", { "/where.hs": before });
  const to = host.commit("after", { "/where.hs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      start()
      ├─ visible()
    + └─ also()
  `));
});

test("haskell: if/else without do braces", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
handle x =
  if x == 1
    then doA
    else doOther
+     >> flush

doA = return ()
doOther = return ()
+flush = return ()
`),
  );

  const host = workspace();
  const from = host.commit("before", { "/if.hs": before });
  const to = host.commit("after", { "/if.hs": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(x)
      ├─ if x == 1
         └─ doA()
      └─ else
         ├─ doOther()
    +    └─ flush()
  `));
});
