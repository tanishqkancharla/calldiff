import { extname } from "node:path";
import type { LanguageExtractor } from "./types.js";
import { bashExtractor } from "./bash.js";
import { cExtractor } from "./c.js";
import { cppExtractor } from "./cpp.js";
import { csharpExtractor } from "./csharp.js";
import { elixirExtractor } from "./elixir.js";
import { goExtractor } from "./go.js";
import { haskellExtractor } from "./haskell.js";
import { javaExtractor } from "./java.js";
import { javascriptExtractor, javascriptreactExtractor } from "./javascript.js";
import { kotlinExtractor } from "./kotlin.js";
import { luaExtractor } from "./lua.js";
import { ocamlExtractor } from "./ocaml.js";
import { perlExtractor } from "./perl.js";
import { phpExtractor } from "./php.js";
import { pythonExtractor } from "./python.js";
import { rubyExtractor } from "./ruby.js";
import { rustExtractor } from "./rust.js";
import { scalaExtractor } from "./scala.js";
import { solidityExtractor } from "./solidity.js";
import { swiftExtractor } from "./swift.js";
import {
  typescriptExtractor,
  typescriptreactExtractor,
} from "./typescript.js";
import { zigExtractor } from "./zig.js";

const extractors: LanguageExtractor[] = [
  typescriptExtractor,
  typescriptreactExtractor,
  javascriptExtractor,
  javascriptreactExtractor,
  pythonExtractor,
  goExtractor,
  rustExtractor,
  javaExtractor,
  rubyExtractor,
  cExtractor,
  cppExtractor,
  csharpExtractor,
  phpExtractor,
  kotlinExtractor,
  swiftExtractor,
  scalaExtractor,
  luaExtractor,
  elixirExtractor,
  bashExtractor,
  haskellExtractor,
  zigExtractor,
  solidityExtractor,
  ocamlExtractor,
  perlExtractor,
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

export function listSupportedLanguages(): string[] {
  return extractors.map((e) => e.id);
}

export function detectLanguage(file: string): LanguageExtractor | null {
  const ext = extname(file).toLowerCase();
  return byExtension.get(ext) ?? null;
}

export function getExtractor(id: string): LanguageExtractor | null {
  return extractors.find((e) => e.id === id) ?? null;
}

export { extractors };
