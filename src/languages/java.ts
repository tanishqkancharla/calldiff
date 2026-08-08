/**
 * Java callable extraction (tree-sitter-java).
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
  const mods = childByType(node, "modifiers");
  if (!mods) return false;
  return /\bprivate\b/.test(mods.text);
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "formal_parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "formal_parameter" || p.type === "spread_parameter") {
      const id = childByType(p, "identifier");
      names.push(id?.text ?? "_");
    }
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

/**
 * method_invocation children shapes:
 *   foo()           → identifier, argument_list
 *   obj.bar()       → identifier/this, identifier, argument_list
 *   Super.qux()     → identifier, identifier, argument_list
 *   a.b.c()         → field_access, identifier, argument_list
 */
function methodInvocationKey(
  node: SyntaxNode,
  className: string | null,
): string | null {
  const kids = namedChildren(node).filter((c) => c.type !== "argument_list");
  if (kids.length === 0) return null;

  if (kids.length === 1) {
    // bare foo()
    return kids[0]!.type === "identifier" ? kids[0]!.text : null;
  }

  // receiver + method name
  const method = kids[kids.length - 1]!;
  const receiver = kids[0]!;
  if (method.type !== "identifier") return null;
  const prop = method.text;

  if (receiver.type === "this" && className) {
    return `${className}.${prop}`;
  }
  if (receiver.type === "identifier") {
    return `${receiver.text}.${prop}`;
  }
  if (receiver.type === "field_access") {
    // a.b.c() → keep last segment as object name heuristic
    const lastId =
      namedChildren(receiver).filter((c) => c.type === "identifier").at(-1) ??
      null;
    if (lastId) return `${lastId.text}.${prop}`;
  }
  if (className) return `${className}.${prop}`;
  return prop;
}

function statementsOf(node: SyntaxNode): SyntaxNode[] {
  if (node.type === "block" || node.type === "constructor_body") {
    return namedChildren(node);
  }
  return [node];
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
      node.type === "class_declaration" ||
      node.type === "lambda_expression"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      // CST: if_statement → parenthesized_expression, block, [block] (else has no else_clause wrapper)
      const kids = namedChildren(node);
      const cond =
        childByType(node, "parenthesized_expression") ??
        kids.find((c) => c.type !== "block") ??
        null;
      const blocks = kids.filter((c) => c.type === "block");
      // consequent may also be a non-block statement
      const consequent =
        blocks[0] ??
        kids.find(
          (c) => c.type !== "parenthesized_expression" && c !== cond,
        ) ??
        null;
      const alternate = blocks[1] ?? null;
      const condInner =
        cond?.type === "parenthesized_expression"
          ? (cond.namedChild(0) ?? cond)
          : cond;
      const condText = condInner ? collapseWs(condInner.text) : "";

      steps.push({
        type: "branch",
        key: condText ? `if:${condText}` : "if",
        label: condText ? `if (${condText})` : "if",
        children: consequent
          ? collectStatements(statementsOf(consequent), className)
          : [],
      });

      if (alternate) {
        // else-if: alternate block might actually be... no, else if is nested if_statement as alternate
        // When `else if`, the third named child is another if_statement, not a block
        steps.push({
          type: "branch",
          key: "else",
          label: "else",
          children: collectStatements(statementsOf(alternate), className),
        });
      } else {
        // Look for else-if: a trailing if_statement child
        const elseIf = kids.find((c) => c.type === "if_statement");
        if (elseIf) {
          // Flatten: treat nested if as else-if / else chain
          const nested = collectStatements([elseIf], className);
          for (const step of nested) {
            if (step.type === "branch" && step.key.startsWith("if:")) {
              steps.push({
                ...step,
                key: step.key.replace(/^if:/, "else-if:"),
                label: step.label.replace(/^if /, "else if "),
              });
            } else {
              steps.push(step);
            }
          }
        }
      }
      return;
    }

    if (node.type === "method_invocation") {
      const key = methodInvocationKey(node, className);
      if (key) addCall(key, node.startIndex);
    } else if (node.type === "object_creation_expression") {
      const typeId =
        childByType(node, "type_identifier") ??
        childByType(node, "generic_type");
      const name =
        typeId?.type === "type_identifier"
          ? typeId.text
          : childByType(typeId ?? node, "type_identifier")?.text;
      if (name) addCall(`new ${name}`, node.startIndex);
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
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  const params = childByType(node, "formal_parameters");
  const body = childByType(node, "block");
  const key = `${className}.${name}`;
  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(statementsOf(body), className) : [],
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
  const params = childByType(node, "formal_parameters");
  const body = childByType(node, "constructor_body");
  const info: FunctionInfo = {
    key: `${className}.constructor`,
    label: `new ${className}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(statementsOf(body), className) : [],
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
  const body = childByType(node, "class_body");
  if (!body) return;

  for (const element of namedChildren(body)) {
    if (element.type === "method_declaration") {
      handleMethod(file, element, className, functions);
    } else if (element.type === "constructor_declaration") {
      handleConstructor(file, element, className, functions);
    } else if (element.type === "class_declaration") {
      handleClass(file, element, functions);
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
    if (stmt.type === "class_declaration") {
      handleClass(file, stmt, functions);
    }
    // Skip package/import; top-level methods don't exist in Java
  }
  return functions;
}

export const javaExtractor: LanguageExtractor = {
  id: "java",
  extensions: [".java"],
  grammarPackage: "tree-sitter-java",
  extract: extractFromTree,
};
