import type Parser from "tree-sitter";
import type { FunctionInfo } from "../types.js";

export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;

export interface LanguageExtractor {
  /** Stable id, e.g. "typescript" | "python" | "go" */
  id: string;
  /** File extensions including dot, lowercase */
  extensions: string[];
  /** npm package providing the tree-sitter grammar */
  grammarPackage: string;
  /** Named export on the grammar package, if any (e.g. "typescript", "tsx") */
  grammarExport?: string;
  extract(file: string, source: string, tree: Tree): FunctionInfo[];
}

export function namedChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) out.push(child);
  }
  return out;
}

export function childByType(node: SyntaxNode, type: string): SyntaxNode | null {
  return namedChildren(node).find((c) => c.type === type) ?? null;
}

export function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
