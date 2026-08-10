/**
 * Go callable extraction (tree-sitter-go).
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

function isExported(name: string): boolean {
  const ch = name[0];
  return ch !== undefined && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "parameter_list") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type !== "parameter_declaration") continue;
    const ids = namedChildren(p).filter((c) => c.type === "identifier");
    if (ids.length === 0) names.push("_");
    else for (const id of ids) names.push(id.text);
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, receiverType: string | null): string | null {
  if (node.type === "identifier") {
    // NewThing() → new Thing (constructor alias)
    if (node.text.startsWith("New") && node.text.length > 3) {
      const typeName = node.text.slice(3);
      if (isExported(typeName)) return `new ${typeName}`;
    }
    return node.text;
  }
  if (node.type === "selector_expression") {
    const object = node.namedChild(0);
    const field = childByType(node, "field_identifier");
    if (!object || !field) return null;
    const prop = field.text;
    if (object.type === "identifier") {
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

function collectIf(
  file: string,
  node: SyntaxNode,
  receiverType: string | null,
  steps: CallStep[],
  asElseIf = false,
): void {
  const kids = namedChildren(node);
  const consequent = kids.find((c) => c.type === "block") ?? null;
  const alt =
    kids.find((c) => c !== consequent && (c.type === "block" || c.type === "if_statement")) ??
    null;
  const before = consequent
    ? kids.slice(0, kids.indexOf(consequent))
    : kids;
  const condNode = before[before.length - 1] ?? null;
  const condText = condNode ? collapseWs(condNode.text) : "";
  const kind = asElseIf ? "else-if" : "if";
  const labelKind = asElseIf ? "else if" : "if";

  steps.push({
    type: "branch",
    key: condText ? `${kind}:${condText}` : kind,
    label: condText ? `${labelKind} ${condText}` : labelKind,
    ...locFromNode(file, condNode ?? node),
    children: consequent
      ? collectStatements(file, statementsOf(consequent), receiverType)
      : [],
  });

  if (!alt) return;
  if (alt.type === "if_statement") {
    collectIf(file, alt, receiverType, steps, true);
  } else {
    steps.push({
      type: "branch",
      key: "else",
      label: "else",
      ...locFromNode(file, alt),
      children: collectStatements(file, statementsOf(alt), receiverType),
    });
  }
}

function collectStatements(
  file: string,
  statements: SyntaxNode[],
  receiverType: string | null,
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
      node.type === "method_declaration" ||
      node.type === "func_literal"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      collectIf(file, node, receiverType, steps, false);
      return;
    }

    if (node.type === "defer_statement") {
      steps.push({
        type: "branch",
        key: "defer",
        label: "defer",
        ...locFromNode(file, node),
        children: collectStatements(file, namedChildren(node), receiverType),
      });
      return;
    }

    if (
      node.type === "expression_switch_statement" ||
      node.type === "type_switch_statement"
    ) {
      const kids = namedChildren(node);
      const subject =
        kids.find(
          (c) =>
            c.type !== "expression_case" &&
            c.type !== "type_case" &&
            c.type !== "default_case",
        ) ?? null;
      const subjectText = subject ? collapseWs(subject.text) : "";
      for (const clause of kids) {
        if (clause.type === "expression_case" || clause.type === "type_case") {
          const expr =
            childByType(clause, "expression_list") ??
            childByType(clause, "type_list") ??
            namedChildren(clause).find((c) => c.type !== "statement_list") ??
            null;
          const text = expr ? collapseWs(expr.text) : "";
          const list = childByType(clause, "statement_list");
          steps.push({
            type: "branch",
            key: text ? `case:${text}` : "case",
            label: text
              ? `case ${text}`
              : subjectText
                ? `case ${subjectText}`
                : "case",
            ...locFromNode(file, expr ?? clause),
            children: list
              ? collectStatements(file, namedChildren(list), receiverType)
              : [],
          });
        }
        if (clause.type === "default_case") {
          const list = childByType(clause, "statement_list");
          steps.push({
            type: "branch",
            key: "default",
            label: "default",
            ...locFromNode(file, clause),
            children: list
              ? collectStatements(file, namedChildren(list), receiverType)
              : [],
          });
        }
      }
      return;
    }

    if (node.type === "call_expression") {
      const callee = node.namedChild(0);
      if (callee && callee.type !== "func_literal") {
        const key = calleeKey(callee, receiverType);
        if (key) addCall(key, node);
      }
      // Do not walk into func_literal callees/bodies
      for (const child of namedChildren(node)) {
        if (child.type === "func_literal") continue;
        if (child === callee) continue;
        walk(child);
      }
      return;
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
  const info: FunctionInfo = {
    key: name,
    label: `${name}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(file, statementsOf(body), null) : [],
    exported: isExported(name),
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);

  // NewThing → constructor alias `new Thing`
  if (name.startsWith("New") && name.length > 3) {
    const typeName = name.slice(3);
    if (isExported(typeName)) {
      functions.push({
        ...info,
        key: `new ${typeName}`,
        label: `${typeName}()`,
      });
    }
  }
}

function handleMethod(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const typeName = receiverTypeName(node);
  const name = childByType(node, "field_identifier")?.text ?? null;
  if (!typeName || !name) return;

  const paramLists = namedChildren(node).filter(
    (c) => c.type === "parameter_list",
  );
  const params = paramLists[1] ?? paramLists[0] ?? null;
  const body = childByType(node, "block");
  const key = `${typeName}.${name}`;

  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(file, statementsOf(body), typeName) : [],
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
