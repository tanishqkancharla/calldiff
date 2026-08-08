/**
 * Prototype: tree-sitter-based extractor (same FunctionInfo contract as oxc extract.ts).
 * Used to measure parity against existing tests.
 */
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import type { CallStep, FunctionInfo } from "./types.js";

type SyntaxNode = Parser.SyntaxNode;

const parser = new Parser();

function languageForFile(file: string): any {
  if (/\.tsx$/i.test(file)) return TypeScript.tsx;
  return TypeScript.typescript;
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function namedChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) out.push(child);
  }
  return out;
}

function childByType(node: SyntaxNode, type: string): SyntaxNode | null {
  return namedChildren(node).find((c) => c.type === type) ?? null;
}

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
  if (!params || params.type !== "formal_parameters") return "()";
  const parts: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "required_parameter" || p.type === "optional_parameter") {
      const rest = childByType(p, "rest_pattern");
      if (rest) {
        const id = childByType(rest, "identifier");
        parts.push(id ? `...${id.text}` : "...");
        continue;
      }
      const id = childByType(p, "identifier");
      if (id) {
        parts.push(id.text);
        continue;
      }
      if (childByType(p, "object_pattern")) {
        parts.push("{}");
        continue;
      }
      if (childByType(p, "array_pattern")) {
        parts.push("[]");
        continue;
      }
      parts.push("_");
      continue;
    }
    if (p.type === "rest_parameter" || p.type === "rest_pattern") {
      const id = childByType(p, "identifier");
      parts.push(id ? `...${id.text}` : "...");
      continue;
    }
    parts.push("_");
  }
  return parts.length === 0 ? "()" : `(${parts.join(", ")})`;
}

function condText(test: SyntaxNode): string {
  // tree-sitter wraps if-tests in parenthesized_expression including parens
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

  if (node.type === "member_expression" || node.type === "subscript_expression") {
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
      // Nested functions: do not attribute their bodies to the outer function
      return;
    }

    if (type === "if_statement") {
      const test =
        childByType(node, "parenthesized_expression") ??
        namedChildren(node).find((c) => c.type !== "else_clause") ??
        null;
      // consequent is the statement after the test (statement_block or other)
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
  // arrow expression body
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
  const paramsLabel = getParamsLabel(params);
  return {
    key,
    label: `${label}${paramsLabel}`,
    file,
    steps: collectStepsFromBody(body, className),
    exported,
    start,
    end,
  };
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
  const params = childByType(node, "formal_parameters");
  const body =
    childByType(node, "statement_block") ??
    // arrow with expression body: last named child that isn't params/type
    namedChildren(node).find(
      (c) =>
        c.type !== "formal_parameters" &&
        c.type !== "type_parameters" &&
        c.type !== "type_annotation" &&
        c.type !== "identifier" &&
        c.type !== "accessibility_modifier" &&
        c.type !== "async" &&
        c.type !== "readonly",
    ) ??
    null;

  functions.push(
    functionFromParts(
      file,
      key,
      key,
      params,
      body,
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
  const nameNode =
    childByType(node, "type_identifier") ?? childByType(node, "identifier");
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
      let methodName = keyNode?.text ?? null;
      const isConstructor = methodName === "constructor";
      if (!methodName) continue;

      const accessibility = childByType(element, "accessibility_modifier");
      const isPublic =
        exported || accessibility?.text === "public" || !accessibility;

      // Match oxc: exported || accessibility === "public"
      // oxc only treats explicit "public" as extra; private/protected stay non-exported
      // unless the class itself is exported... Looking at oxc again:
      // `exported || element.accessibility === "public"`
      // So if class is exported, ALL methods are marked exported.
      // If class not exported, only methods with accessibility === "public".
      // Methods with no accessibility: exported is just the class exported flag.
      const methodExported =
        exported || accessibility?.text === "public";

      const params = childByType(element, "formal_parameters");
      const fnBody = childByType(element, "statement_block");
      const key = isConstructor
        ? `${className}.constructor`
        : `${className}.${methodName}`;
      const label = isConstructor ? `new ${className}()` : key;

      void isPublic; // silence — oxc semantics use methodExported only
      functions.push(
        functionFromParts(
          file,
          key,
          label,
          params,
          fnBody,
          methodExported,
          element.startIndex,
          element.endIndex,
          className,
        ),
      );
    }

    if (element.type === "public_field_definition") {
      const keyNode = childByType(element, "property_identifier");
      const value =
        childByType(element, "arrow_function") ??
        childByType(element, "function_expression");
      if (keyNode && value) {
        const methodName = keyNode.text;
        const key = `${className}.${methodName}`;
        handleFunctionNode(file, value, methodName, exported, className, functions);
        // handleFunctionNode uses value's span; fix key already set via name
        void key;
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
    // export … / export default …
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
      handleFunctionNode(file, decl, isDefault ? "default" : null, true, null, functions);
      return;
    }
    if (
      decl.type === "class_declaration" ||
      decl.type === "abstract_class_declaration" ||
      decl.type === "class"
    ) {
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

  if (
    node.type === "class_declaration" ||
    node.type === "abstract_class_declaration"
  ) {
    handleClass(file, node, exported, functions);
    return;
  }

  if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
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

export function extractFunctions(
  file: string,
  source: string,
): FunctionInfo[] {
  parser.setLanguage(languageForFile(file));
  const tree = parser.parse(source);
  const functions: FunctionInfo[] = [];
  for (const stmt of namedChildren(tree.rootNode)) {
    visitStatement(file, stmt, false, functions);
  }
  return functions;
}

export type FunctionIndex = Map<string, FunctionInfo>;

export function flattenCallKeys(steps: CallStep[]): string[] {
  const keys: string[] = [];
  const walk = (list: CallStep[]) => {
    for (const step of list) {
      if (step.type === "call") keys.push(step.key);
      else walk(step.children);
    }
  };
  walk(steps);
  return keys;
}

export function buildIndex(functions: FunctionInfo[]): FunctionIndex {
  const index: FunctionIndex = new Map();
  for (const fn of functions) {
    if (!index.has(fn.key)) {
      index.set(fn.key, fn);
    }
    if (fn.key.endsWith(".constructor")) {
      const className = fn.key.slice(0, -".constructor".length);
      const newKey = `new ${className}`;
      if (!index.has(newKey)) {
        index.set(newKey, { ...fn, key: newKey, label: `new ${className}()` });
      }
    }
  }
  return index;
}
