import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("ocaml: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.ml": src`
       let create_agent_session options =
         auth_storage_create ();
         create_coding_tools ();
         if options = None then
           session_manager_create ()
         else
           session_manager_open options
      
      
       and auth_storage_create () = ()
       and create_coding_tools () = ()
       and session_manager_create () = ()
       and session_manager_open _ = ()
    `,
  });
  const to = host.commit("after", {
    "/pi.ml": src`
       let create_agent_session options =
         let services = get_services () in
         services.boot ();
         if options = None then
           session_manager_create ()
         else
           session_manager_open options
      
       and get_services () =
         auth_storage_create ();
         create_coding_tools ();
         { boot = (fun () -> ()) }
      
       and auth_storage_create () = ()
       and create_coding_tools () = ()
       and session_manager_create () = ()
       and session_manager_open _ = ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e create_agent_session`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/runner.ml": src`
       module Runner = struct
         let start r =
           prepare r;
           run r
         and prepare _ = ()
         and run _ = ()
       end
    `,
  });
  const to = host.commit("after", {
    "/runner.ml": src`
       module Runner = struct
         let start r =
           prepare r;
           validate r;
           run r
         and prepare _ = ()
         and validate _ = ()
         and run _ = ()
       end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.start(r)
      ├─ Runner.prepare(_)
    + ├─ Runner.validate(_)
      └─ Runner.run(_)
  `));
});

test("ocaml: Module.fn qualified calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/qual.ml": src`
       let start () =
         Auth.create ();
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
  });
  const to = host.commit("after", {
    "/qual.ml": src`
       let start () =
         Auth.create ();
         Session.open_ ();
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
  });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      start()
      ├─ Auth.create()
    + ├─ Session.open_()
      └─ Tools.build()
  `));
});

test("ocaml: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elseif.ml": src`
       let handle x =
         if x = 1 then do_a ()
         else if x = 2 then (
           do_b ();
         )
         else do_c ()
      
       and do_a () = ()
       and do_b () = ()
       and do_c () = ()
    `,
  });
  const to = host.commit("after", {
    "/elseif.ml": src`
       let handle x =
         if x = 1 then do_a ()
         else if x = 2 then (
           do_b ();
           do_extra ()
         )
         else do_c ()
      
       and do_a () = ()
       and do_b () = ()
       and do_extra () = ()
       and do_c () = ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.ml": src`
       let boot x =
         (match x with
          | 1 -> do_a ()
          | _ -> do_other ());
         (try open_ () with
          | _ -> recover ());
         let nested y = hidden y in
         visible ();
      
       and do_a () = ()
       and do_other () = ()
       and open_ () = ()
       and recover () = ()
       and visible () = ()
       and hidden _ = ()
    `,
  });
  const to = host.commit("after", {
    "/ctrl.ml": src`
       let boot x =
         (match x with
          | 1 -> do_a ()
          | _ -> do_other ());
         (try open_ () with
          | _ -> recover ());
         let nested y = hidden y in
         visible ();
         flush ()
      
       and do_a () = ()
       and do_other () = ()
       and open_ () = ()
       and recover () = ()
       and visible () = ()
       and hidden _ = ()
       and flush () = ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/field.ml": src`
       let boot () =
         let s = { boot = (fun () -> ()) } in
         s.boot ();
      
       and flush () = ()
    `,
  });
  const to = host.commit("after", {
    "/field.ml": src`
       let boot () =
         let s = { boot = (fun () -> ()) } in
         s.boot ();
         flush ()
      
       and flush () = ()
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ s.boot()
    + └─ flush()
  `));
});

test("ocaml: module-local bare calls stay Module.prefixed", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/local.ml": src`
       module Svc = struct
         let start () =
           prepare ();
         and prepare () = ()
       end
    `,
  });
  const to = host.commit("after", {
    "/local.ml": src`
       module Svc = struct
         let start () =
           prepare ();
           finish ()
         and prepare () = ()
         and finish () = ()
       end
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Svc.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Svc.start()
      ├─ Svc.prepare()
    + └─ Svc.finish()
  `));
});
