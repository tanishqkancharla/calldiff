import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("cpp: refactors calls into a helper with if/else", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/pi.cpp": src`
       void CreateAgentSession(int options) {
         AuthStorage_create();
         create_coding_tools();
         if (options == 0) {
           SessionManager_create();
         } else {
           SessionManager_open(options);
         }
       }
      
      
       void AuthStorage_create() {}
       void create_coding_tools() {}
       void SessionManager_create() {}
       void SessionManager_open(int id) {}
    `,
  });
  const to = host.commit("after", {
    "/pi.cpp": src`
       void CreateAgentSession(int options) {
         GetServices();
         services_boot();
         if (options == 0) {
           SessionManager_create();
         } else {
           SessionManager_open(options);
         }
       }
      
       void GetServices() {
         AuthStorage_create();
         create_coding_tools();
       }
      
       void AuthStorage_create() {}
       void create_coding_tools() {}
       void SessionManager_create() {}
       void SessionManager_open(int id) {}
       void services_boot() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e CreateAgentSession`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      CreateAgentSession(options)
    - ├─ AuthStorage_create()
    - ├─ create_coding_tools()
    + ├─ GetServices()
    + │  ├─ AuthStorage_create()
    + │  └─ create_coding_tools()
    + ├─ services_boot()
      ├─ if options == 0
         └─ SessionManager_create()
      └─ else
         └─ SessionManager_open(id)
  `));
});

test("cpp: this->method resolves to Class.method", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/runner.cpp": src`
       class Runner {
       public:
         void start() {
           this->prepare();
           this->run();
         }
         void prepare() {}
         void run() {}
       };
    `,
  });
  const to = host.commit("after", {
    "/runner.cpp": src`
       class Runner {
       public:
         void start() {
           this->prepare();
           this->validate();
           this->run();
         }
         void prepare() {}
         void validate() {}
         void run() {}
       };
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

test("cpp: new Class() expands through the constructor", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/ctor.cpp": src`
       void make() {
         new Thing();
       }
       class Thing {
       public:
         Thing() {
           init();
         }
       };
       void init() {}
    `,
  });
  const to = host.commit("after", {
    "/ctor.cpp": src`
       void make() {
         new Thing();
       }
       class Thing {
       public:
         Thing() {
           init();
           ready();
         }
       };
       void init() {}
       void ready() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      make()
      └─ new Thing()
         ├─ init()
    +    └─ ready()
  `));
});

test("cpp: does not attribute lambda bodies to the caller", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/lambda.cpp": src`
       void outer() {
         auto f = []() { hidden(); };
         visible();
       }
       void hidden() {}
       void visible() {}
    `,
  });
  const to = host.commit("after", {
    "/lambda.cpp": src`
       void outer() {
         auto f = []() { hidden(); };
         visible();
         also_visible();
       }
       void hidden() {}
       void visible() {}
       void also_visible() {}
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

test("cpp: else-if chains", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/elif.cpp": src`
       void handle(int status) {
         if (status == 1) {
           do_a();
         } else if (status == 2) {
           do_b();
         } else {
           do_other();
         }
       }
       void do_a() {}
       void do_b() {}
       void do_other() {}
    `,
  });
  const to = host.commit("after", {
    "/elif.cpp": src`
       void handle(int status) {
         if (status == 1) {
           do_a();
         } else if (status == 2) {
           do_b();
           do_extra();
         } else {
           do_other();
         }
       }
       void do_a() {}
       void do_b() {}
       void do_extra() {}
       void do_other() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      handle(status)
      ├─ if status == 1
         └─ do_a()
      ├─ else if status == 2
         ├─ do_b()
    +    └─ do_extra()
      └─ else
         └─ do_other()
  `));
});

test("cpp: try/catch as branches", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/try.cpp": src`
       void boot() {
         try {
           open_();
         } catch (int e) {
           recover();
         } catch (...) {
           other();
         }
       }
       void open_() {}
       void recover() {}
       void other() {}
    `,
  });
  const to = host.commit("after", {
    "/try.cpp": src`
       void boot() {
         try {
           open_();
         } catch (int e) {
           recover();
         } catch (...) {
           other();
         }
         flush();
       }
       void open_() {}
       void recover() {}
       void other() {}
       void flush() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      boot()
      ├─ try
         └─ open_()
      ├─ catch (int e)
         └─ recover()
      ├─ catch (...)
         └─ other()
    + └─ flush()
  `));
});

test("cpp: static Class::method resolves and expands", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/static.cpp": src`
       class Runner {
       public:
         void start() {
           Runner::helper();
         }
         static void helper() {
           work();
         }
       };
       void work() {}
    `,
  });
  const to = host.commit("after", {
    "/static.cpp": src`
       class Runner {
       public:
         void start() {
           Runner::helper();
           Runner::extra();
         }
         static void helper() {
           work();
           more();
         }
         static void extra() {
           also();
         }
       };
       void work() {}
       void more() {}
       void also() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Runner.start()
      ├─ Runner.helper()
      │  ├─ work()
    + │  └─ more()
    + └─ Runner.extra()
    +    └─ also()
  `));
});

test("cpp: pointer arrow calls on receivers", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/arrow.cpp": src`
       class Runner {
       public:
         void prepare() {}
         void run() {}
       };
       void go(Runner *r) {
         r->prepare();
         r->run();
       }
    `,
  });
  const to = host.commit("after", {
    "/arrow.cpp": src`
       class Runner {
       public:
         void prepare() {}
         void run() {}
         void validate() {}
       };
       void go(Runner *r) {
         r->prepare();
         r->run();
         r->validate();
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e go`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      go(r)
      ├─ r.prepare()
      ├─ r.run()
    + └─ r.validate()
  `));
});
