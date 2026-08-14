import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("perl: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      sub create_agent_session {
          my ($options) = @_;
      -   AuthStorage::create();
      -   create_coding_tools();
      +   my $services = get_services;
      +   $services->boot();
          if ($options->{session_id}) {
              SessionManager::open($options->{session_id});
          } else {
              SessionManager::create();
          }
      }

      + sub get_services {
      +     AuthStorage::create();
      +     create_coding_tools();
      + }

      sub create_coding_tools { }

      sub AuthStorage::create { }
      sub SessionManager::create { }
      sub SessionManager::open { my ($id) = @_; }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.pl": before });
  const to = host.commit("after", { "/pi.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e create_agent_session`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      create_agent_session($options)
    - ├─ AuthStorage.create()
    - ├─ create_coding_tools()
    + ├─ get_services()
    + │  ├─ AuthStorage.create()
    + │  └─ create_coding_tools()
    + ├─ services.boot()
      ├─ if $options->{session_id}
         └─ SessionManager.open($id)
      └─ else
         └─ SessionManager.create()
  `));
});

test("perl: $self->method resolves to Package.method", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      package Runner;

      sub start {
          my ($self) = @_;
          $self->prepare();
      +   $self->validate();
          $self->run();
      }

      sub prepare { }
      + sub validate { }
      sub run { }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.pm": before });
  const to = host.commit("after", { "/runner.pm": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("perl: qualified dispatch and nested packages resolve to dotted keys", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      package My::App::Base;

      sub init { my ($self) = @_; log_init(); }
      sub log_init { }

      package My::App::Child;

      sub create {
          my ($self) = @_;
      -   $self->setup();
      +   $self->My::App::Base::init();
      +   $self->SUPER::finish();
      +   Util::Log::emit();
      }

      - sub setup { my ($self) = @_; }

      package Util::Log;

      + sub emit { }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/app.pm": before });
  const to = host.commit("after", { "/app.pm": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Child.create`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      My.App.Child.create()
    - ├─ My.App.Child.setup()
    + ├─ My.App.Base.init()
    + │  └─ My.App.Base.log_init()
    + ├─ My.App.Child.finish()
    + └─ Util.Log.emit()
  `));
});

test("perl: paren-less, &sigil, and postfix-conditional calls resolve like plain calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      sub main_loop {
      -   setup();
      +   setup;
          run_once;
          &init_hooks();
      +   Log::flush;
          cleanup if $done;
      }

      sub setup { }
      sub run_once { }
      sub init_hooks { }
      + sub Log::flush { }
      sub cleanup { }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/calls.pl": before });
  const to = host.commit("after", { "/calls.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e main_loop`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      main_loop()
      ├─ setup()
      ├─ run_once()
      ├─ init_hooks()
    + ├─ Log.flush()
      └─ if $done
         └─ cleanup()
  `));
});

test("perl: indirect-object new matches Class->new; plain new(...) stays a call", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      sub make {
      -   my $w = new Thing(load_config());
      +   my $w = Thing->new(load_config());
      +   register($w);
          new(helper());
      }

      sub load_config { }
      + sub register { }
      sub helper { }

      package Thing;

      sub new {
          my ($class, $config) = @_;
          my $self = bless {}, $class;
          $self->init();
      +   ready() unless $config->{bare};
          return $self;
      }

      sub init { my ($self) = @_; }
      + sub ready { }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctor.pl": before });
  const to = host.commit("after", { "/ctor.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e make`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      make()
      ├─ new Thing($config)
      │  ├─ Thing.bless()
      │  ├─ Thing.init()
    + │  └─ unless $config->{bare}
    + │     └─ Thing.ready()
      ├─ load_config()
    + ├─ register()
      ├─ new()
      └─ helper()
  `));
});

test("perl: subroutine signatures drive the params label", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      use v5.36;

      sub notify ($user, $message, @tags) {
          format_message($message, @tags);
      +   deliver($user);
      }

      sub format_message ($message, @tags) { }
      + sub deliver ($user) { }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/notify.pl": before });
  const to = host.commit("after", { "/notify.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e notify`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      notify($user, $message, @tags)
      ├─ format_message($message, @tags)
    + └─ deliver($user)
  `));
});

test("perl: shift @_ unpacks conventional params; comments and other arrays do not", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      sub enqueue {
          # take the next job
          my $self = shift;
          my $job = shift @_;
          my $next = shift @queue;
          process($job);
      +   audit($job);
      }

      sub process { my ($job) = @_; }
      + sub audit { my ($job) = @_; }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/queue.pl": before });
  const to = host.commit("after", { "/queue.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e enqueue`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      enqueue($job)
      ├─ process($job)
    + └─ audit($job)
  `));
});

test("perl: package block scopes methods and unless branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      package Cache {
          sub get {
              my ($self, $key) = @_;
              unless ($self->{$key}) {
      -           $self->reload($key);
      +           $self->fetch($key);
              }
              return $self->{$key};
          }

      -   sub reload { my ($self, $key) = @_; }
      +   sub fetch { my ($self, $key) = @_; }
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/cache.pm": before });
  const to = host.commit("after", { "/cache.pm": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Cache.get`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Cache.get($key)
      └─ unless $self->{$key}
    -    ├─ Cache.reload($key)
    +    └─ Cache.fetch($key)
  `));
});

test("perl: 5.38 class methods resolve like package subs", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      use v5.38;
      use experimental 'class';

      class Counter {
          field $count = 0;

          method increment ($by = 1) {
              $self->log_change();
      +       $self->clamp();
          }

          method log_change {
              audit($count);
          }

      +   method clamp { }

          sub audit { my ($value) = @_; }
      }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/counter.pl": before });
  const to = host.commit("after", { "/counter.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Counter.increment`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Counter.increment($by)
      ├─ Counter.log_change()
      │  └─ Counter.audit($value)
    + └─ Counter.clamp()
  `));
});

test("perl: elsif chains stay flat; loop bodies attribute to the caller", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      sub handle {
          my ($status, @jobs) = @_;
          if ($status eq 'a') {
              do_a();
          } elsif ($status eq 'b') {
              do_b();
      +       do_extra();
          } else {
              do_other();
          }
          for my $job (@jobs) {
              run_job($job);
          }
      }

      sub do_a { }
      sub do_b { }
      + sub do_extra { }
      sub do_other { }
      sub run_job { my ($job) = @_; }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/elsif.pl": before });
  const to = host.commit("after", { "/elsif.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      handle($status, @jobs)
      ├─ if $status eq 'a'
         └─ do_a()
      ├─ elsif $status eq 'b'
         ├─ do_b()
    +    └─ do_extra()
      ├─ else
         └─ do_other()
      └─ run_job($job)
  `));
});

