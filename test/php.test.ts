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
