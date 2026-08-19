# calldiff

`calldiff` is a CLI for agentic code review: it diffs call stacks across git commits for 23 languages (AST-based, powered by tree-sitter). See `README.md` for usage and `## Dev` for the dev command.

## Cursor Cloud specific instructions

- This is a single Node.js CLI package (npm, `package-lock.json`). Node `>=22` is required (incur); the VM's default Node satisfies this.
- Standard commands live in `package.json` `scripts`:
  - Typecheck/build: `npm run build` (runs `tsc`, emits `dist/`).
  - Lint: `npm run lint` (`oxlint` with vendored anti-slop rules in `tools/oxlint/anti-slop/`). Requires Node `>=22.18.0` so Oxlint can load the TypeScript plugin.
  - Tests: `npm test` (`vitest run`).
  - Run in dev: `npm run dev -- <args>` (runs `src/cli.ts` via `tsx`); run built binary: `node dist/cli.js <args>`.
  - The tool operates on a git repository, so run it from inside one. A convenient smoke test is to diff this repo's own two commits, e.g. `npm run dev -- diff f007467 99a6c6d`, which prints an ASCII callstack diff. Subcommands: `diff`, `tree`, `reach`.

## Tests

UX-facing changes always get end-to-end tests. If the change affects what `tree`, `reach`, or `diff` print, or a flag/option agents and humans pass, cover it by driving the CLI — not by unit-testing `extractFunctions` / `buildCallTree` / `findReachPaths` as a stand-in.

Use the `workspace()` fixture in `test/workspace.ts` for those tests. It creates an isolated git repo; `host.run("calldiff ...")` returns `{ stdout, stderr, code }`. Assert the ASCII (or `--format json`) the user would see. Language extractors already follow this in `test/<id>.test.ts`; CLI behavior lives in files like `test/reach.test.ts` and `test/callback-nesting.test.ts`. The fixture's docstring has a copy-paste example.
