/**
 * C callable extraction (tree-sitter-c).
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

function hasStatic(node: SyntaxNode): boolean {
  return namedChildren(node).some((c) => c.type === "storage_class_specifier" && c.text === "static");
}

function unwrapDeclarator(node: SyntaxNode | null): SyntaxNode | null {
  let cur = node;
  while (cur) {
    if (cur.type === "function_declarator") return cur;
    const next =
      childByType(cur, "function_declarator") ??
      childByType(cur, "pointer_declarator") ??
      childByType(cur, "parenthesized_declarator") ??
      childByType(cur, "array_declarator") ??
      null;
    if (!next || next === cur) break;
    cur = next;
  }
  return cur?.type === "function_declarator" ? cur : null;
}

function functionName(def: SyntaxNode): string | null {
  const declarator =
    unwrapDeclarator(
      namedChildren(def).find(
        (c) =>
          c.type === "function_declarator" ||
          c.type === "pointer_declarator" ||
          c.type === "parenthesized_declarator",
      ) ?? null,
    ) ?? childByType(def, "function_declarator");
  if (!declarator) return null;
  return (
    childByType(declarator, "identifier")?.text ??
    childByType(declarator, "field_identifier")?.text ??
    null
  );
}

function getParamsLabel(def: SyntaxNode): string {
  const declarator =
    unwrapDeclarator(
      namedChildren(def).find(
        (c) =>
          c.type === "function_declarator" ||
          c.type === "pointer_declarator" ||
          c.type === "parenthesized_declarator",
      ) ?? null,
    ) ?? childByType(def, "function_declarator");
  const params = declarator ? childByType(declarator, "parameter_list") : null;
  if (!params) return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type !== "parameter_declaration") continue;
    if (p.text === "void") continue;
    const id =
      childByType(p, "identifier") ??
      childByType(childByType(p, "pointer_declarator") ?? p, "identifier");
    names.push(id?.text ?? "_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "field_expression") {
    const object = node.namedChild(0);
    const field = childByType(node, "field_identifier");
    if (!object || !field) return null;
    if (object.type === "identifier") {
      return `${object.text}.${field.text}`;
    }
    return field.text;
  }
  // Ignore computed / weird callees
  return null;
}

function condText(node: SyntaxNode | null): string {
  if (!node) return "";
  if (node.type === "parenthesized_expression") {
    const inner = node.namedChild(0);
    if (inner) return collapseWs(inner.text);
  }
  return collapseWs(node.text);
}

function collectStatements(file: string, statements: SyntaxNode[]): CallStep[] {
  const steps: CallStep[] = [];
  const seen = new Set<string>();

  const addCall = (key: string, node: SyntaxNode) => {
    const mark = `${key}:${node.startIndex}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    steps.push({ type: "call", key, ...locFromNode(file, node) });
  };

  const walk = (node: SyntaxNode): void => {
    // Nested function definitions (GCC extension) — skip bodies
    if (node.type === "function_definition") return;

    if (node.type === "if_statement") {
      const cond =
        node.childForFieldName("condition") ??
        childByType(node, "parenthesized_expression");
      const consequent =
        node.childForFieldName("consequence") ??
        namedChildren(node).find(
          (c) => c.type !== "parenthesized_expression" && c.type !== "else_clause",
        ) ??
        null;
      const text = condText(cond);
      steps.push({
        type: "branch",
        key: text ? `if:${text}` : "if",
        label: text ? `if ${text}` : "if",
        ...locFromNode(file, cond ?? node),
        children: consequent ? collectStatements(file, [consequent]) : [],
      });

      let elseClause = childByType(node, "else_clause");
      while (elseClause) {
        const inner = elseClause.namedChild(0);
        if (!inner) break;
        if (inner.type === "if_statement") {
          const elifCond =
            inner.childForFieldName("condition") ??
            childByType(inner, "parenthesized_expression");
          const elifText = condText(elifCond);
          const elifCons =
            inner.childForFieldName("consequence") ??
            namedChildren(inner).find(
              (c) =>
                c.type !== "parenthesized_expression" &&
                c.type !== "else_clause",
            ) ??
            null;
          steps.push({
            type: "branch",
            key: elifText ? `else-if:${elifText}` : "else-if",
            label: elifText ? `else if ${elifText}` : "else if",
            ...locFromNode(file, elifCond ?? elseClause),
            children: elifCons ? collectStatements(file, [elifCons]) : [],
          });
          elseClause = childByType(inner, "else_clause");
          continue;
        }
        steps.push({
          type: "branch",
          key: "else",
          label: "else",
          ...locFromNode(file, elseClause),
          children: collectStatements(file, [inner]),
        });
        break;
      }
      return;
    }

    if (node.type === "switch_statement") {
      const body =
        node.childForFieldName("body") ??
        childByType(node, "compound_statement");
      if (body) {
        for (const clause of namedChildren(body)) {
          if (clause.type !== "case_statement") continue;
          const value = clause.childForFieldName("value");
          const kids = namedChildren(clause).filter(
            (c) => c !== value && c.type !== "break_statement",
          );
          if (value) {
            const text = collapseWs(value.text);
            steps.push({
              type: "branch",
              key: `case:${text}`,
              label: `case ${text}`,
              ...locFromNode(file, value),
              children: collectStatements(file, kids),
            });
          } else {
            steps.push({
              type: "branch",
              key: "default",
              label: "default",
              ...locFromNode(file, clause),
              children: collectStatements(file, kids),
            });
          }
        }
      }
      return;
    }

    if (node.type === "call_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee);
        if (key) addCall(key, node);
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
  functions: FunctionInfo[],
) {
  const name = functionName(node);
  if (!name) return;
  const body = childByType(node, "compound_statement");
  functions.push({
    key: name,
    label: `${name}${getParamsLabel(node)}`,
    file,
    steps: body ? collectStatements(file, namedChildren(body)) : [],
    exported: !hasStatic(node),
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
    if (stmt.type === "function_definition") {
      handleFunction(file, stmt, functions);
    }
  }
  return functions;
}

export const cExtractor: LanguageExtractor = {
  id: "c",
  extensions: [".c", ".h"],
  grammarPackage: "tree-sitter-c",
  extract: extractFromTree,
};
