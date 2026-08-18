import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("php: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.php": src`
       <?php
       class PiService {
           public static function create_agent_session($options) {
               AuthStorage::create();
               create_coding_tools();
               if (!$options) {
                   SessionManager::create();
               } else {
                   SessionManager::open($options);
               }
           }
       }
       class AuthStorage {
           public static function create() {}
       }
       class SessionManager {
           public static function create() {}
           public static function open($id) {}
       }
       class Services {
           public function boot() {}
       }
       function create_coding_tools() {}
    `,
  });
  const to = host.commit("after", {
    "/pi.php": src`
       <?php
       class PiService {
           public static function create_agent_session($options) {
               $services = self::get_services();
               $services->boot();
               if (!$options) {
                   SessionManager::create();
               } else {
                   SessionManager::open($options);
               }
           }
           public static function get_services() {
               AuthStorage::create();
               create_coding_tools();
               return new Services();
           }
       }
       class AuthStorage {
           public static function create() {}
       }
       class SessionManager {
           public static function create() {}
           public static function open($id) {}
       }
       class Services {
           public function boot() {}
       }
       function create_coding_tools() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e PiService.create_agent_session`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/runner.php": src`
       <?php
       class Runner {
           public function start() {
               $this->prepare();
               $this->run();
           }
           public function prepare() {}
           public function run() {}
       }
    `,
  });
  const to = host.commit("after", {
    "/runner.php": src`
       <?php
       class Runner {
           public function start() {
               $this->prepare();
               $this->validate();
               $this->run();
           }
           public function prepare() {}
           public function validate() {}
           public function run() {}
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("php: new Class expands through __construct", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.php": src`
       <?php
       function make() {
           new Thing();
       }
       class Thing {
           public function __construct() {
               init();
           }
       }
       function init() {}
    `,
  });
  const to = host.commit("after", {
    "/ctor.php": src`
       <?php
       function make() {
           new Thing();
       }
       class Thing {
           public function __construct() {
               init();
               ready();
           }
       }
       function init() {}
       function ready() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      └─ Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("php: does not attribute nested closure/arrow bodies", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/nested.php": src`
       <?php
       function outer() {
           $f = function() { hidden(); };
           $g = fn() => also_hidden();
           visible();
       }
       function hidden() {}
       function also_hidden() {}
       function visible() {}
    `,
  });
  const to = host.commit("after", {
    "/nested.php": src`
       <?php
       function outer() {
           $f = function() { hidden(); };
           $g = fn() => also_hidden();
           visible();
           also_visible();
       }
       function hidden() {}
       function also_hidden() {}
       function visible() {}
       function also_visible() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `));
});

test("php: elseif chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.php": src`
       <?php
       function handle($status) {
           if ($status == 1) {
               do_a();
           } elseif ($status == 2) {
               do_b();
           } else {
               do_other();
           }
       }
       function do_a() {}
       function do_b() {}
       function do_other() {}
    `,
  });
  const to = host.commit("after", {
    "/elif.php": src`
       <?php
       function handle($status) {
           if ($status == 1) {
               do_a();
           } elseif ($status == 2) {
               do_b();
               do_extra();
           } else {
               do_other();
           }
       }
       function do_a() {}
       function do_b() {}
       function do_extra() {}
       function do_other() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/try.php": src`
       <?php
       function boot() {
           try {
               open_();
           } catch (Exception $e) {
               recover();
           } finally {
               close_();
           }
       }
       function open_() {}
       function recover() {}
       function close_() {}
    `,
  });
  const to = host.commit("after", {
    "/try.php": src`
       <?php
       function boot() {
           try {
               open_();
           } catch (Exception $e) {
               recover();
           } finally {
               close_();
           }
           flush();
       }
       function open_() {}
       function recover() {}
       function close_() {}
       function flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/scope.php": src`
       <?php
       class Child {
           public function start() {
               self::helper();
               parent::setup();
               $this->secret();
           }
           public static function helper() {
               work();
           }
           private function secret() {
               hidden();
           }
       }
       function work() {}
       function hidden() {}
    `,
  });
  const to = host.commit("after", {
    "/scope.php": src`
       <?php
       class Child {
           public function start() {
               self::helper();
               parent::setup();
               $this->secret();
               self::extra();
           }
           public static function helper() {
               work();
               more();
           }
           public static function extra() {
               also();
           }
           private function secret() {
               hidden();
               audit();
           }
       }
       function work() {}
       function more() {}
       function also() {}
       function hidden() {}
       function audit() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Child.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
