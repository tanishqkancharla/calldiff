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

# limit to paths
calldiff main feature -- src/lib
```

### Semantics (git-diff shaped)

| Invocation | From | To |
|---|---|---|
| `calldiff` | `HEAD` | working tree |
| `calldiff <from>` | `<from>` | working tree |
| `calldiff <from> <to>` | `<from>` | `<to>` |

`-` lines were present in **from** and gone in **to**.  
`+` lines are new in **to**.

### Labels

- `functionName` — free function
- `ClassName.method` — class method
- `new ClassName` — constructor / `new` call
- `Component` — JSX/TSX component tags (`<Button />`); children nest under the parent
- `if (cond)` / `else` / `else if (cond)` — conditional arms (no continuing `│` rail)

If you omit `--entry`, calldiff infers exported functions whose expanded call trees changed (and may show several).

### Supported languages

TypeScript, TSX, JavaScript, JSX, Python, Go, Rust, Java, Ruby, C, C++, C#, PHP, Kotlin, Swift, Scala, Lua, Elixir, Bash, Haskell, Zig, Solidity, OCaml.

## How it works

1. Reads source from both git trees (`git show` / working tree)
2. Detects language by file extension, loads a [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar (bundled or on-demand into `~/.cache/calldiff/grammars`), and parses
3. Builds per-function callee lists and expands them into call trees
4. Diffs the trees and prints an ASCII callstack diff

Grammars install on first use (override cache with `CALLDIFF_GRAMMAR_CACHE`). This is syntactic (AST-based), not a full typechecker — dynamic calls won’t resolve.

## Dev

```bash
npm run dev -- main HEAD --entry PiService.createAgentSession
```
