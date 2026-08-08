/**
 * Multi-language extraction: detect by file extension, load grammar
 * (bundled or on-demand cache), parse, then run the language extractor.
 */
import Parser from "tree-sitter";
import type { CallStep, FunctionInfo } from "./types.js";
import { loadGrammarPackage, resolveLanguage } from "./languages/grammars.js";
import { detectLanguage } from "./languages/registry.js";

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
  return extractor.extract(file, source, tree);
}

export type FunctionIndex = Map<string, FunctionInfo>;

export function flattenCallKeys(steps: CallStep[]): string[] {
  const keys: string[] = [];
  const walk = (list: CallStep[]) => {
    for (const step of list) {
      if (step.type === "call") keys.push(step.key);
      else walk(step.children);
    }
  };
  walk(steps);
  return keys;
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
  return index;
}
