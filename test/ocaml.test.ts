import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("ocaml: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      let create_agent_session options =
    -   auth_storage_create ();
    -   create_coding_tools ();
    +   let services = get_services () in
    +   services.boot ();
        if options = None then
          session_manager_create ()
        else
          session_manager_open options

    + and get_services () =
    +   auth_storage_create ();
    +   create_coding_tools ();
    +   { boot = (fun () -> ()) }

      and auth_storage_create () = ()
      and create_coding_tools () = ()
      and session_manager_create () = ()
      and session_manager_open _ = ()
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.ml": before });
  const to = host.commit("after", { "/pi.ml": after });

  const result = host.run(`calldiff diff ${from} ${to} -e create_agent_session`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      create_agent_session(options)
    - ├─ auth_storage_create()
    - ├─ create_coding_tools()
    + ├─ get_services()
    + │  ├─ auth_storage_create()
    + │  └─ create_coding_tools()
    + ├─ services.boot()
      ├─ if options = None
         └─ session_manager_create()
      └─ else
         └─ session_manager_open(_)
  `));
});

test("ocaml: module lets resolve to Module.value", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      module Runner = struct
        let start r =
          prepare r;
    +     validate r;
          run r
        and prepare _ = ()
    +   and validate _ = ()
        and run _ = ()
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.ml": before });
  const to = host.commit("after", { "/runner.ml": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start(r)
      ├─ Runner.prepare(_)
    + ├─ Runner.validate(_)
      └─ Runner.run(_)
  `));
});

test("ocaml: Module.fn qualified calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      let start () =
        Auth.create ();
    +   Session.open_ ();
        Tools.build ()

      and unused () = ()

      module Auth = struct
        let create () = ()
      end
      module Session = struct
        let open_ () = ()
      end
      module Tools = struct
        let build () = ()
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/qual.ml": before });
  const to = host.commit("after", { "/qual.ml": after });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      start()
      ├─ Auth.create()
    + ├─ Session.open_()
      └─ Tools.build()
  `));
});

test("ocaml: else-if chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      let handle x =
        if x = 1 then do_a ()
        else if x = 2 then (
          do_b ();
    +     do_extra ()
        )
        else do_c ()

      and do_a () = ()
      and do_b () = ()
    + and do_extra () = ()
      and do_c () = ()
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elseif.ml": before });
  const to = host.commit("after", { "/elseif.ml": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(x)
      ├─ if x = 1
         └─ do_a()
      ├─ else if x = 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_c()
  `));
});

test("ocaml: match and try/with as branches; skips nested funs", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      let boot x =
        (match x with
         | 1 -> do_a ()
         | _ -> do_other ());
        (try open_ () with
         | _ -> recover ());
        let nested y = hidden y in
        visible ();
    +   flush ()

      and do_a () = ()
      and do_other () = ()
      and open_ () = ()
      and recover () = ()
      and visible () = ()
      and hidden _ = ()
    + and flush () = ()
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.ml": before });
  const to = host.commit("after", { "/ctrl.ml": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot(x)
      ├─ case 1
         └─ do_a()
      ├─ case _
         └─ do_other()
      ├─ try
         └─ open_()
      ├─ with _
         └─ recover()
      ├─ visible()
    + └─ flush()
  `));
});

test("ocaml: field calls on records", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      let boot () =
        let s = { boot = (fun () -> ()) } in
        s.boot ();
    +   flush ()

      and flush () = ()
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/field.ml": before });
  const to = host.commit("after", { "/field.ml": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ s.boot()
    + └─ flush()
  `));
});

test("ocaml: module-local bare calls stay Module.prefixed", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      module Svc = struct
        let start () =
          prepare ();
    +     finish ()
        and prepare () = ()
    +   and finish () = ()
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/local.ml": before });
  const to = host.commit("after", { "/local.ml": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Svc.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Svc.start()
      ├─ Svc.prepare()
    + └─ Svc.finish()
  `));
});
