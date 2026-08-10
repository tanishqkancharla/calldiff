# Language extractor contract (for implementers)

## Interface (`src/languages/types.ts`)
Export a `LanguageExtractor`:
- `id`: string
- `extensions`: string[] (with dot, e.g. `.rs`)
- `grammarPackage`: npm name (e.g. `tree-sitter-rust`)
- `grammarExport?`: named export if needed
- `extract(file, source, tree): FunctionInfo[]`

Helpers: `namedChildren`, `childByType`, `collapseWs` from `./types.js`.

## FunctionInfo / CallStep (`src/types.ts`)
- `key`: stable id (`foo`, `Type.method`, `new Type`)
- `label`: display with params (`foo(x)`, `Type.method()`)
- `steps`: ordered `call` | `branch` (`if`/`else`/`elif`/language equivalent)
- Call and branch steps should include call-site / keyword locs via `locFromNode(file, node)` → `file`, `line`, optional `endLine` (1-based)
- `exported`: used for entry inference

## Must support
1. Free functions + type/class methods
2. Calls: bare + member/receiver (`self`/`this`/recv → `Type.method`)
3. Constructors / `new` analogue when the language has one
4. if/else (and elif if present) as branches with source-text labels
5. Nested function/lambda bodies NOT attributed to outer caller
6. Ignore computed/dynamic callees when obvious

## Do NOT edit
- `src/languages/registry.ts` (parent merges)
- `src/extract.ts`, `src/git.ts` (parent updates)

## Tests
Create `test/<id>.test.ts` using:
```ts
import { test } from "./expectCallstack.js";
test("...", ({ expectCallstack }) => {
  expectCallstack(`...+/- fixture...`, "Entry.symbol", { file: "x.<ext>" }).toEqual(`...`);
});
```
At least 2 tests: (1) helper refactor + if/else (2) method/receiver resolution.

## Verify
```bash
CALLDIFF_GRAMMAR_CACHE=/tmp/calldiff-grammar-cache npx tsx -e "
import { extractFunctions } from './src/extract.ts';
// temporarily won't be registered — test extract() directly from your module
"
```
For unit-checking before registry merge, import your extractor and parse with grammars.ts.

Grammar load pattern:
```ts
import Parser from "tree-sitter";
import { loadGrammarPackage, resolveLanguage } from "./grammars.js";
import { yourExtractor } from "./your.js";
const p = new Parser();
p.setLanguage(resolveLanguage(loadGrammarPackage("tree-sitter-X"), exportName) as any);
const tree = p.parse(source);
console.log(yourExtractor.extract("f.ext", source, tree));
```

Probe CST with dump walks before writing the visitor.
