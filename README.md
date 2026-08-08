# calldiff

Diff TypeScript call stacks across git commits — like `git diff`, but for who-calls-whom.

```
  PiService.createAgentSession(options)
- ├─ AuthStorage.create()
- ├─ new ModelRegistry
- ├─ createCodingTools()
+ ├─ PiService.getServices()
+ │  ├─ SettingsManager.create()
+ │  ├─ AuthStorage.create()
+ │  └─ new ModelRegistry
```

## Install

```bash
npx calldiff
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
- `if (cond)` / `else` / `else if (cond)` — conditional arms (no continuing `│` rail)

If you omit `--entry`, calldiff infers exported functions whose expanded call trees changed (and may show several).

## How it works

1. Reads source from both git trees (`git show` / working tree)
2. Detects language by file extension, loads a [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar (bundled or on-demand into `~/.cache/calldiff/grammars`), and parses
3. Builds per-function callee lists and expands them into call trees
4. Diffs the trees and prints an ASCII callstack diff

### Supported languages

TypeScript/TSX, JavaScript, Python, Go, Rust, Java, Ruby, C, C++, C#, PHP, Kotlin, Swift, Scala, Lua, Elixir, Bash, Haskell, Zig, Solidity, OCaml.

Grammars install on first use (override cache with `CALLDIFF_GRAMMAR_CACHE`). This is syntactic (AST-based), not a full typechecker — dynamic calls won’t resolve.

## Dev

```bash
npm run dev -- main HEAD --entry PiService.createAgentSession
```
