/**
 * PHP callable extraction (tree-sitter-php).
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

function isPrivate(node: SyntaxNode): boolean {
  return namedChildren(node).some(
    (c) => c.type === "visibility_modifier" && c.text === "private",
  );
}

function nameText(node: SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.type === "name") return node.text;
  if (node.type === "variable_name") {
    return childByType(node, "name")?.text ?? node.text.replace(/^\$/, "");
  }
  if (node.type === "qualified_name") {
    return collapseWs(node.text).replace(/^\s*\\/, "");
  }
  return node.text;
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "formal_parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type !== "simple_parameter" && p.type !== "variadic_parameter") {
      continue;
    }
    const varName = childByType(p, "variable_name");
    const n = nameText(varName);
    if (p.type === "variadic_parameter") {
      names.push(n ? `...${n}` : "...");
    } else {
      names.push(n ?? "_");
    }
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, _className: string | null): string | null {
  // Bare / qualified function call callee is usually `name` or `qualified_name`
  if (node.type === "name") return node.text;
  if (node.type === "qualified_name") {
    return collapseWs(node.text).replace(/^\s*\\/, "");
  }
  if (node.type === "variable_name") {
    // Dynamic $fn() — ignore
    return null;
  }
  return null;
}

function memberCallKey(
  node: SyntaxNode,
  className: string | null,
): string | null {
  // $this->prepare() / $obj->method()
  const object = node.namedChild(0);
  const method =
    namedChildren(node).find((c) => c.type === "name") ?? null;
  if (!object || !method) return null;
  const prop = method.text;
  const objName = nameText(object);
  if (objName === "this" && className) {
    return `${className}.${prop}`;
  }
  if (objName) return `${objName}.${prop}`;
  if (className) return `${className}.${prop}`;
  return prop;
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
  file: string,
  statements: SyntaxNode[],
  className: string | null,
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
      node.type === "function_definition" ||
      node.type === "method_declaration" ||
      node.type === "anonymous_function" ||
      node.type === "arrow_function" ||
      node.type === "class_declaration"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      const cond =
        node.childForFieldName("condition") ??
        childByType(node, "parenthesized_expression");
      const consequent =
        node.childForFieldName("body") ??
        node.childForFieldName("consequence") ??
        namedChildren(node).find(
          (c) =>
            c.type !== "parenthesized_expression" &&
            c.type !== "else_clause" &&
            c.type !== "else_if_clause",
        ) ??
        null;
      const text = condText(cond);
      steps.push({
        type: "branch",
        key: text ? `if:${text}` : "if",
        label: text ? `if ${text}` : "if",
        ...locFromNode(file, cond ?? node),
        children: consequent
          ? collectStatements(
              file,
              consequent.type === "compound_statement"
                ? namedChildren(consequent)
                : [consequent],
              className,
            )
          : [],
      });

      for (const child of namedChildren(node)) {
        if (child.type === "else_if_clause") {
          const elifCond =
            child.childForFieldName("condition") ??
            childByType(child, "parenthesized_expression");
          const elifText = condText(elifCond);
          const elifCons =
            child.childForFieldName("body") ??
            namedChildren(child).find(
              (c) => c.type !== "parenthesized_expression",
            ) ??
            null;
          steps.push({
            type: "branch",
            key: elifText ? `else-if:${elifText}` : "else-if",
            label: elifText ? `elseif ${elifText}` : "elseif",
            ...locFromNode(file, elifCond ?? child),
            children: elifCons
              ? collectStatements(
                  file,
                  elifCons.type === "compound_statement"
                    ? namedChildren(elifCons)
                    : [elifCons],
                  className,
                )
              : [],
          });
          continue;
        }
        if (child.type !== "else_clause") continue;

        let elseClause: SyntaxNode | null = child;
        while (elseClause) {
          const inner =
            childByType(elseClause, "if_statement") ??
            elseClause.namedChild(0);
          if (!inner) break;
          if (inner.type === "if_statement") {
            const elifCond =
              inner.childForFieldName("condition") ??
              childByType(inner, "parenthesized_expression");
            const elifText = condText(elifCond);
            const elifCons =
              inner.childForFieldName("body") ??
              inner.childForFieldName("consequence") ??
              namedChildren(inner).find(
                (c) =>
                  c.type !== "parenthesized_expression" &&
                  c.type !== "else_clause" &&
                  c.type !== "else_if_clause",
              ) ??
              null;
            steps.push({
              type: "branch",
              key: elifText ? `else-if:${elifText}` : "else-if",
              label: elifText ? `elseif ${elifText}` : "elseif",
              ...locFromNode(file, elifCond ?? elseClause),
              children: elifCons
                ? collectStatements(
                    file,
                    elifCons.type === "compound_statement"
                      ? namedChildren(elifCons)
                      : [elifCons],
                    className,
                  )
                : [],
            });
            // Nested if may have else_if_clause siblings too
            for (const nested of namedChildren(inner)) {
              if (nested.type === "else_if_clause") {
                const nCond =
                  nested.childForFieldName("condition") ??
                  childByType(nested, "parenthesized_expression");
                const nText = condText(nCond);
                const nBody =
                  nested.childForFieldName("body") ??
                  namedChildren(nested).find(
                    (c) => c.type !== "parenthesized_expression",
                  ) ??
                  null;
                steps.push({
                  type: "branch",
                  key: nText ? `else-if:${nText}` : "else-if",
                  label: nText ? `elseif ${nText}` : "elseif",
                  ...locFromNode(file, nCond ?? nested),
                  children: nBody
                    ? collectStatements(
                        file,
                        nBody.type === "compound_statement"
                          ? namedChildren(nBody)
                          : [nBody],
                        className,
                      )
                    : [],
                });
              }
            }
            elseClause = childByType(inner, "else_clause");
            continue;
          }
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            ...locFromNode(file, elseClause),
            children: collectStatements(
              file,
              inner.type === "compound_statement"
                ? namedChildren(inner)
                : [inner],
              className,
            ),
          });
          break;
        }
      }
      return;
    }

    if (node.type === "try_statement") {
      const body =
        node.childForFieldName("body") ??
        childByType(node, "compound_statement");
      steps.push({
        type: "branch",
        key: "try",
        label: "try",
        ...locFromNode(file, node),
        children: body
          ? collectStatements(file, namedChildren(body), className)
          : [],
      });
      for (const clause of namedChildren(node)) {
        if (clause.type === "catch_clause") {
          const types =
            childByType(clause, "type_list") ??
            namedChildren(clause).find((c) => c.type === "type_list") ??
            null;
          const text = types ? collapseWs(types.text) : "";
          const catchBody =
            clause.childForFieldName("body") ??
            childByType(clause, "compound_statement");
          steps.push({
            type: "branch",
            key: text ? `catch:${text}` : "catch",
            label: text ? `catch ${text}` : "catch",
            ...locFromNode(file, types ?? clause),
            children: catchBody
              ? collectStatements(file, namedChildren(catchBody), className)
              : [],
          });
        }
        if (clause.type === "finally_clause") {
          const finallyBody =
            clause.childForFieldName("body") ??
            childByType(clause, "compound_statement");
          steps.push({
            type: "branch",
            key: "finally",
            label: "finally",
            ...locFromNode(file, clause),
            children: finallyBody
              ? collectStatements(file, namedChildren(finallyBody), className)
              : [],
          });
        }
      }
      return;
    }

    if (node.type === "function_call_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) addCall(key, node);
      }
    } else if (node.type === "member_call_expression") {
      const key = memberCallKey(node, className);
      if (key) addCall(key, node);
    } else if (node.type === "scoped_call_expression") {
      // Foo::bar() / self::bar() / static::bar() / parent::bar()
      const method =
        namedChildren(node).filter((c) => c.type === "name").at(-1) ?? null;
      if (!method) {
        // fall through to children
      } else {
        const scope =
          childByType(node, "relative_scope") ??
          namedChildren(node).find((c) => c.type === "name" && c !== method) ??
          null;
        const scopeText = scope?.text ?? null;
        if (
          scopeText === "self" ||
          scopeText === "static" ||
          scopeText === "parent"
        ) {
          addCall(
            className ? `${className}.${method.text}` : method.text,
            node,
          );
        } else if (scopeText) {
          addCall(`${scopeText}.${method.text}`, node);
        } else {
          addCall(method.text, node);
        }
      }
    } else if (node.type === "object_creation_expression") {
      const typeName =
        namedChildren(node).find(
          (c) => c.type === "name" || c.type === "qualified_name",
        ) ?? null;
      if (typeName) {
        const n = nameText(typeName);
        if (n) addCall(`new ${n}`, node);
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
  const name = childByType(node, "name")?.text ?? null;
  if (!name) return;
  const params = childByType(node, "formal_parameters");
  const body = childByType(node, "compound_statement");
  functions.push({
    key: name,
    label: `${name}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(file, namedChildren(body), null) : [],
    exported: true,
    start: node.startIndex,
    end: node.endIndex,
  });
}

function handleMethod(
  file: string,
  node: SyntaxNode,
  className: string,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "name")?.text ?? null;
  if (!name) return;
  const params = childByType(node, "formal_parameters");
  const body = childByType(node, "compound_statement");
  const isCtor = name === "__construct";
  const key = isCtor ? `${className}.__construct` : `${className}.${name}`;
  const label = isCtor ? `${className}` : key;
  const info: FunctionInfo = {
    key,
    label: `${label}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(file, namedChildren(body), className) : [],
    exported: !isPrivate(node),
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);
  if (isCtor) {
    functions.push({
      ...info,
      key: `new ${className}`,
      label: `${className}${getParamsLabel(params)}`,
    });
  }
}

function handleClass(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const className = childByType(node, "name")?.text ?? null;
  if (!className) return;
  const body = childByType(node, "declaration_list");
  if (!body) return;
  for (const member of namedChildren(body)) {
    if (member.type === "method_declaration") {
      handleMethod(file, member, className, functions);
    }
  }
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
    } else if (stmt.type === "class_declaration") {
      handleClass(file, stmt, functions);
    } else if (stmt.type === "namespace_definition") {
      const body =
        childByType(stmt, "declaration_list") ??
        childByType(stmt, "compound_statement");
      if (body) {
        for (const inner of namedChildren(body)) {
          if (inner.type === "function_definition") {
            handleFunction(file, inner, functions);
          } else if (inner.type === "class_declaration") {
            handleClass(file, inner, functions);
          }
        }
      }
    }
  }
  return functions;
}

export const phpExtractor: LanguageExtractor = {
  id: "php",
  extensions: [".php"],
  grammarPackage: "tree-sitter-php",
  grammarExport: "php",
  extract: extractFromTree,
};
