import { test } from "./expectCallstack.js";

test("php: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "PiService.create_agent_session",
    { file: "pi.php" },
  ).toEqual(`
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
  `);
});

test("php: \$this->method resolves to Class.method", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Runner.start",
    { file: "runner.php" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});

test("php: new Class expands through __construct", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "make",
    { file: "ctor.php" },
  ).toEqual(`
      make()
      └─ Thing()
         ├─ init()
    +    └─ ready()
  `);
});

test("php: does not attribute nested closure/arrow bodies", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "outer",
    { file: "nested.php" },
  ).toEqual(`
      outer()
      ├─ visible()
    + └─ also_visible()
  `);
});

test("php: elseif chains", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "handle",
    { file: "elif.php" },
  ).toEqual(`
      handle(status)
      ├─ if \$status == 1
         └─ do_a()
      ├─ elseif \$status == 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `);
});

test("php: try/catch/finally as branches", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "boot",
    { file: "try.php" },
  ).toEqual(`
      boot()
      ├─ try
         └─ open_()
      ├─ catch Exception
         └─ recover()
      ├─ finally
         └─ close_()
    + └─ flush()
  `);
});

test("php: self/parent and private methods", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Child.start",
    { file: "scope.php" },
  ).toEqual(`
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
  `);
});
