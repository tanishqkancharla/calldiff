# calldiff

Diff call stacks across git commits — like `git diff`, but for who-calls-whom.

Built for **agentic code review**: when an agent (or you) rewires call flow, plain line diffs bury the shape of the change. `calldiff` shows which callees appeared, disappeared, or moved under an entrypoint — across **22 languages**.

```diff
  PiService.createAgentSession(options)
- ├─ AuthStorage.create()
- ├─ new ModelRegistry
- ├─ createCodingTools()
+ ├─ PiService.getServices()
+ │  ├─ SettingsManager.create()
+ │  ├─ AuthStorage.create()
+ │  └─ new ModelRegistry
```

## Prompt for agents

Paste this when you want a walkthrough of call-flow changes:

> dearest clod, walk me through the code changes you made using `npx calldiff@latest`

## Install

```bash
npx calldiff@latest
# or
npm install -g calldiff
```

## Usage

```bash
# HEAD vs working tree (default)
calldiff

# one ref vs working tree
calldiff main

# two commits / branches
calldiff abc123 def456
calldiff --from main --to feature

# force entrypoints (functionName or ClassName.method)
calldiff main feature --entry createAgentSession
calldiff main feature -e PiService.createAgentSession -e boot

# limit to paths (trailing positionals; leading -- also accepted)
calldiff main feature src/lib

# view a call tree (no diff) — requires --entry
calldiff show -e createAgentSession
calldiff show HEAD -e PiService.createAgentSession
calldiff show main -e boot --max-depth 8 src/lib

# agent / machine-readable output (via incur)
calldiff --format json
calldiff --llms
calldiff skills add   # install agent skill files
calldiff mcp add      # register as MCP server
```

### Semantics (git-diff shaped)

| Invocation | From | To |
|---|---|---|
| `calldiff` | `HEAD` | working tree |
| `calldiff <from>` | `<from>` | working tree |
| `calldiff <from> <to>` | `<from>` | `<to>` |

`-` lines were present in **from** and gone in **to**.  
`+` lines are new in **to**.

### View (no diff)

| Invocation | Tree from |
|---|---|
| `calldiff show -e <name>` | working tree |
| `calldiff show <ref> -e <name>` | that commit/ref |

Prints a plain ASCII call tree (no `+/−` markers). `--entry` / `-e` is required.

### Labels

- `functionName` — free function
- `ClassName.method` — class method
- `new ClassName` — constructor / `new` call
- `Component` — JSX/TSX component tags (`<Button />`); children nest under the parent
- `if (cond)` / `else` / `else if (cond)` — conditional arms (no continuing `│` rail)

If you omit `--entry`, calldiff infers exported functions whose expanded call trees changed (and may show several).

### Supported languages

TypeScript, TSX, JavaScript, JSX, Python, Go, Rust, Java, Ruby, C, C++, C#, PHP, Kotlin, Swift, Scala, Lua, Elixir, Bash, Haskell, Zig, Solidity, OCaml.

## Output

- **Default:** colored ASCII callstack trees (TTY) / colorless ASCII when piped — same shape as before.
- **`--format json|yaml|md|jsonl`:** structured result (`from`/`to`/`trees` with nested nodes + per-entry `ascii`) for agents and scripts.
- Built on [incur](https://github.com/wevm/incur): `skills add`, `mcp add`, `--llms`, CTAs after diffs, typed flags.

## How it works

1. Reads source from both git trees (`git show` / working tree)
2. Detects language by file extension, loads a [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar (bundled or on-demand into `~/.cache/calldiff/grammars`), and parses
3. Builds per-function callee lists and expands them into call trees
4. Diffs the trees and prints an ASCII callstack diff (or structured output for agents)

Grammars install on first use (override cache with `CALLDIFF_GRAMMAR_CACHE`). This is syntactic (AST-based), not a full typechecker — dynamic calls won’t resolve.

## Dev

```bash
npm run dev -- main HEAD --entry PiService.createAgentSession
```
