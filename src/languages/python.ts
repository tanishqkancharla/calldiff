/**
 * Minimal Python callable extraction (tree-sitter-python).
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

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "identifier") names.push(p.text);
    else if (p.type === "list_splat_pattern" || p.type === "dictionary_splat_pattern") {
      const id = childByType(p, "identifier");
      names.push(id ? `*${id.text}` : "*");
    } else if (p.type === "default_parameter") {
      const id = childByType(p, "identifier");
      names.push(id?.text ?? "_");
    } else {
      names.push("_");
    }
  }
  // Drop conventional self/cls from display? Keep them to match source.
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, className: string | null): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "attribute") {
    const object = node.namedChild(0);
    const attr = node.namedChild(1);
    if (!object || !attr) return null;
    const prop = attr.text;
    if (object.type === "identifier") {
      if ((object.text === "self" || object.text === "cls") && className) {
        return `${className}.${prop}`;
      }
      return `${object.text}.${prop}`;
    }
    if (className) return `${className}.${prop}`;
    return prop;
  }
  return null;
}

function collectBlock(block: SyntaxNode | null, className: string | null): CallStep[] {
  if (!block) return [];
  return collectStatements(namedChildren(block), className);
}

function collectStatements(
  statements: SyntaxNode[],
  className: string | null,
): CallStep[] {
  const steps: CallStep[] = [];
  const seen = new Set<string>();

  const addCall = (key: string, start: number) => {
    const mark = `${key}:${start}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    steps.push({ type: "call", key });
  };

  const walk = (node: SyntaxNode): void => {
    if (node.type === "function_definition" || node.type === "class_definition") {
      return;
    }

    if (node.type === "if_statement") {
      const condNode =
        namedChildren(node).find(
          (c) =>
            c.type !== "block" &&
            c.type !== "else_clause" &&
            c.type !== "elif_clause",
        ) ?? null;
      const cond = condNode ? collapseWs(condNode.text) : "";
      const body = childByType(node, "block");
      steps.push({
        type: "branch",
        key: cond ? `if:${cond}` : "if",
        label: cond ? `if ${cond}` : "if",
        children: collectBlock(body, className),
      });

      for (const clause of namedChildren(node)) {
        if (clause.type === "elif_clause") {
          const elifCond =
            namedChildren(clause).find((c) => c.type !== "block") ?? null;
          const text = elifCond ? collapseWs(elifCond.text) : "";
          steps.push({
            type: "branch",
            key: text ? `else-if:${text}` : "else-if",
            label: text ? `elif ${text}` : "elif",
            children: collectBlock(childByType(clause, "block"), className),
          });
        }
        if (clause.type === "else_clause") {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            children: collectBlock(childByType(clause, "block"), className),
          });
        }
      }
      return;
    }

    if (node.type === "call") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) addCall(key, node.startIndex);
      }
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function handleFunction(
  file: string,
  node: SyntaxNode,
  exported: boolean,
  className: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  // skip dunder unless __init__
  if (name.startsWith("__") && name !== "__init__") return;

  const params = childByType(node, "parameters");
  const body = childByType(node, "block");
  const isInit = name === "__init__";
  const key = className
    ? isInit
      ? `${className}.__init__`
      : `${className}.${name}`
    : name;
  const label = className && isInit ? `${className}()` : key;
  const paramsLabel = getParamsLabel(params);

  functions.push({
    key,
    label: `${label}${paramsLabel}`,
    file,
    steps: collectBlock(body, className),
    exported,
    start: node.startIndex,
    end: node.endIndex,
  });

  if (className && isInit) {
    const newKey = `new ${className}`;
    functions.push({
      key: newKey,
      label: `${className}()`,
      file,
      steps: collectBlock(body, className),
      exported,
      start: node.startIndex,
      end: node.endIndex,
    });
  }
}

function unwrapFunction(node: SyntaxNode): SyntaxNode | null {
  if (node.type === "function_definition") return node;
  if (node.type === "decorated_definition") {
    return childByType(node, "function_definition");
  }
  return null;
}

function handleClass(
  file: string,
  node: SyntaxNode,
  exported: boolean,
  functions: FunctionInfo[],
) {
  const className = childByType(node, "identifier")?.text ?? null;
  if (!className) return;
  const body = childByType(node, "block");
  if (!body) return;
  for (const stmt of namedChildren(body)) {
    const fn = unwrapFunction(stmt);
    if (fn) handleFunction(file, fn, exported, className, functions);
  }
}

function visit(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const fn = unwrapFunction(node);
  if (fn) {
    handleFunction(file, fn, true, null, functions);
    return;
  }
  if (node.type === "class_definition") {
    handleClass(file, node, true, functions);
  }
}

function extractFromTree(
  file: string,
  _source: string,
  tree: Tree,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  for (const stmt of namedChildren(tree.rootNode)) {
    visit(file, stmt, functions);
  }
  return functions;
}

export const pythonExtractor: LanguageExtractor = {
  id: "python",
  extensions: [".py"],
  grammarPackage: "tree-sitter-python",
  extract: extractFromTree,
};
