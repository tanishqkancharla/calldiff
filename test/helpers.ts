import Parser from "tree-sitter";
import { buildCallTree } from "../src/calltree.js";
import { diffTrees } from "../src/diff.js";
import { buildIndex, extractFunctions } from "../src/extract.js";
import { loadGrammarPackage, resolveLanguage } from "../src/languages/grammars.js";
import { bashExtractor } from "../src/languages/bash.js";
import { cExtractor } from "../src/languages/c.js";
import { cppExtractor } from "../src/languages/cpp.js";
import { csharpExtractor } from "../src/languages/csharp.js";
import { elixirExtractor } from "../src/languages/elixir.js";
import { haskellExtractor } from "../src/languages/haskell.js";
import { javascriptExtractor } from "../src/languages/javascript.js";
import { javaExtractor } from "../src/languages/java.js";
import { ocamlExtractor } from "../src/languages/ocaml.js";
import { phpExtractor } from "../src/languages/php.js";
import { rubyExtractor } from "../src/languages/ruby.js";
import { rustExtractor } from "../src/languages/rust.js";
import { solidityExtractor } from "../src/languages/solidity.js";
import { zigExtractor } from "../src/languages/zig.js";
import { detectLanguage } from "../src/languages/registry.js";
import type { LanguageExtractor } from "../src/languages/types.js";
import type { FunctionInfo } from "../src/types.js";
import { renderDiff } from "../src/render.js";

/**
 * Extra extractors not yet merged into registry.ts (parent merges).
 * Lets language fixture tests run before registry wiring.
 */
const pendingExtractors: LanguageExtractor[] = [
  javascriptExtractor,
  rustExtractor,
  javaExtractor,
  rubyExtractor,
  cExtractor,
  cppExtractor,
  csharpExtractor,
  phpExtractor,
  elixirExtractor,
  bashExtractor,
  haskellExtractor,
  zigExtractor,
  solidityExtractor,
  ocamlExtractor,
];

const pendingByExt = new Map<string, LanguageExtractor>();
for (const ext of pendingExtractors) {
  for (const e of ext.extensions) pendingByExt.set(e.toLowerCase(), ext);
}

const pendingParser = new Parser();

function extractWithPending(file: string, source: string): FunctionInfo[] {
  const registered = extractFunctions(file, source);
  if (registered.length > 0 || detectLanguage(file)) return registered;

  const match = file.match(/(\.[^.]+)$/);
  const ext = (match?.[1] ?? "").toLowerCase();
  const extractor = pendingByExt.get(ext);
  if (!extractor) return [];

  const language = resolveLanguage(
    loadGrammarPackage(extractor.grammarPackage),
    extractor.grammarExport,
  );
  pendingParser.setLanguage(language as any);
  return extractor.extract(file, source, pendingParser.parse(source));
}

export type CallstackDiffOptions = {
  maxDepth?: number;
  /** Filename used for language detection (e.g. `file.tsx`). */
  file?: string;
};

/**
 * Reconstruct before/after file contents from a unified-style diff.
 *
 * Accepts a full-file diff where every source line is prefixed with
 * ` ` (unchanged), `-` (removed), or `+` (added). Also skips unified
 * headers (`---`, `+++`, `@@`).
 */
export function sourcesFromFileDiff(fileDiff: string): {
  before: string;
  after: string;
} {
  const before: string[] = [];
  const after: string[] = [];

  for (const raw of fileDiff.split("\n")) {
    if (
      raw.startsWith("---") ||
      raw.startsWith("+++") ||
      raw.startsWith("@@") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ")
    ) {
      continue;
    }

    // "\ No newline at end of file"
    if (raw.startsWith("\\")) continue;

    const marker = raw[0];
    const content = raw.length > 0 ? raw.slice(1) : "";

    if (marker === "-") {
      before.push(content);
    } else if (marker === "+") {
      after.push(content);
    } else if (marker === " " || raw === "") {
      // Context line (leading space) or blank line treated as context
      const line = marker === " " ? content : raw;
      before.push(line);
      after.push(line);
    } else {
      // No prefix — treat the whole line as unchanged context
      before.push(raw);
      after.push(raw);
    }
  }

  return {
    before: before.join("\n"),
    after: after.join("\n"),
  };
}

function snapshotNames(file: string): { before: string; after: string } {
  const match = file.match(/(\.[^.]+)$/);
  const ext = match?.[1] ?? ".ts";
  const base = match ? file.slice(0, -ext.length) : file;
  const stem = base || "file";
  return { before: `${stem}.before${ext}`, after: `${stem}.after${ext}` };
}

/**
 * Diff callstacks for an entrypoint given a TypeScript file diff.
 * Returns colorless ASCII output suitable for assertions.
 */
export function callstackDiff(
  fileDiff: string,
  entry: string,
  options: CallstackDiffOptions = {},
): string {
  const maxDepth = options.maxDepth ?? 12;
  const { before: beforeName, after: afterName } = snapshotNames(
    options.file ?? "file.ts",
  );
  const { before: beforeSource, after: afterSource } =
    sourcesFromFileDiff(fileDiff);

  const before = buildIndex(extractWithPending(beforeName, beforeSource));
  const after = buildIndex(extractWithPending(afterName, afterSource));

  const beforeTree = buildCallTree(entry, before, maxDepth);
  const afterTree = buildCallTree(entry, after, maxDepth);
  const diff = diffTrees(beforeTree, afterTree);
  return renderDiff(diff, { color: false });
}
