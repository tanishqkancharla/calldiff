import type Parser from "tree-sitter";
import type { FunctionInfo, SourceLoc } from "../types.js";

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

/**
 * Call-site / branch span for a syntax node.
 * Uses tree-sitter 0-based rows → 1-based display lines.
 */
export function locFromNode(file: string, node: SyntaxNode): SourceLoc {
  const line = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  return endLine > line ? { file, line, endLine } : { file, line };
}
