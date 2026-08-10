/**
 * JavaScript / JSX callable extraction (tree-sitter-javascript).
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

/**
 * Treat JSX tags as component "calls". PascalCase identifiers and any
 * member expression (`Foo.Bar`, `motion.div`) count; lowercase tags are HTML.
 */
function jsxCalleeKey(node: SyntaxNode): string | null {
  for (const child of namedChildren(node)) {
    if (child.type === "identifier") {
      const name = child.text;
      return /^[A-Z]/.test(name) ? name : null;
    }
    if (child.type === "member_expression") {
      return calleeKey(child, null);
    }
    if (
      child.type === "jsx_attribute" ||
      child.type === "jsx_expression" ||
      child.type === "type_arguments"
    ) {
      break;
    }
  }
  return null;
}

function statementsOf(node: SyntaxNode): SyntaxNode[] {
  if (node.type === "statement_block") return namedChildren(node);
  return [node];
}

function collectStatements(
  file: string,
  statements: SyntaxNode[],
  className: string | null,
): CallStep[] {
  const steps: CallStep[] = [];
  const seenCalls = new Set<string>();

  const addCall = (key: string, node: SyntaxNode) => {
    const mark = `${key}:${node.startIndex}`;
    if (seenCalls.has(mark)) return;
    seenCalls.add(mark);
    steps.push({ type: "call", key, ...locFromNode(file, node) });
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
        ...locFromNode(file, test ?? node),
        children: consequent
          ? collectStatements(file, statementsOf(consequent), className)
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
            ...locFromNode(file, elseTest ?? current),
            children: elseConsequent
              ? collectStatements(file, statementsOf(elseConsequent), className)
              : [],
          });
          current = childByType(inner, "else_clause");
          continue;
        }

        steps.push({
          type: "branch",
          key: branchKey("else", ""),
          label: "else",
          ...locFromNode(file, current),
          children: collectStatements(file, statementsOf(inner), className),
        });
        break;
      }
      return;
    }

    if (type === "try_statement") {
      const tryBlock = childByType(node, "statement_block");
      steps.push({
        type: "branch",
        key: "try",
        label: "try",
        ...locFromNode(file, node),
        children: tryBlock
          ? collectStatements(file, statementsOf(tryBlock), className)
          : [],
      });
      for (const clause of namedChildren(node)) {
        if (clause.type === "catch_clause") {
          const param =
            childByType(clause, "identifier") ??
            namedChildren(clause).find((c) => c.type !== "statement_block") ??
            null;
          const text = param ? collapseWs(param.text) : "";
          const block = childByType(clause, "statement_block");
          steps.push({
            type: "branch",
            key: text ? `catch:${text}` : "catch",
            label: text ? `catch (${text})` : "catch",
            ...locFromNode(file, param ?? clause),
            children: block
              ? collectStatements(file, statementsOf(block), className)
              : [],
          });
        }
        if (clause.type === "finally_clause") {
          const block = childByType(clause, "statement_block");
          steps.push({
            type: "branch",
            key: "finally",
            label: "finally",
            ...locFromNode(file, clause),
            children: block
              ? collectStatements(file, statementsOf(block), className)
              : [],
          });
        }
      }
      return;
    }

    if (type === "switch_statement") {
      const body = childByType(node, "switch_body");
      for (const clause of body ? namedChildren(body) : []) {
        if (clause.type === "switch_case") {
          const value =
            namedChildren(clause).find(
              (c) =>
                c.type !== "statement_block" &&
                c.type !== "break_statement" &&
                c.type !== "expression_statement" &&
                c.type !== "return_statement" &&
                c.type !== "throw_statement",
            ) ?? null;
          // Prefer the first non-statement child as the case value
          const kids = namedChildren(clause);
          const caseValue =
            kids.find(
              (c) =>
                ![
                  "expression_statement",
                  "break_statement",
                  "return_statement",
                  "throw_statement",
                  "statement_block",
                  "lexical_declaration",
                  "variable_declaration",
                  "empty_statement",
                ].includes(c.type),
            ) ?? value;
          const text = caseValue ? collapseWs(caseValue.text) : "";
          const stmts = kids.filter(
            (c) =>
              c.type === "expression_statement" ||
              c.type === "return_statement" ||
              c.type === "throw_statement" ||
              c.type === "statement_block" ||
              c.type === "lexical_declaration" ||
              c.type === "variable_declaration",
          );
          steps.push({
            type: "branch",
            key: text ? `case:${text}` : "case",
            label: text ? `case ${text}` : "case",
            ...locFromNode(file, caseValue ?? clause),
            children: collectStatements(file, stmts, className),
          });
        }
        if (clause.type === "switch_default") {
          const stmts = namedChildren(clause).filter(
            (c) => c.type !== "break_statement",
          );
          steps.push({
            type: "branch",
            key: "default",
            label: "default",
            ...locFromNode(file, clause),
            children: collectStatements(file, stmts, className),
          });
        }
      }
      return;
    }

    if (type === "call_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) addCall(key, node);
      }
    } else if (type === "new_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, null);
        if (key) {
          addCall(key.startsWith("new ") ? key : `new ${key}`, node);
        }
      }
    } else if (type === "jsx_element") {
      const opening = childByType(node, "jsx_opening_element");
      const childNodes = namedChildren(node).filter(
        (c) =>
          c.type !== "jsx_opening_element" && c.type !== "jsx_closing_element",
      );
      const fromAttrs: CallStep[] = [];
      if (opening) {
        for (const attr of namedChildren(opening)) {
          if (
            attr.type === "jsx_attribute" ||
            attr.type === "jsx_expression"
          ) {
            fromAttrs.push(...collectStatements(file, [attr], className));
          }
        }
      }
      const nested = [
        ...fromAttrs,
        ...collectStatements(file, childNodes, className),
      ];
      if (opening) {
        const key = jsxCalleeKey(opening);
        if (key) {
          if (nested.length > 0) {
            steps.push({
              type: "call",
              key,
              ...locFromNode(file, opening),
              children: nested,
            });
          } else {
            addCall(key, opening);
          }
          return;
        }
      }
      for (const step of nested) steps.push(step);
      return;
    } else if (type === "jsx_self_closing_element") {
      const attrNodes = namedChildren(node).filter(
        (c) => c.type === "jsx_attribute" || c.type === "jsx_expression",
      );
      const nested = collectStatements(file, attrNodes, className);
      const key = jsxCalleeKey(node);
      if (key) {
        if (nested.length > 0) {
          steps.push({
            type: "call",
            key,
            ...locFromNode(file, node),
            children: nested,
          });
        } else {
          addCall(key, node);
        }
      } else {
        for (const step of nested) steps.push(step);
      }
      return;
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
  file: string,
  body: SyntaxNode | null,
  className: string | null,
): CallStep[] {
  if (!body) return [];
  if (body.type === "statement_block") {
    return collectStatements(file, namedChildren(body), className);
  }
  return collectStatements(file, [body], className);
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
    steps: collectStepsFromBody(file, body, className),
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
  extensions: [".js", ".mjs", ".cjs"],
  grammarPackage: "tree-sitter-javascript",
  extract: extractFromTree,
};

/** JSX (.jsx) — same grammar as JS; tree-sitter-javascript parses both. */
export const javascriptreactExtractor: LanguageExtractor = {
  id: "javascriptreact",
  extensions: [".jsx"],
  grammarPackage: "tree-sitter-javascript",
  extract: extractFromTree,
};
