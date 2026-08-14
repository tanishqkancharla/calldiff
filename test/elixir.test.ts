import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("elixir: refactors calls into a helper with if/else", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      defmodule PiService do
        def create_agent_session(options) do
    -     AuthStorage.create()
    -     create_coding_tools()
    +     services = get_services()
    +     services.boot()
          if options[:session_id] == nil do
            SessionManager.create()
          else
            SessionManager.open(1)
          end
        end

    +   def get_services do
    +     AuthStorage.create()
    +     create_coding_tools()
    +   end

        def create_coding_tools, do: :ok
      end

      defmodule AuthStorage do
        def create, do: :ok
      end

      defmodule SessionManager do
        def create, do: :ok
        def open(_id), do: :ok
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/pi.ex": before });
  const to = host.commit("after", { "/pi.ex": after });

  const result = host.run(`calldiff diff ${from} ${to} -e PiService.create_agent_session`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      PiService.create_agent_session(options)
    - ├─ AuthStorage.create()
    - ├─ PiService.create_coding_tools()
    + ├─ PiService.get_services()
    + │  ├─ AuthStorage.create()
    + │  └─ PiService.create_coding_tools()
    + ├─ services.boot()
      ├─ if options[:session_id] == nil
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(_id)
  `));
});

test("elixir: module-local calls resolve to Module.fun", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      defmodule Runner do
        def start do
          prepare()
    +     validate()
          run()
        end

        def prepare, do: :ok
    +   def validate, do: :ok
        def run, do: :ok
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/runner.ex": before });
  const to = host.commit("after", { "/runner.ex": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Runner.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `));
});

test("elixir: Module.fun remote calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      defmodule Boot do
        def start do
          AuthStorage.create()
    +     SessionManager.open(1)
          Tools.build()
        end
      end

      defmodule AuthStorage do
        def create, do: :ok
      end

      defmodule SessionManager do
        def open(_id), do: :ok
      end

      defmodule Tools do
        def build, do: :ok
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/remote.ex": before });
  const to = host.commit("after", { "/remote.ex": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Boot.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Boot.start()
      ├─ AuthStorage.create()
    + ├─ SessionManager.open(_id)
      └─ Tools.build()
  `));
});

test("elixir: skips nested fn and inner def bodies", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      defmodule Outer do
        def run do
          visible()
          fn -> hidden() end
    +     also_visible()
        end

        def visible, do: :ok
        def hidden, do: :ok
    +   def also_visible, do: :ok
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/nested.ex": before });
  const to = host.commit("after", { "/nested.ex": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Outer.run`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Outer.run()
      ├─ Outer.visible()
    + └─ Outer.also_visible()
  `));
});

test("elixir: case and try/rescue/after as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      defmodule M do
        def boot(x) do
          case x do
            1 -> do_a()
            _ -> do_other()
          end
          try do
            open_()
          rescue
            e in RuntimeError -> recover()
          after
            close()
          end
    +     flush()
        end
        def do_a, do: :ok
        def do_other, do: :ok
        def open_, do: :ok
        def recover, do: :ok
        def close, do: :ok
    +   def flush, do: :ok
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/ctrl.ex": before });
  const to = host.commit("after", { "/ctrl.ex": after });

  const result = host.run(`calldiff diff ${from} ${to} -e M.boot`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      M.boot(x)
      ├─ case 1
         └─ M.do_a()
      ├─ case _
         └─ M.do_other()
      ├─ try
         └─ M.open_()
      ├─ rescue e in RuntimeError
         └─ M.recover()
      ├─ after
         └─ M.close()
    + └─ M.flush()
  `));
});

test("elixir: cond clauses as branches", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      defmodule M do
        def handle(x) do
          cond do
            x == 1 -> do_a()
            true -> do_other()
          end
    +     flush()
        end
        def do_a, do: :ok
        def do_other, do: :ok
    +   def flush, do: :ok
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/cond.ex": before });
  const to = host.commit("after", { "/cond.ex": after });

  const result = host.run(`calldiff diff ${from} ${to} -e M.handle`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      M.handle(x)
      ├─ cond x == 1
         └─ M.do_a()
      ├─ cond true
         └─ M.do_other()
    + └─ M.flush()
  `));
});

test("elixir: defp helpers still resolve as Module.fun", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      defmodule Svc do
        def start do
          prepare()
    +     finish()
        end

        defp prepare, do: :ok
    +   defp finish, do: :ok
      end
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/priv.ex": before });
  const to = host.commit("after", { "/priv.ex": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Svc.start`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Svc.start()
      ├─ Svc.prepare()
    + └─ Svc.finish()
  `));
});
