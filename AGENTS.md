# calldiff

`calldiff` is a CLI for agentic code review: it diffs call stacks across git commits for 22 languages (AST-based, powered by tree-sitter). See `README.md` for usage and `## Dev` for the dev command.

## Cursor Cloud specific instructions

- This is a single Node.js CLI package (npm, `package-lock.json`). Node `>=20` is required; the VM's default Node satisfies this.
- Standard commands live in `package.json` `scripts`:
  - Typecheck/build: `npm run build` (runs `tsc`, emits `dist/`). There is no separate lint tool — `tsc` under `strict` is the closest thing to a lint check.
  - Tests: `npm test` (`vitest run`).
  - Run in dev: `npm run dev -- <args>` (runs `src/cli.ts` via `tsx`); run built binary: `node dist/cli.js <args>`.
- The tool operates on a git repository, so run it from inside one. A convenient smoke test is to diff this repo's own two commits, e.g. `npm run dev -- f007467 99a6c6d`, which prints an ASCII callstack diff.
