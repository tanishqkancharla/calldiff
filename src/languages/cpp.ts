/**
 * C++ callable extraction (tree-sitter-cpp).
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

function unwrapDeclarator(node: SyntaxNode | null): SyntaxNode | null {
  let cur = node;
  while (cur) {
    if (cur.type === "function_declarator") return cur;
    const next =
      childByType(cur, "function_declarator") ??
      childByType(cur, "pointer_declarator") ??
      childByType(cur, "reference_declarator") ??
      childByType(cur, "parenthesized_declarator") ??
      null;
    if (!next || next === cur) break;
    cur = next;
  }
  return cur?.type === "function_declarator" ? cur : null;
}

function getParamsLabel(declarator: SyntaxNode | null): string {
  const params = declarator ? childByType(declarator, "parameter_list") : null;
  if (!params) return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type !== "parameter_declaration") continue;
    if (p.text === "void") continue;
    const id =
      childByType(p, "identifier") ??
      childByType(childByType(p, "pointer_declarator") ?? p, "identifier") ??
      childByType(childByType(p, "reference_declarator") ?? p, "identifier");
    names.push(id?.text ?? "_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, className: string | null): string | null {
  if (node.type === "identifier") {
    return node.text;
  }
  if (node.type === "type_identifier") {
    // Rare as a bare callee; prefer not inventing `new`
    return node.text;
  }
  if (node.type === "qualified_identifier") {
    // std::foo / Foo::bar — normalize :: to . for Class.method keys
    return collapseWs(node.text).replace(/\s+/g, "").replace(/::/g, ".");
  }
  if (node.type === "field_expression") {
    const object = node.namedChild(0);
    const field = childByType(node, "field_identifier");
    if (!object || !field) return null;
    const prop = field.text;
    if (object.type === "this" && className) {
      return `${className}.${prop}`;
    }
    if (object.type === "identifier") {
      return `${object.text}.${prop}`;
    }
    if (className) return `${className}.${prop}`;
    return prop;
  }
  return null;
}

function condText(node: SyntaxNode | null): string {
  if (!node) return "";
  if (node.type === "condition_clause" || node.type === "parenthesized_expression") {
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
      node.type === "function_definition" ||
      node.type === "lambda_expression" ||
      node.type === "class_specifier" ||
      node.type === "struct_specifier"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      const cond =
        node.childForFieldName("condition") ??
        childByType(node, "condition_clause") ??
        childByType(node, "parenthesized_expression");
      const consequent =
        node.childForFieldName("consequence") ??
        namedChildren(node).find(
          (c) =>
            c.type !== "condition_clause" &&
            c.type !== "parenthesized_expression" &&
            c.type !== "else_clause",
        ) ??
        null;
      const text = condText(cond);
      steps.push({
        type: "branch",
        key: text ? `if:${text}` : "if",
        label: text ? `if ${text}` : "if",
        children: consequent
          ? collectStatements([consequent], className)
          : [],
      });

      let elseClause = childByType(node, "else_clause");
      while (elseClause) {
        const inner = elseClause.namedChild(0);
        if (!inner) break;
        if (inner.type === "if_statement") {
          const elifCond =
            inner.childForFieldName("condition") ??
            childByType(inner, "condition_clause");
          const elifText = condText(elifCond);
          const elifCons =
            inner.childForFieldName("consequence") ??
            namedChildren(inner).find(
              (c) =>
                c.type !== "condition_clause" &&
                c.type !== "parenthesized_expression" &&
                c.type !== "else_clause",
            ) ??
            null;
          steps.push({
            type: "branch",
            key: elifText ? `else-if:${elifText}` : "else-if",
            label: elifText ? `else if ${elifText}` : "else if",
            children: elifCons
              ? collectStatements([elifCons], className)
              : [],
          });
          elseClause = childByType(inner, "else_clause");
          continue;
        }
        steps.push({
          type: "branch",
          key: "else",
          label: "else",
          children: collectStatements([inner], className),
        });
        break;
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
        children: body
          ? collectStatements(namedChildren(body), className)
          : [],
      });
      for (const clause of namedChildren(node)) {
        if (clause.type !== "catch_clause") continue;
        const params = childByType(clause, "parameter_list");
        const text = params ? collapseWs(params.text) : "";
        const catchBody =
          clause.childForFieldName("body") ??
          childByType(clause, "compound_statement");
        steps.push({
          type: "branch",
          key: text ? `catch:${text}` : "catch",
          label: text ? `catch ${text}` : "catch",
          children: catchBody
            ? collectStatements(namedChildren(catchBody), className)
            : [],
        });
      }
      return;
    }

    if (node.type === "call_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) addCall(key, node.startIndex);
      }
    } else if (node.type === "new_expression") {
      const typeId =
        childByType(node, "type_identifier") ??
        namedChildren(node).find(
          (c) => c.type === "type_identifier" || c.type === "qualified_identifier",
        ) ??
        null;
      if (typeId) {
        const name = collapseWs(typeId.text);
        addCall(`new ${name}`, node.startIndex);
      }
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function pushFunction(
  file: string,
  node: SyntaxNode,
  key: string,
  label: string,
  declarator: SyntaxNode | null,
  body: SyntaxNode | null,
  className: string | null,
  exported: boolean,
  functions: FunctionInfo[],
) {
  const info: FunctionInfo = {
    key,
    label: `${label}${getParamsLabel(declarator)}`,
    file,
    steps: body ? collectStatements(namedChildren(body), className) : [],
    exported,
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);
}

function handleFreeFunction(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const rawDecl =
    namedChildren(node).find(
      (c) =>
        c.type === "function_declarator" ||
        c.type === "pointer_declarator" ||
        c.type === "reference_declarator",
    ) ?? null;
  const declarator = unwrapDeclarator(rawDecl);
  if (!declarator) return;
  if (childByType(declarator, "destructor_name")) return;

  const name =
    childByType(declarator, "identifier")?.text ??
    childByType(declarator, "field_identifier")?.text ??
    null;
  if (!name) return;

  const body = childByType(node, "compound_statement");
  pushFunction(file, node, name, name, declarator, body, null, true, functions);
}

function handleClassMethod(
  file: string,
  node: SyntaxNode,
  className: string,
  functions: FunctionInfo[],
) {
  const rawDecl =
    namedChildren(node).find(
      (c) =>
        c.type === "function_declarator" ||
        c.type === "pointer_declarator" ||
        c.type === "reference_declarator",
    ) ?? null;
  const declarator = unwrapDeclarator(rawDecl);
  if (!declarator) return;

  const dtor = childByType(declarator, "destructor_name");
  if (dtor) {
    // Skip destructors for callgraph indexing
    return;
  }

  const nameNode =
    childByType(declarator, "identifier") ??
    childByType(declarator, "field_identifier");
  const name = nameNode?.text ?? null;
  if (!name) return;

  const body = childByType(node, "compound_statement");
  const isCtor = name === className;
  const key = isCtor ? `${className}.constructor` : `${className}.${name}`;
  const label = isCtor ? `new ${className}` : key;

  pushFunction(
    file,
    node,
    key,
    label,
    declarator,
    body,
    className,
    true,
    functions,
  );

  if (isCtor) {
    const ctor = functions[functions.length - 1]!;
    functions.push({
      ...ctor,
      key: `new ${className}`,
      label: `new ${className}${getParamsLabel(declarator)}`,
    });
  }
}

function handleClass(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const className =
    childByType(node, "type_identifier")?.text ??
    childByType(node, "identifier")?.text ??
    null;
  if (!className) return;
  const body = childByType(node, "field_declaration_list");
  if (!body) return;

  for (const member of namedChildren(body)) {
    if (member.type === "function_definition") {
      handleClassMethod(file, member, className, functions);
    }
  }
}

function visit(file: string, node: SyntaxNode, functions: FunctionInfo[]) {
  if (node.type === "function_definition") {
    handleFreeFunction(file, node, functions);
    return;
  }
  if (
    node.type === "class_specifier" ||
    node.type === "struct_specifier"
  ) {
    handleClass(file, node, functions);
    return;
  }
  if (node.type === "namespace_definition" || node.type === "declaration_list") {
    for (const child of namedChildren(node)) visit(file, child, functions);
    return;
  }
  // `class Foo { ... };` may wrap as type declaration — walk named children lightly
  if (node.type === "declaration") {
    for (const child of namedChildren(node)) {
      if (
        child.type === "class_specifier" ||
        child.type === "struct_specifier" ||
        child.type === "namespace_definition"
      ) {
        visit(file, child, functions);
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
  for (const stmt of namedChildren(tree.rootNode)) {
    visit(file, stmt, functions);
  }
  return functions;
}

export const cppExtractor: LanguageExtractor = {
  id: "cpp",
  extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hh"],
  grammarPackage: "tree-sitter-cpp",
  extract: extractFromTree,
};
