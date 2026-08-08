/**
 * Haskell callable extraction (tree-sitter-haskell).
 */
import type { CallStep, FunctionInfo } from "../types.js";
import {
  childByType,
  collapseWs,
  namedChildren,
  type LanguageExtractor,
  type SyntaxNode,
  type Tree,
} from "./types.js";

function isLikelyTypeName(name: string): boolean {
  const c = name[0];
  return c !== undefined && c === c.toUpperCase() && c !== c.toLowerCase();
}

function patternNames(patterns: SyntaxNode | null): string[] {
  if (!patterns) return [];
  const names: string[] = [];
  for (const p of namedChildren(patterns)) {
    if (p.type === "variable") names.push(p.text);
    else if (p.type === "wildcard") names.push("_");
    else names.push("_");
  }
  return names;
}

function getParamsLabel(patterns: SyntaxNode | null): string {
  const names = patternNames(patterns);
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeFromExp(node: SyntaxNode): string | null {
  if (node.type === "variable") {
    if (node.text === "return" || node.text === "pure") return null;
    return node.text;
  }
  if (node.type === "apply") {
    // f x y → callee is leftmost function
    const head = node.namedChild(0);
    if (!head) return null;
    return calleeFromExp(head);
  }
  if (node.type === "parens") {
    const inner = node.namedChild(0);
    return inner ? calleeFromExp(inner) : null;
  }
  if (node.type === "qualified") {
    // M.f
    const kids = namedChildren(node);
    const mod = kids.find((c) => c.type === "module" || c.type === "module_id");
    const vari = kids.find((c) => c.type === "variable");
    if (vari && mod) {
      const modName =
        mod.type === "module"
          ? (childByType(mod, "module_id")?.text ?? mod.text.replace(/\.$/, ""))
          : mod.text.replace(/\.$/, "");
      return `${modName}.${vari.text}`;
    }
    if (vari) return vari.text;
  }
  // constructors / operators / literals — ignore as callees when not useful
  if (node.type === "constructor" || node.type === "operator") return null;
  if (node.type === "literal" || node.type === "unit") return null;
  return null;
}

function collectFromMatch(match: SyntaxNode | null): CallStep[] {
  if (!match) return [];
  const body = match.namedChild(0) ?? namedChildren(match)[0] ?? null;
  if (!body) return [];
  return collectExpr(body);
}

function collectExpr(node: SyntaxNode): CallStep[] {
  const steps: CallStep[] = [];
  const seen = new Set<string>();

  const addCall = (key: string, start: number) => {
    const mark = `${key}:${start}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    steps.push({ type: "call", key });
  };

  const walk = (n: SyntaxNode): void => {
    // Nested binds / lambdas / local functions
    if (
      n.type === "function" ||
      n.type === "bind" ||
      n.type === "lambda" ||
      n.type === "local_binds" ||
      n.type === "declarations"
    ) {
      return;
    }

    if (n.type === "conditional") {
      const kids = namedChildren(n);
      const cond = kids[0] ?? null;
      const thenE = kids[1] ?? null;
      const elseE = kids[2] ?? null;
      const condText = cond ? collapseWs(cond.text) : "";
      steps.push({
        type: "branch",
        key: condText ? `if:${condText}` : "if",
        label: condText ? `if ${condText}` : "if",
        children: thenE ? collectExpr(thenE) : [],
      });
      if (elseE) {
        steps.push({
          type: "branch",
          key: "else",
          label: "else",
          children: collectExpr(elseE),
        });
      }
      return;
    }

    if (n.type === "case") {
      const alts = childByType(n, "alternatives");
      for (const alt of alts ? namedChildren(alts) : []) {
        if (alt.type !== "alternative") continue;
        const pattern =
          namedChildren(alt).find((c) => c.type !== "match") ?? null;
        const text = pattern ? collapseWs(pattern.text) : "";
        const match = childByType(alt, "match");
        steps.push({
          type: "branch",
          key: text ? `case:${text}` : "case",
          label: text ? `case ${text}` : "case",
          children: collectFromMatch(match),
        });
      }
      return;
    }

    if (n.type === "apply") {
      const key = calleeFromExp(n);
      // Skip type-like constructors: Just x, Runner
      if (key && !isLikelyTypeName(key.split(".").pop() ?? key)) {
        addCall(key, n.startIndex);
      }
      // Walk argument expressions for nested applies, but not bare variable args
      for (const child of namedChildren(n).slice(1)) {
        if (child.type === "variable" || child.type === "literal" || child.type === "unit") {
          continue;
        }
        if (child.type === "parens") {
          const inner = child.namedChild(0);
          if (inner) walk(inner);
          continue;
        }
        walk(child);
      }
      return;
    }

    if (n.type === "variable") {
      // Bare variable used as expression in do-block is a call-ish nullary
      if (n.text !== "return" && n.text !== "pure" && !isLikelyTypeName(n.text)) {
        addCall(n.text, n.startIndex);
      }
      return;
    }

    if (n.type === "qualified") {
      const key = calleeFromExp(n);
      if (key && !isLikelyTypeName(key.split(".").pop() ?? key)) {
        addCall(key, n.startIndex);
      }
      return;
    }

    if (n.type === "infix") {
      for (const child of namedChildren(n)) {
        if (child.type === "operator") continue;
        walk(child);
      }
      return;
    }

    if (n.type === "do") {
      for (const child of namedChildren(n)) {
        if (child.type === "exp") {
          const inner = child.namedChild(0) ?? child;
          walk(inner);
        } else {
          walk(child);
        }
      }
      return;
    }

    // Conditionals already handled; avoid double-counting by not
    // falling through into then/else when somehow re-entered.

    for (const child of namedChildren(n)) walk(child);
  };

  walk(node);
  return steps;
}

function handleFunctionOrBind(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const name =
    childByType(node, "variable")?.text ??
    namedChildren(node).find((c) => c.type === "variable")?.text ??
    null;
  if (!name) return;
  // Skip type signatures mistakenly matched — signatures use `signature` type
  const patterns = childByType(node, "patterns");
  const match = childByType(node, "match");
  functions.push({
    key: name,
    label: `${name}${getParamsLabel(patterns)}`,
    file,
    steps: collectFromMatch(match),
    exported: true,
    start: node.startIndex,
    end: node.endIndex,
  });
}

function visitDecls(file: string, decls: SyntaxNode, functions: FunctionInfo[]) {
  for (const d of namedChildren(decls)) {
    if (d.type === "function" || d.type === "bind") {
      // `function` nodes also appear inside signatures — only top-level with match
      if (childByType(d, "match") || d.type === "bind") {
        handleFunctionOrBind(file, d, functions);
      }
    }
  }
}

function extractFromTree(
  file: string,
  _source: string,
  tree: Tree,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const root = tree.rootNode;
  // haskell → declarations, or header + declarations
  for (const child of namedChildren(root)) {
    if (child.type === "declarations") {
      visitDecls(file, child, functions);
    }
  }
  // Some files may root directly under declarations-less structure
  if (functions.length === 0) {
    for (const child of namedChildren(root)) {
      if (child.type === "function" || child.type === "bind") {
        handleFunctionOrBind(file, child, functions);
      }
    }
  }
  return functions;
}

export const haskellExtractor: LanguageExtractor = {
  id: "haskell",
  extensions: [".hs"],
  grammarPackage: "tree-sitter-haskell",
  extract: extractFromTree,
};
