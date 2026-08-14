import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("php: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      <?php
      class PiService {
          public static function create_agent_session(\$options) {
    -         AuthStorage::create();
    -         create_coding_tools();
    +         \$services = self::get_services();
    +         \$services->boot();
              if (!\$options) {
                  SessionManager::create();
              } else {
                  SessionManager::open(\$options);
              }
          }
    +     public static function get_services() {
    +         AuthStorage::create();
    +         create_coding_tools();
    +         return new Services();
    +     }
      }
      class AuthStorage {
          public static function create() {}
      }
      class SessionManager {
          public static function create() {}
          public static function open(\$id) {}
      }
      class Services {
          public function boot() {}
      }
      function create_coding_tools() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.php": before });
  const to = host.commit("after", { "/pi.php": after });

  const result = host.run(`calldiff diff ${from} ${to} -e PiService.create_agent_session`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      PiService.create_agent_session(options)
    - ├─ AuthStorage.create()
    - ├─ create_coding_tools()
    + ├─ PiService.get_services()
    + │  ├─ AuthStorage.create()
    + │  ├─ create_coding_tools()
    + │  └─ new Services()
    + ├─ services.boot()
      ├─ if !\$options
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(id)
  `));
});

test("php: \$this->method resolves to Class.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      <?php
      class Runner {
          public function start() {
              \$this->prepare();
    +         \$this->validate();
              \$this->run();
          }
          public function prepare() {}
    +     public function validate() {}
          public function run() {}
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.php": before });
  const to = host.commit("after", { "/runner.php": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("php: new Class expands through __construct", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      <?php
      function make() {
          new Thing();
      }
      class Thing {
          public function __construct() {
              init();
    +         ready();
          }
      }
      function init() {}
    + function ready() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.php": before });
  const to = host.commit("after", { "/ctor.php": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      └─ Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("php: does not attribute nested closure/arrow bodies", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      <?php
      function outer() {
          \$f = function() { hidden(); };
          \$g = fn() => also_hidden();
          visible();
    +     also_visible();
      }
      function hidden() {}
      function also_hidden() {}
      function visible() {}
    + function also_visible() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.php": before });
  const to = host.commit("after", { "/nested.php": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `));
});

test("php: elseif chains", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      <?php
      function handle(\$status) {
          if (\$status == 1) {
              do_a();
          } elseif (\$status == 2) {
              do_b();
    +         do_extra();
          } else {
              do_other();
          }
      }
      function do_a() {}
      function do_b() {}
    + function do_extra() {}
      function do_other() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elif.php": before });
  const to = host.commit("after", { "/elif.php": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle(status)
      ├─ if \$status == 1
         └─ do_a()
      ├─ elseif \$status == 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `));
});

test("php: try/catch/finally as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      <?php
      function boot() {
          try {
              open_();
          } catch (Exception \$e) {
              recover();
          } finally {
              close_();
          }
    +     flush();
      }
      function open_() {}
      function recover() {}
      function close_() {}
    + function flush() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/try.php": before });
  const to = host.commit("after", { "/try.php": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ try
         └─ open_()
      ├─ catch Exception
         └─ recover()
      ├─ finally
         └─ close_()
    + └─ flush()
  `));
});

test("php: self/parent and private methods", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      <?php
      class Child {
          public function start() {
              self::helper();
              parent::setup();
              \$this->secret();
    +         self::extra();
          }
          public static function helper() {
              work();
    +         more();
          }
    +     public static function extra() {
    +         also();
    +     }
          private function secret() {
              hidden();
    +         audit();
          }
      }
      function work() {}
    + function more() {}
    + function also() {}
      function hidden() {}
    + function audit() {}
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/scope.php": before });
  const to = host.commit("after", { "/scope.php": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Child.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Child.start()
      ├─ Child.helper()
      │  ├─ work()
    + │  └─ more()
      ├─ Child.setup()
      ├─ Child.secret()
      │  ├─ hidden()
    + │  └─ audit()
    + └─ Child.extra()
    +    └─ also()
  `));
});
