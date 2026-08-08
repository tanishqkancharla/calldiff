import { test } from "./expectCallstack.js";

test("ocaml: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "create_agent_session",
    { file: "pi.ml" },
  ).toEqual(`
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
  `);
});

test("ocaml: module lets resolve to Module.value", ({ expectCallstack }) => {
  expectCallstack(
    `
      module Runner = struct
        let start r =
          prepare r;
    +     validate r;
          run r
        and prepare _ = ()
    +   and validate _ = ()
        and run _ = ()
      end
    `,
    "Runner.start",
    { file: "runner.ml" },
  ).toEqual(`
      Runner.start(r)
      ├─ Runner.prepare(_)
    + ├─ Runner.validate(_)
      └─ Runner.run(_)
  `);
});

test("ocaml: Module.fn qualified calls", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "start",
    { file: "qual.ml" },
  ).toEqual(`
      start()
      ├─ Auth.create()
    + ├─ Session.open_()
      └─ Tools.build()
  `);
});

test("ocaml: else-if chains", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "handle",
    { file: "elseif.ml" },
  ).toEqual(`
      handle(x)
      ├─ if x = 1
         └─ do_a()
      ├─ else if x = 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_c()
  `);
});

test("ocaml: match and try/with as branches; skips nested funs", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "ctrl.ml" },
  ).toEqual(`
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
  `);
});

test("ocaml: field calls on records", ({ expectCallstack }) => {
  expectCallstack(
    `
      let boot () =
        let s = { boot = (fun () -> ()) } in
        s.boot ();
    +   flush ()

      and flush () = ()
    `,
    "boot",
    { file: "field.ml" },
  ).toEqual(`
      boot()
      ├─ s.boot()
    + └─ flush()
  `);
});

test("ocaml: module-local bare calls stay Module.prefixed", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      module Svc = struct
        let start () =
          prepare ();
    +     finish ()
        and prepare () = ()
    +   and finish () = ()
      end
    `,
    "Svc.start",
    { file: "local.ml" },
  ).toEqual(`
      Svc.start()
      ├─ Svc.prepare()
    + └─ Svc.finish()
  `);
});
