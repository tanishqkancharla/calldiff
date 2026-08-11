/**
 * Multi-language extraction: detect by file extension, load grammar
 * (bundled or on-demand cache), parse, then run the language extractor.
 */
import { createHash } from "node:crypto";
import Parser from "tree-sitter";
import type { CallStep, FunctionInfo } from "./types.js";
import { loadGrammarPackage, resolveLanguage } from "./languages/grammars.js";
import { detectLanguage } from "./languages/registry.js";
import { linesFromOffsets } from "./loc.js";

const parser = new Parser();
const languageCache = new Map<string, unknown>();

function grammarKey(npmPackage: string, grammarExport?: string): string {
  return grammarExport ? `${npmPackage}:${grammarExport}` : npmPackage;
}

function loadLanguage(npmPackage: string, grammarExport?: string): unknown {
  const key = grammarKey(npmPackage, grammarExport);
  const cached = languageCache.get(key);
  if (cached) return cached;

  const mod = loadGrammarPackage(npmPackage);
  const language = resolveLanguage(mod, grammarExport);
  languageCache.set(key, language);
  return language;
}

export function extractFunctions(
  file: string,
  source: string,
): FunctionInfo[] {
  const extractor = detectLanguage(file);
  if (!extractor) return [];

  const language = loadLanguage(
    extractor.grammarPackage,
    extractor.grammarExport,
  );
  parser.setLanguage(language as any);
  const tree = parser.parse(source);
  return extractor.extract(file, source, tree).map((fn) => {
    if (fn.line != null) return fn;
    const lines = linesFromOffsets(source, fn.start, fn.end);
    return { ...fn, ...lines };
  });
}

type CachedFunction = Omit<FunctionInfo, "file">;
export type ExtractionCache = Map<string, CachedFunction[]>;

export function extractCached(
  file: string,
  source: string,
  cache: ExtractionCache,
): FunctionInfo[] {
  const extractor = detectLanguage(file);
  if (!extractor) return [];

  const digest = createHash("sha256").update(source).digest("hex");
  const key = `${file}\0${extractor.id}\0${digest}`;
  let functions = cache.get(key);

  if (!functions) {
    functions = extractFunctions(file, source).map(
      ({ file: ignored, ...fn }) => fn,
    );
    cache.set(key, functions);
  }
  return functions.map((fn) => ({ ...fn, file }));
}

export type FunctionIndex = Map<string, FunctionInfo>;

/**
 * Full extraction list for an index, including definitions shadowed by
 * first-wins bare-key insertion in {@link buildIndex}.
 */
const indexDefinitions = new WeakMap<FunctionIndex, FunctionInfo[]>();

export function flattenCallKeys(steps: CallStep[]): string[] {
  const keys: string[] = [];
  const walk = (list: CallStep[]) => {
    for (const step of list) {
      if (step.type === "call") {
        keys.push(step.key);
        if (step.children) walk(step.children);
      } else {
        walk(step.children);
      }
    }
  };
  walk(steps);
  return keys;
}

/**
 * Every function recorded when the index was built (including duplicates that
 * lost the bare-key race). Indexes created as plain Maps fall back to values().
 */
export function allFunctions(index: FunctionIndex): FunctionInfo[] {
  return indexDefinitions.get(index) ?? [...index.values()];
}

export function buildIndex(functions: FunctionInfo[]): FunctionIndex {
  const index: FunctionIndex = new Map();
  for (const fn of functions) {
    if (!index.has(fn.key)) {
      index.set(fn.key, fn);
    }
    if (fn.key.endsWith(".constructor")) {
      const className = fn.key.slice(0, -".constructor".length);
      const newKey = `new ${className}`;
      if (!index.has(newKey)) {
        index.set(newKey, { ...fn, key: newKey, label: `new ${className}()` });
      }
    }
  }
  indexDefinitions.set(index, functions.slice());
  return index;
}
