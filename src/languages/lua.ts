/**
 * Lua callable extraction (@tree-sitter-grammars/tree-sitter-lua).
 *
 * Quirks:
 * - Prefer `@tree-sitter-grammars/tree-sitter-lua` over the Azganoth
 *   `tree-sitter-lua` package (NAN ABI, incompatible with tree-sitter 0.25).
 * - Method defs use `function Type:method` → method_index_expression;
 *   `function Type.method` → dot_index_expression.
 * - Calls: `obj:method()` → method_index_expression; `obj.method()` →
 *   dot_index_expression.
 * - Nested/local function bodies are not attributed to the outer caller.
 */
import type { CallStep, FunctionInfo } from "../types.js";
import {
  childByType,
  collapseWs,
  locFromNode,
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
    else if (p.type === "vararg_expression") names.push("...");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, typeName: string | null): string | null {
  if (node.type === "identifier") return node.text;

  if (
    node.type === "method_index_expression" ||
    node.type === "dot_index_expression"
  ) {
    const object = node.namedChild(0);
    const field = node.namedChild(1);
    if (!object || !field || field.type !== "identifier") return null;
    const prop = field.text;

    if (object.type === "identifier") {
      if (object.text === "self" && typeName) {
        return `${typeName}.${prop}`;
      }
      return `${object.text}.${prop}`;
    }
    if (typeName) return `${typeName}.${prop}`;
    return prop;
  }

  // Ignore computed: obj[key]()
  if (node.type === "bracket_index_expression") return null;

  return null;
}

function statementsOf(body: SyntaxNode | null): SyntaxNode[] {
  if (!body) return [];
  if (body.type === "block") return namedChildren(body);
  return [body];
}

function collectStatements(
  file: string,
  statements: SyntaxNode[],
  typeName: string | null,
): CallStep[] {
  const steps: CallStep[] = [];
  const seen = new Set<string>();

  const addCall = (key: string, node: SyntaxNode) => {
    const mark = `${key}:${node.startIndex}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    steps.push({ type: "call", key, ...locFromNode(file, node) });
  };

  const walk = (node: SyntaxNode): void => {
    if (
      node.type === "function_declaration" ||
      node.type === "function_definition"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      const kids = namedChildren(node);
      const thenBlock = childByType(node, "block");
      const cond =
        kids.find(
          (c) =>
            c.type !== "block" &&
            c.type !== "else_statement" &&
            c.type !== "elseif_statement",
        ) ?? null;
      const condText = cond ? collapseWs(cond.text) : "";
      steps.push({
        type: "branch",
        key: condText ? `if:${condText}` : "if",
        label: condText ? `if ${condText}` : "if",
        ...locFromNode(file, cond ?? node),
        children: collectStatements(file, statementsOf(thenBlock), typeName),
      });

      for (const clause of kids) {
        if (clause.type === "elseif_statement") {
          const elseifCond =
            namedChildren(clause).find((c) => c.type !== "block") ?? null;
          const text = elseifCond ? collapseWs(elseifCond.text) : "";
          steps.push({
            type: "branch",
            key: text ? `else-if:${text}` : "else-if",
            label: text ? `elseif ${text}` : "elseif",
            ...locFromNode(file, elseifCond ?? clause),
            children: collectStatements(
              file,
              statementsOf(childByType(clause, "block")),
              typeName,
            ),
          });
        }
        if (clause.type === "else_statement") {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            ...locFromNode(file, clause),
            children: collectStatements(
              file,
              statementsOf(childByType(clause, "block")),
              typeName,
            ),
          });
        }
      }
      return;
    }

    if (node.type === "function_call") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, typeName);
        if (key) addCall(key, node);
      }
      for (const child of namedChildren(node).slice(1)) walk(child);
      return;
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function functionName(
  node: SyntaxNode,
): { typeName: string | null; name: string } | null {
  const method = childByType(node, "method_index_expression");
  if (method) {
    const typeId = method.namedChild(0);
    const nameId = method.namedChild(1);
    if (typeId?.type === "identifier" && nameId?.type === "identifier") {
      return { typeName: typeId.text, name: nameId.text };
    }
  }

  const dotted = childByType(node, "dot_index_expression");
  if (dotted) {
    const typeId = dotted.namedChild(0);
    const nameId = dotted.namedChild(1);
    if (typeId?.type === "identifier" && nameId?.type === "identifier") {
      return { typeName: typeId.text, name: nameId.text };
    }
  }

  const id = childByType(node, "identifier");
  if (id) return { typeName: null, name: id.text };
  return null;
}

function isLocalFunction(node: SyntaxNode): boolean {
  // `local function foo` — grammar may expose `local` as an unnamed child
  // or via a leading "local" token in text.
  if (node.text.trimStart().startsWith("local ")) return true;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && !c.isNamed && c.text === "local") return true;
  }
  return false;
}

function handleFunction(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const parsed = functionName(node);
  if (!parsed) return;
  const { typeName, name } = parsed;
  const params = childByType(node, "parameters");
  const body = childByType(node, "block");
  const key = typeName ? `${typeName}.${name}` : name;
  const local = isLocalFunction(node);

  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: collectStatements(file, statementsOf(body), typeName),
    exported: !local,
    start: node.startIndex,
    end: node.endIndex,
  });
}

function extractFromTree(
  file: string,
  _source: string,
  tree: Tree,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];

  const visit = (node: SyntaxNode): void => {
    if (node.type === "function_declaration") {
      handleFunction(file, node, functions);
      // Still walk into body for nested function_declaration indexing
      const body = childByType(node, "block");
      if (body) {
        for (const child of namedChildren(body)) {
          if (
            child.type === "function_declaration" ||
            child.type === "variable_declaration" ||
            child.type === "assignment_statement"
          ) {
            visit(child);
          }
        }
      }
      return;
    }

    // local foo = function() ... end
    if (
      node.type === "function_definition" &&
      node.parent &&
      (node.parent.type === "variable_declaration" ||
        node.parent.type === "assignment_statement" ||
        node.parent.type === "expression_list")
    ) {
      // Prefer named binding from surrounding assignment when possible
      return;
    }

    for (const child of namedChildren(node)) visit(child);
  };

  visit(tree.rootNode);
  return functions;
}

export const luaExtractor: LanguageExtractor = {
  id: "lua",
  extensions: [".lua"],
  grammarPackage: "@tree-sitter-grammars/tree-sitter-lua",
  extract: extractFromTree,
};
