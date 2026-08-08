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
