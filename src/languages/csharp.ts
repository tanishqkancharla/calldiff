/**
 * C# callable extraction (tree-sitter-c-sharp).
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

function isPrivate(node: SyntaxNode): boolean {
  return namedChildren(node).some(
    (c) => c.type === "modifier" && c.text === "private",
  );
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "parameter_list") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type !== "parameter") continue;
    const id = childByType(p, "identifier");
    names.push(id?.text ?? "_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function memberAccessKey(
  node: SyntaxNode,
  className: string | null,
): string | null {
  // this.Foo → unnamed "this" child + named property identifier
  const first = node.child(0);
  const ids = namedChildren(node).filter((c) => c.type === "identifier");
  if (first?.type === "this" || first?.text === "this") {
    const prop = ids[0]?.text;
    if (!prop) return null;
    return className ? `${className}.${prop}` : prop;
  }
  if (ids.length >= 2) {
    return `${ids[0]!.text}.${ids[1]!.text}`;
  }
  if (ids.length === 1) {
    // Unusual single-identifier member access
    return ids[0]!.text;
  }
  return null;
}

function calleeKey(node: SyntaxNode, className: string | null): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "member_access_expression") {
    return memberAccessKey(node, className);
  }
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
    if (
      node.type === "method_declaration" ||
      node.type === "constructor_declaration" ||
      node.type === "local_function_statement" ||
      node.type === "anonymous_method_expression" ||
      node.type === "lambda_expression" ||
      node.type === "class_declaration" ||
      node.type === "struct_declaration" ||
      node.type === "record_declaration"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      const cond =
        node.childForFieldName("condition") ?? node.namedChild(0) ?? null;
      const consequent =
        node.childForFieldName("consequence") ??
        namedChildren(node).find((c, i) => i > 0) ??
        null;
      const text = condText(cond);
      steps.push({
        type: "branch",
        key: text ? `if:${text}` : "if",
        label: text ? `if ${text}` : "if",
        children: consequent
          ? collectStatements(
              consequent.type === "block"
                ? namedChildren(consequent)
                : [consequent],
              className,
            )
          : [],
      });

      let alternative = node.childForFieldName("alternative");
      while (alternative) {
        if (alternative.type === "if_statement") {
          const elifCond =
            alternative.childForFieldName("condition") ??
            alternative.namedChild(0) ??
            null;
          const elifText = condText(elifCond);
          const elifCons =
            alternative.childForFieldName("consequence") ?? null;
          steps.push({
            type: "branch",
            key: elifText ? `else-if:${elifText}` : "else-if",
            label: elifText ? `else if ${elifText}` : "else if",
            children: elifCons
              ? collectStatements(
                  elifCons.type === "block"
                    ? namedChildren(elifCons)
                    : [elifCons],
                  className,
                )
              : [],
          });
          alternative = alternative.childForFieldName("alternative");
          continue;
        }
        steps.push({
          type: "branch",
          key: "else",
          label: "else",
          children: collectStatements(
            alternative.type === "block"
              ? namedChildren(alternative)
              : [alternative],
            className,
          ),
        });
        break;
      }
      return;
    }

    if (node.type === "try_statement") {
      const body =
        node.childForFieldName("body") ?? childByType(node, "block");
      steps.push({
        type: "branch",
        key: "try",
        label: "try",
        children: body
          ? collectStatements(namedChildren(body), className)
          : [],
      });
      for (const clause of namedChildren(node)) {
        if (clause.type === "catch_clause") {
          const decl = childByType(clause, "catch_declaration");
          const text = decl ? collapseWs(decl.text) : "";
          const catchBody =
            clause.childForFieldName("body") ?? childByType(clause, "block");
          steps.push({
            type: "branch",
            key: text ? `catch:${text}` : "catch",
            label: text ? `catch ${text}` : "catch",
            children: catchBody
              ? collectStatements(namedChildren(catchBody), className)
              : [],
          });
        }
        if (clause.type === "finally_clause") {
          const finallyBody =
            clause.childForFieldName("body") ?? childByType(clause, "block");
          steps.push({
            type: "branch",
            key: "finally",
            label: "finally",
            children: finallyBody
              ? collectStatements(namedChildren(finallyBody), className)
              : [],
          });
        }
      }
      return;
    }

    if (node.type === "switch_statement") {
      const body =
        node.childForFieldName("body") ?? childByType(node, "switch_body");
      if (body) {
        for (const section of namedChildren(body)) {
          if (section.type !== "switch_section") continue;
          const pattern =
            namedChildren(section).find(
              (c) =>
                c.type === "constant_pattern" ||
                c.type === "declaration_pattern" ||
                c.type === "var_pattern" ||
                c.type === "discard_pattern",
            ) ?? null;
          const isDefault = [...Array(section.childCount)]
            .map((_, i) => section.child(i))
            .some((c) => c?.type === "default" || c?.text === "default");
          const stmts = namedChildren(section).filter(
            (c) =>
              c !== pattern &&
              c.type !== "break_statement" &&
              c.type !== "constant_pattern" &&
              c.type !== "declaration_pattern" &&
              c.type !== "var_pattern" &&
              c.type !== "discard_pattern",
          );
          if (isDefault && !pattern) {
            steps.push({
              type: "branch",
              key: "default",
              label: "default",
              children: collectStatements(stmts, className),
            });
          } else {
            const text = pattern ? collapseWs(pattern.text) : "";
            steps.push({
              type: "branch",
              key: text ? `case:${text}` : "case",
              label: text ? `case ${text}` : "case",
              children: collectStatements(stmts, className),
            });
          }
        }
      }
      return;
    }

    if (node.type === "invocation_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) addCall(key, node.startIndex);
      }
    } else if (node.type === "object_creation_expression") {
      const typeId =
        childByType(node, "identifier") ??
        childByType(node, "qualified_name") ??
        namedChildren(node).find(
          (c) => c.type === "identifier" || c.type === "qualified_name",
        ) ??
        null;
      if (typeId) {
        addCall(`new ${collapseWs(typeId.text)}`, node.startIndex);
      }
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function handleMethod(
  file: string,
  node: SyntaxNode,
  className: string,
  functions: FunctionInfo[],
) {
  const name =
    node.childForFieldName("name")?.text ??
    // Fallback: last identifier (return type may precede the name)
    [...namedChildren(node)].filter((c) => c.type === "identifier").at(-1)
      ?.text ??
    null;
  if (!name) return;
  const params = childByType(node, "parameter_list");
  const body = childByType(node, "block");
  const key = `${className}.${name}`;
  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(namedChildren(body), className) : [],
    exported: !isPrivate(node),
    start: node.startIndex,
    end: node.endIndex,
  });
}

function handleConstructor(
  file: string,
  node: SyntaxNode,
  className: string,
  functions: FunctionInfo[],
) {
  const params = childByType(node, "parameter_list");
  const body = childByType(node, "block");
  const info: FunctionInfo = {
    key: `${className}.constructor`,
    label: `new ${className}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(namedChildren(body), className) : [],
    exported: !isPrivate(node),
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);
  functions.push({
    ...info,
    key: `new ${className}`,
  });
}

function handleClass(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const className = childByType(node, "identifier")?.text ?? null;
  if (!className) return;
  const body = childByType(node, "declaration_list");
  if (!body) return;

  for (const member of namedChildren(body)) {
    if (member.type === "method_declaration") {
      handleMethod(file, member, className, functions);
    } else if (member.type === "constructor_declaration") {
      handleConstructor(file, member, className, functions);
    }
  }
}

function visit(file: string, node: SyntaxNode, functions: FunctionInfo[]) {
  if (
    node.type === "class_declaration" ||
    node.type === "struct_declaration" ||
    node.type === "record_declaration"
  ) {
    handleClass(file, node, functions);
    return;
  }
  if (node.type === "namespace_declaration") {
    const list = childByType(node, "declaration_list") ?? node;
    for (const child of namedChildren(list)) visit(file, child, functions);
    return;
  }
  if (node.type === "file_scoped_namespace_declaration") {
    for (const child of namedChildren(node)) visit(file, child, functions);
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

export const csharpExtractor: LanguageExtractor = {
  id: "csharp",
  extensions: [".cs"],
  grammarPackage: "tree-sitter-c-sharp",
  extract: extractFromTree,
};
