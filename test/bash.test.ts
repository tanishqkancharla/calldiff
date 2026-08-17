import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("bash: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.sh": src`
       create_agent_session() {
         auth_storage_create
         create_coding_tools
         if [ -z "$SESSION_ID" ]; then
           session_manager_create
         else
           session_manager_open "$SESSION_ID"
         fi
       }
      
      
       auth_storage_create() { :; }
       create_coding_tools() { :; }
       session_manager_create() { :; }
       session_manager_open() { :; }
    `,
  });
  const to = host.commit("after", {
    "/pi.sh": src`
       create_agent_session() {
         get_services
         if [ -z "$SESSION_ID" ]; then
           session_manager_create
         else
           session_manager_open "$SESSION_ID"
         fi
       }
      
       get_services() {
         auth_storage_create
         create_coding_tools
       }
      
       auth_storage_create() { :; }
       create_coding_tools() { :; }
       session_manager_create() { :; }
       session_manager_open() { :; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e create_agent_session`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      create_agent_session()
    - ├─ auth_storage_create()
    - ├─ create_coding_tools()
    + ├─ get_services()
    + │  ├─ auth_storage_create()
    + │  └─ create_coding_tools()
      ├─ if [ -z "$SESSION_ID" ]
         └─ session_manager_create()
      └─ else
         └─ session_manager_open()
  `));
});

test("bash: skips nested function bodies", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.bash": src`
       nested_demo() {
         outer_call
         nested() {
           hidden_call
         }
         visible_call
       }
      
       outer_call() { :; }
       visible_call() { :; }
       hidden_call() { :; }
    `,
  });
  const to = host.commit("after", {
    "/nested.bash": src`
       nested_demo() {
         outer_call
         nested() {
           hidden_call
         }
         visible_call
         also_visible
       }
      
       outer_call() { :; }
       visible_call() { :; }
       also_visible() { :; }
       hidden_call() { :; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e nested_demo`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      nested_demo()
      ├─ outer_call()
      ├─ visible_call()
    + └─ also_visible()
  `));
});

test("bash: elif chains and case branches", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctrl.sh": src`
       boot() {
         if [ "$x" = a ]; then
           do_a
         elif [ "$x" = b ]; then
           do_b
         else
           do_c
         fi
         case "$x" in
           a) do_a ;;
           *) do_c ;;
         esac
       }
      
       do_a() { :; }
       do_b() { :; }
       do_c() { :; }
    `,
  });
  const to = host.commit("after", {
    "/ctrl.sh": src`
       boot() {
         if [ "$x" = a ]; then
           do_a
         elif [ "$x" = b ]; then
           do_b
           do_extra
         else
           do_c
         fi
         case "$x" in
           a) do_a ;;
           *) do_c ;;
         esac
         flush
       }
      
       do_a() { :; }
       do_b() { :; }
       do_extra() { :; }
       do_c() { :; }
       flush() { :; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ if [ "$x" = a ]
         └─ do_a()
      ├─ elif [ "$x" = b ]
         ├─ do_b()
    +    └─ do_extra()
      ├─ else
         └─ do_c()
      ├─ case a
         └─ do_a()
      ├─ case *
         └─ do_c()
    + └─ flush()
  `));
});

test("bash: command substitution calls are followed", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/sub.sh": src`
       boot() {
         result=$(sub_call)
         visible
       }
      
       sub_call() { :; }
       visible() { :; }
    `,
  });
  const to = host.commit("after", {
    "/sub.sh": src`
       boot() {
         result=$(sub_call)
         visible
         also
       }
      
       sub_call() { :; }
       visible() { :; }
       also() { :; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ sub_call()
      ├─ visible()
    + └─ also()
  `));
});

test("bash: plain command calls with arguments", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/cmds.sh": src`
       deploy() {
         prepare_env "prod"
         restart_service app
       }
      
       prepare_env() { :; }
       restart_service() { :; }
    `,
  });
  const to = host.commit("after", {
    "/cmds.sh": src`
       deploy() {
         prepare_env "prod"
         restart_service app
         notify_done
       }
      
       prepare_env() { :; }
       restart_service() { :; }
       notify_done() { :; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e deploy`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      deploy()
      ├─ prepare_env()
      ├─ restart_service()
    + └─ notify_done()
  `));
});

test("bash: ignores builtins and still tracks helper calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/builtins.sh": src`
       boot() {
         local x=1
         echo hello
         real_work
         return 0
       }
      
       real_work() { :; }
    `,
  });
  const to = host.commit("after", {
    "/builtins.sh": src`
       boot() {
         local x=1
         echo hello
         real_work
         more_work
         return 0
       }
      
       real_work() { :; }
       more_work() { :; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ real_work()
    + └─ more_work()
  `));
});

test("bash: helper refactor with nested if only", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/start.sh": src`
       start() {
         setup
         if [ -f "$CFG" ]; then
           load_cfg
         else
           default_cfg
         fi
       }
      
      
       setup() { :; }
       load_cfg() { :; }
       default_cfg() { :; }
    `,
  });
  const to = host.commit("after", {
    "/start.sh": src`
       start() {
         init_all
         if [ -f "$CFG" ]; then
           load_cfg
         else
           default_cfg
         fi
       }
      
       init_all() {
         setup
       }
      
       setup() { :; }
       load_cfg() { :; }
       default_cfg() { :; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      start()
    - ├─ setup()
    + ├─ init_all()
    + │  └─ setup()
      ├─ if [ -f "$CFG" ]
         └─ load_cfg()
      └─ else
         └─ default_cfg()
  `));
});
