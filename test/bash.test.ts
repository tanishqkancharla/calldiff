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
