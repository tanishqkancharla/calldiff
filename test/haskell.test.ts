import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("haskell: refactors calls into a helper with if/else", () => {
  // File diff markers at column 0 so reconstructed Haskell stays layout-safe.
  const host = workspace();
  const from = host.commit("before", {
    "/pi.hs": src`
      createAgentSession options = do {
        authStorageCreate;
        createCodingTools;
        if null (sessionId options)
          then sessionManagerCreate
          else sessionManagerOpen (sessionId options);
      }
      
      
      authStorageCreate = return ()
      createCodingTools = return ()
      sessionManagerCreate = return ()
      sessionManagerOpen _ = return ()
      sessionId _ = Nothing
    `,
  });
  const to = host.commit("after", {
    "/pi.hs": src`
      createAgentSession options = do {
        getServices;
        if null (sessionId options)
          then sessionManagerCreate
          else sessionManagerOpen (sessionId options);
      }
      
      getServices = do {
        authStorageCreate;
        createCodingTools;
      }
      
      authStorageCreate = return ()
      createCodingTools = return ()
      sessionManagerCreate = return ()
      sessionManagerOpen _ = return ()
      sessionId _ = Nothing
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
      ├─ if null (sessionId options)
         └─ sessionManagerCreate()
      └─ else
         ├─ sessionManagerOpen(_)
         └─ sessionId(_)
  `));
});

test("haskell: apply chain resolves callees", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.hs": src`
      start r =
       prepare r >>
       run r
      
      prepare _ = return ()
      run _ = return ()
    `,
  });
  const to = host.commit("after", {
    "/runner.hs": src`
      start r =
       prepare r >>
        validate r >>
       run r
      
      prepare _ = return ()
      validate _ = return ()
      run _ = return ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      start(r)
      ├─ prepare(_)
    + ├─ validate(_)
      └─ run(_)
  `));
});

test("haskell: qualified Module.fun calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/qual.hs": src`
      start = do {
       Mod.prepare;
       Other.run;
      }
    `,
  });
  const to = host.commit("after", {
    "/qual.hs": src`
      start = do {
       Mod.prepare;
       Other.run;
       Flush.go;
      }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      start()
      ├─ Mod.prepare()
      ├─ Other.run()
    + └─ Flush.go()
  `));
});

test("haskell: case-of branches; skips let-bound nested bodies", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.hs": src`
      boot x = do {
       case x of {
         1 -> doA;
         _ -> doOther;
       };
       let nested = hidden in visible;
      }
      
      doA = return ()
      doOther = return ()
      hidden = return ()
      visible = return ()
    `,
  });
  const to = host.commit("after", {
    "/ctrl.hs": src`
      boot x = do {
       case x of {
         1 -> doA;
         _ -> doOther;
       };
       let nested = hidden in visible;
       flush;
      }
      
      doA = return ()
      doOther = return ()
      hidden = return ()
      visible = return ()
      flush = return ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/doblock.hs": src`
      boot = do {
       open_;
       work;
      }
      
      open_ = return ()
      work = return ()
    `,
  });
  const to = host.commit("after", {
    "/doblock.hs": src`
      boot = do {
       open_;
       work;
       close_;
      }
      
      open_ = return ()
      work = return ()
      close_ = return ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ open_()
      ├─ work()
    + └─ close_()
  `));
});

test("haskell: where-bound helpers not attributed to outer", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/where.hs": src`
      start = do {
       visible;
      }
       where {
         nested = hidden;
       }
      
      visible = return ()
      hidden = return ()
    `,
  });
  const to = host.commit("after", {
    "/where.hs": src`
      start = do {
       visible;
       also;
      }
       where {
         nested = hidden;
       }
      
      visible = return ()
      also = return ()
      hidden = return ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      start()
      ├─ visible()
    + └─ also()
  `));
});

test("haskell: if/else without do braces", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/if.hs": src`
      handle x =
       if x == 1
         then doA
         else doOther
      
      doA = return ()
      doOther = return ()
    `,
  });
  const to = host.commit("after", {
    "/if.hs": src`
      handle x =
       if x == 1
         then doA
         else doOther
           >> flush
      
      doA = return ()
      doOther = return ()
      flush = return ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      handle(x)
      ├─ if x == 1
         └─ doA()
      └─ else
         ├─ doOther()
    +    └─ flush()
  `));
});
