import { test } from "./expectCallstack.js";

test("bash: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      create_agent_session() {
    -   auth_storage_create
    -   create_coding_tools
    +   get_services
        if [ -z "$SESSION_ID" ]; then
          session_manager_create
        else
          session_manager_open "$SESSION_ID"
        fi
      }

    + get_services() {
    +   auth_storage_create
    +   create_coding_tools
    + }

      auth_storage_create() { :; }
      create_coding_tools() { :; }
      session_manager_create() { :; }
      session_manager_open() { :; }
    `,
    "create_agent_session",
    { file: "pi.sh" },
  ).toEqual(`
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
  `);
});

test("bash: skips nested function bodies", ({ expectCallstack }) => {
  expectCallstack(
    `
      nested_demo() {
        outer_call
        nested() {
          hidden_call
        }
        visible_call
    +   also_visible
      }

      outer_call() { :; }
      visible_call() { :; }
    + also_visible() { :; }
      hidden_call() { :; }
    `,
    "nested_demo",
    { file: "nested.bash" },
  ).toEqual(`
      nested_demo()
      ├─ outer_call()
      ├─ visible_call()
    + └─ also_visible()
  `);
});

test("bash: elif chains and case branches", ({ expectCallstack }) => {
  expectCallstack(
    `
      boot() {
        if [ "$x" = a ]; then
          do_a
        elif [ "$x" = b ]; then
          do_b
    +     do_extra
        else
          do_c
        fi
        case "$x" in
          a) do_a ;;
          *) do_c ;;
        esac
    +   flush
      }

      do_a() { :; }
      do_b() { :; }
    + do_extra() { :; }
      do_c() { :; }
    + flush() { :; }
    `,
    "boot",
    { file: "ctrl.sh" },
  ).toEqual(`
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
  `);
});

test("bash: command substitution calls are followed", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      boot() {
        result=$(sub_call)
        visible
    +   also
      }

      sub_call() { :; }
      visible() { :; }
    + also() { :; }
    `,
    "boot",
    { file: "sub.sh" },
  ).toEqual(`
      boot()
      ├─ sub_call()
      ├─ visible()
    + └─ also()
  `);
});

test("bash: plain command calls with arguments", ({ expectCallstack }) => {
  expectCallstack(
    `
      deploy() {
        prepare_env "prod"
        restart_service app
    +   notify_done
      }

      prepare_env() { :; }
      restart_service() { :; }
    + notify_done() { :; }
    `,
    "deploy",
    { file: "cmds.sh" },
  ).toEqual(`
      deploy()
      ├─ prepare_env()
      ├─ restart_service()
    + └─ notify_done()
  `);
});

test("bash: ignores builtins and still tracks helper calls", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      boot() {
        local x=1
        echo hello
        real_work
    +   more_work
        return 0
      }

      real_work() { :; }
    + more_work() { :; }
    `,
    "boot",
    { file: "builtins.sh" },
  ).toEqual(`
      boot()
      ├─ real_work()
    + └─ more_work()
  `);
});

test("bash: helper refactor with nested if only", ({ expectCallstack }) => {
  expectCallstack(
    `
      start() {
    -   setup
    +   init_all
        if [ -f "$CFG" ]; then
          load_cfg
        else
          default_cfg
        fi
      }

    + init_all() {
    +   setup
    + }

      setup() { :; }
      load_cfg() { :; }
      default_cfg() { :; }
    `,
    "start",
    { file: "start.sh" },
  ).toEqual(`
      start()
    - ├─ setup()
    + ├─ init_all()
    + │  └─ setup()
      ├─ if [ -f "$CFG" ]
         └─ load_cfg()
      └─ else
         └─ default_cfg()
  `);
});
