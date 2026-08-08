import { test } from "./expectCallstack.js";

test("elixir: refactors calls into a helper with if/else", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "PiService.create_agent_session",
    { file: "pi.ex" },
  ).toEqual(`
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
  `);
});

test("elixir: module-local calls resolve to Module.fun", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Runner.start",
    { file: "runner.ex" },
  ).toEqual(`
      Runner.start()
      ├─ Runner.prepare()
    + ├─ Runner.validate()
      └─ Runner.run()
  `);
});

test("elixir: Module.fun remote calls", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Boot.start",
    { file: "remote.ex" },
  ).toEqual(`
      Boot.start()
      ├─ AuthStorage.create()
    + ├─ SessionManager.open(_id)
      └─ Tools.build()
  `);
});

test("elixir: skips nested fn and inner def bodies", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "Outer.run",
    { file: "nested.ex" },
  ).toEqual(`
      Outer.run()
      ├─ Outer.visible()
    + └─ Outer.also_visible()
  `);
});

test("elixir: case and try/rescue/after as branches", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "M.boot",
    { file: "ctrl.ex" },
  ).toEqual(`
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
  `);
});

test("elixir: cond clauses as branches", ({ expectCallstack }) => {
  expectCallstack(
    `
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
    `,
    "M.handle",
    { file: "cond.ex" },
  ).toEqual(`
      M.handle(x)
      ├─ cond x == 1
         └─ M.do_a()
      ├─ cond true
         └─ M.do_other()
    + └─ M.flush()
  `);
});

test("elixir: defp helpers still resolve as Module.fun", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      defmodule Svc do
        def start do
          prepare()
    +     finish()
        end

        defp prepare, do: :ok
    +   defp finish, do: :ok
      end
    `,
    "Svc.start",
    { file: "priv.ex" },
  ).toEqual(`
      Svc.start()
      ├─ Svc.prepare()
    + └─ Svc.finish()
  `);
});
