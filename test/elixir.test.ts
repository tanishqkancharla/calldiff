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
