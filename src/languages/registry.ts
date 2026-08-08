import { extname } from "node:path";
import type { LanguageExtractor } from "./types.js";
import { goExtractor } from "./go.js";
import { pythonExtractor } from "./python.js";
import {
  typescriptExtractor,
  tsxExtractor,
} from "./typescript.js";

const extractors: LanguageExtractor[] = [
  typescriptExtractor,
  tsxExtractor,
  pythonExtractor,
  goExtractor,
];

const byExtension = new Map<string, LanguageExtractor>();
for (const extractor of extractors) {
  for (const ext of extractor.extensions) {
    byExtension.set(ext.toLowerCase(), extractor);
  }
}

export function listSupportedExtensions(): string[] {
  return [...byExtension.keys()].sort();
}

export function detectLanguage(file: string): LanguageExtractor | null {
  const ext = extname(file).toLowerCase();
  return byExtension.get(ext) ?? null;
}

export function getExtractor(id: string): LanguageExtractor | null {
  return extractors.find((e) => e.id === id) ?? null;
}

export { extractors };
