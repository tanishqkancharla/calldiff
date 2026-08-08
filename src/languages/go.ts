/**
 * Minimal Go callable extraction (tree-sitter-go).
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

function isExported(name: string): boolean {
  const ch = name[0];
  return ch !== undefined && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "parameter_list") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type !== "parameter_declaration") continue;
    const id = childByType(p, "identifier");
    names.push(id?.text ?? "_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, receiverType: string | null): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "selector_expression") {
    const object = node.namedChild(0);
    const field = childByType(node, "field_identifier");
    if (!object || !field) return null;
    const prop = field.text;
    if (object.type === "identifier") {
      // Heuristic: lowercase receiver var → Type.Method when in a method
      const objName = object.text;
      if (
        receiverType &&
        objName[0] &&
        objName[0] === objName[0].toLowerCase()
      ) {
        return `${receiverType}.${prop}`;
      }
      return `${objName}.${prop}`;
    }
    if (receiverType) return `${receiverType}.${prop}`;
    return prop;
  }
  return null;
}

function statementsOf(node: SyntaxNode): SyntaxNode[] {
  if (node.type === "block") {
    const list = childByType(node, "statement_list");
    return list ? namedChildren(list) : namedChildren(node);
  }
  if (node.type === "statement_list") return namedChildren(node);
  return [node];
}

function collectStatements(
  statements: SyntaxNode[],
  receiverType: string | null,
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
    if (
      node.type === "function_declaration" ||
      node.type === "method_declaration"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      const kids = namedChildren(node);
      const cond =
        kids.find((c) => c.type !== "block") ?? null;
      const blocks = kids.filter((c) => c.type === "block");
      const condText = cond ? collapseWs(cond.text) : "";
      steps.push({
        type: "branch",
        key: condText ? `if:${condText}` : "if",
        label: condText ? `if ${condText}` : "if",
        children: blocks[0]
          ? collectStatements(statementsOf(blocks[0]), receiverType)
          : [],
      });
      if (blocks[1]) {
        steps.push({
          type: "branch",
          key: "else",
          label: "else",
          children: collectStatements(statementsOf(blocks[1]), receiverType),
        });
      }
      return;
    }

    if (node.type === "call_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, receiverType);
        if (key) addCall(key, node.startIndex);
      }
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function receiverTypeName(method: SyntaxNode): string | null {
  const recv = method.namedChild(0);
  if (!recv || recv.type !== "parameter_list") return null;
  const decl = childByType(recv, "parameter_declaration");
  if (!decl) return null;
  const pointer = childByType(decl, "pointer_type");
  const typeId =
    childByType(pointer ?? decl, "type_identifier") ??
    childByType(decl, "type_identifier");
  return typeId?.text ?? null;
}

function handleFunction(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  const params =
    namedChildren(node).find((c) => c.type === "parameter_list") ?? null;
  const body = childByType(node, "block");
  functions.push({
    key: name,
    label: `${name}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(statementsOf(body), null) : [],
    exported: isExported(name),
    start: node.startIndex,
    end: node.endIndex,
  });
}

function handleMethod(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const typeName = receiverTypeName(node);
  const name = childByType(node, "field_identifier")?.text ?? null;
  if (!typeName || !name) return;

  // parameter_list after receiver
  const paramLists = namedChildren(node).filter((c) => c.type === "parameter_list");
  const params = paramLists[1] ?? paramLists[0] ?? null;
  const body = childByType(node, "block");
  const key = `${typeName}.${name}`;

  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(statementsOf(body), typeName) : [],
    exported: isExported(name),
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
  for (const stmt of namedChildren(tree.rootNode)) {
    if (stmt.type === "function_declaration") {
      handleFunction(file, stmt, functions);
    } else if (stmt.type === "method_declaration") {
      handleMethod(file, stmt, functions);
    }
  }
  return functions;
}

export const goExtractor: LanguageExtractor = {
  id: "go",
  extensions: [".go"],
  grammarPackage: "tree-sitter-go",
  extract: extractFromTree,
};
