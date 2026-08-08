/**
 * JavaScript / JSX callable extraction (tree-sitter-javascript).
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

function isFnLike(type: string): boolean {
  return (
    type === "function_declaration" ||
    type === "function_expression" ||
    type === "arrow_function" ||
    type === "generator_function" ||
    type === "generator_function_declaration" ||
    type === "method_definition"
  );
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params) return "()";
  // Single-param arrow: `x => ...` — params node may be the identifier itself
  if (params.type === "identifier") return `(${params.text})`;
  if (params.type !== "formal_parameters") return "()";

  const parts: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "identifier") {
      parts.push(p.text);
      continue;
    }
    if (p.type === "rest_pattern" || p.type === "rest_parameter") {
      const id = childByType(p, "identifier");
      parts.push(id ? `...${id.text}` : "...");
      continue;
    }
    if (p.type === "assignment_pattern") {
      const id = childByType(p, "identifier");
      parts.push(id?.text ?? "_");
      continue;
    }
    if (p.type === "object_pattern") {
      parts.push("{}");
      continue;
    }
    if (p.type === "array_pattern") {
      parts.push("[]");
      continue;
    }
    // TS-style wrappers if JSX/mixed grammars ever surface them
    if (p.type === "required_parameter" || p.type === "optional_parameter") {
      const id = childByType(p, "identifier");
      parts.push(id?.text ?? "_");
      continue;
    }
    parts.push("_");
  }
  return parts.length === 0 ? "()" : `(${parts.join(", ")})`;
}

function condText(test: SyntaxNode): string {
  if (test.type === "parenthesized_expression") {
    const inner = test.namedChild(0);
    if (inner) return collapseWs(inner.text);
  }
  return collapseWs(test.text);
}

function branchKey(kind: "if" | "else-if" | "else", cond: string): string {
  if (kind === "else") return "else";
  return `${kind}:${cond}`;
}

function calleeKey(node: SyntaxNode, className: string | null): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "this") return className;

  if (
    node.type === "member_expression" ||
    node.type === "subscript_expression"
  ) {
    if (node.type === "subscript_expression") return null;

    const object = node.namedChild(0);
    const property =
      namedChildren(node).find(
        (c) =>
          c.type === "property_identifier" ||
          c.type === "private_property_identifier",
      ) ?? null;
    if (!object || !property) return null;

    const propName = property.text;
    if (object.type === "this" && className) {
      return `${className}.${propName}`;
    }
    if (object.type === "identifier") {
      return `${object.text}.${propName}`;
    }
    if (className) return `${className}.${propName}`;
    return propName;
  }

  return null;
}

function statementsOf(node: SyntaxNode): SyntaxNode[] {
  if (node.type === "statement_block") return namedChildren(node);
  return [node];
}

function collectStatements(
  statements: SyntaxNode[],
  className: string | null,
): CallStep[] {
  const steps: CallStep[] = [];
  const seenCalls = new Set<string>();

  const addCall = (key: string, startIndex: number) => {
    const mark = `${key}:${startIndex}`;
    if (seenCalls.has(mark)) return;
    seenCalls.add(mark);
    steps.push({ type: "call", key });
  };

  const walkExpr = (node: SyntaxNode): void => {
    const type = node.type;

    if (isFnLike(type) && type !== "method_definition") {
      return;
    }

    if (type === "if_statement") {
      const test =
        childByType(node, "parenthesized_expression") ??
        namedChildren(node).find((c) => c.type !== "else_clause") ??
        null;
      const kids = namedChildren(node);
      const consequent =
        kids.find(
          (c) =>
            c.type !== "parenthesized_expression" && c.type !== "else_clause",
        ) ?? null;
      const elseClause = childByType(node, "else_clause");
      const cond = test ? condText(test) : "";

      steps.push({
        type: "branch",
        key: branchKey("if", cond),
        label: test ? `if (${condText(test)})` : "if",
        children: consequent
          ? collectStatements(statementsOf(consequent), className)
          : [],
      });

      let current = elseClause;
      while (current) {
        const inner = current.namedChild(0);
        if (!inner) break;

        if (inner.type === "if_statement") {
          const elseTest =
            childByType(inner, "parenthesized_expression") ?? null;
          const elseKids = namedChildren(inner);
          const elseConsequent =
            elseKids.find(
              (c) =>
                c.type !== "parenthesized_expression" &&
                c.type !== "else_clause",
            ) ?? null;
          const elseCond = elseTest ? condText(elseTest) : "";
          steps.push({
            type: "branch",
            key: branchKey("else-if", elseCond),
            label: elseTest ? `else if (${condText(elseTest)})` : "else if",
            children: elseConsequent
              ? collectStatements(statementsOf(elseConsequent), className)
              : [],
          });
          current = childByType(inner, "else_clause");
          continue;
        }

        steps.push({
          type: "branch",
          key: branchKey("else", ""),
          label: "else",
          children: collectStatements(statementsOf(inner), className),
        });
        break;
      }
      return;
    }

    if (type === "call_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) addCall(key, node.startIndex);
      }
    } else if (type === "new_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, null);
        if (key) {
          addCall(key.startsWith("new ") ? key : `new ${key}`, node.startIndex);
        }
      }
    }

    for (const child of namedChildren(node)) {
      walkExpr(child);
    }
  };

  for (const stmt of statements) {
    walkExpr(stmt);
  }

  return steps;
}

function collectStepsFromBody(
  body: SyntaxNode | null,
  className: string | null,
): CallStep[] {
  if (!body) return [];
  if (body.type === "statement_block") {
    return collectStatements(namedChildren(body), className);
  }
  return collectStatements([body], className);
}

function functionFromParts(
  file: string,
  key: string,
  label: string,
  params: SyntaxNode | null,
  body: SyntaxNode | null,
  exported: boolean,
  start: number,
  end: number,
  className: string | null,
): FunctionInfo {
  return {
    key,
    label: `${label}${getParamsLabel(params)}`,
    file,
    steps: collectStepsFromBody(body, className),
    exported,
    start,
    end,
  };
}

function paramsOf(node: SyntaxNode): SyntaxNode | null {
  return (
    childByType(node, "formal_parameters") ??
    // single-param arrow without parens
    (node.type === "arrow_function"
      ? (namedChildren(node).find((c) => c.type === "identifier") ?? null)
      : null)
  );
}

function bodyOf(node: SyntaxNode): SyntaxNode | null {
  return (
    childByType(node, "statement_block") ??
    namedChildren(node).find(
      (c) =>
        c.type !== "formal_parameters" &&
        c.type !== "identifier" &&
        c.type !== "property_identifier" &&
        c.type !== "private_property_identifier" &&
        c.type !== "decorator",
    ) ??
    null
  );
}

function handleFunctionNode(
  file: string,
  node: SyntaxNode,
  name: string | null,
  exported: boolean,
  className: string | null,
  functions: FunctionInfo[],
) {
  if (!name) return;
  const key = className ? `${className}.${name}` : name;
  functions.push(
    functionFromParts(
      file,
      key,
      key,
      paramsOf(node),
      bodyOf(node),
      exported,
      node.startIndex,
      node.endIndex,
      className,
    ),
  );
}

function handleClass(
  file: string,
  node: SyntaxNode,
  exported: boolean,
  functions: FunctionInfo[],
) {
  const nameNode = childByType(node, "identifier");
  const className = nameNode?.text ?? null;
  if (!className) return;

  const body = childByType(node, "class_body");
  if (!body) return;

  for (const element of namedChildren(body)) {
    if (element.type === "method_definition") {
      const keyNode =
        childByType(element, "property_identifier") ??
        childByType(element, "private_property_identifier") ??
        childByType(element, "computed_property_name");
      const methodName = keyNode?.text ?? null;
      if (!methodName) continue;
      // Skip computed names
      if (keyNode?.type === "computed_property_name") continue;

      const isConstructor = methodName === "constructor";
      const params = childByType(element, "formal_parameters");
      const fnBody = childByType(element, "statement_block");
      const key = isConstructor
        ? `${className}.constructor`
        : `${className}.${methodName}`;
      const label = isConstructor ? `new ${className}()` : key;

      functions.push(
        functionFromParts(
          file,
          key,
          label,
          params,
          fnBody,
          exported,
          element.startIndex,
          element.endIndex,
          className,
        ),
      );
    }

    if (element.type === "field_definition") {
      const keyNode = childByType(element, "property_identifier");
      const value =
        childByType(element, "arrow_function") ??
        childByType(element, "function_expression");
      if (keyNode && value) {
        handleFunctionNode(
          file,
          value,
          keyNode.text,
          exported,
          className,
          functions,
        );
      }
    }
  }
}

function visitStatement(
  file: string,
  node: SyntaxNode,
  exported: boolean,
  functions: FunctionInfo[],
) {
  if (node.type === "export_statement") {
    const decl =
      namedChildren(node).find((c) => c.type !== "export_clause") ?? null;
    if (!decl) return;

    const isDefault = node.text.startsWith("export default");

    if (
      decl.type === "function_declaration" ||
      decl.type === "function_expression" ||
      decl.type === "generator_function_declaration" ||
      decl.type === "generator_function"
    ) {
      const id = childByType(decl, "identifier");
      const name = id?.text ?? (isDefault ? "default" : null);
      handleFunctionNode(file, decl, name, true, null, functions);
      return;
    }
    if (decl.type === "arrow_function") {
      handleFunctionNode(
        file,
        decl,
        isDefault ? "default" : null,
        true,
        null,
        functions,
      );
      return;
    }
    if (decl.type === "class_declaration" || decl.type === "class") {
      handleClass(file, decl, true, functions);
      return;
    }
    if (
      decl.type === "lexical_declaration" ||
      decl.type === "variable_declaration"
    ) {
      visitStatement(file, decl, true, functions);
    }
    return;
  }

  if (
    node.type === "function_declaration" ||
    node.type === "generator_function_declaration"
  ) {
    const id = childByType(node, "identifier");
    handleFunctionNode(file, node, id?.text ?? null, exported, null, functions);
    return;
  }

  if (node.type === "class_declaration") {
    handleClass(file, node, exported, functions);
    return;
  }

  if (
    node.type === "lexical_declaration" ||
    node.type === "variable_declaration"
  ) {
    for (const d of namedChildren(node)) {
      if (d.type !== "variable_declarator") continue;
      const id = childByType(d, "identifier");
      const init =
        childByType(d, "arrow_function") ??
        childByType(d, "function_expression");
      if (id && init) {
        handleFunctionNode(file, init, id.text, exported, null, functions);
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
    visitStatement(file, stmt, false, functions);
  }
  return functions;
}

export const javascriptExtractor: LanguageExtractor = {
  id: "javascript",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  grammarPackage: "tree-sitter-javascript",
  extract: extractFromTree,
};