test("perl: try/catch/finally and eval as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      use v5.40;

      sub boot {
          try {
              open_();
          } catch ($e) {
              recover($e);
          } finally {
              close_();
          }
      -   risky();
      +   eval { risky(); };
      +   flush();
      }

      sub open_ { }
      sub recover { my ($e) = @_; }
      sub close_ { }
      sub risky { }
      + sub flush { }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.pl": before });
  const to = host.commit("after", { "/ctrl.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      boot()
      ├─ try
         └─ open_()
      ├─ catch
         └─ recover($e)
      ├─ finally
         └─ close_()
    - ├─ risky()
    + ├─ eval
    +    └─ risky()
    + └─ flush()
  `));
});

test("perl: expression-position Try::Tiny stays calls; blocks are callbacks", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      use Try::Tiny;

      sub load_config {
          my $config = try { read_file(); } catch { defaults(); };
      +   validate($config);
          return $config;
      }

      sub read_file { }
      sub defaults { }
      + sub validate { my ($config) = @_; }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/config.pl": before });
  const to = host.commit("after", { "/config.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e load_config`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      load_config()
      ├─ try()
      ├─ catch()
    + └─ validate($config)
  `));
});

test("perl: anonymous subs and block arguments are callbacks; a lone finally stays a call", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      sub outer {
          my $handler = sub { hidden(); };
          with_retries { hidden(); } 3;
          my @ready = map { hidden($_) } visible_list();
          finally { hidden(); };
          visible($handler);
      +   also_visible();
      }

      sub hidden { }
      sub with_retries { }
      sub visible_list { }
      sub finally { my ($cb) = @_; }
      sub visible { my ($handler) = @_; }
      + sub also_visible { }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.pl": before });
  const to = host.commit("after", { "/nested.pl": after });

  const result = host.run(`calldiff diff ${from} ${to} -e outer`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      outer()
      ├─ with_retries()
      ├─ visible_list()
      ├─ finally($cb)
      ├─ visible($handler)
    + └─ also_visible()
  `));
});
