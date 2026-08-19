/**
 * Kotlin callable extraction (tree-sitter-kotlin).
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
  const mods = childByType(node, "modifiers");
  if (!mods) return false;
  return /\bprivate\b/.test(mods.text);
}

function isLikelyTypeName(name: string): boolean {
  const c = name[0];
  return c !== undefined && c === c.toUpperCase() && c !== c.toLowerCase();
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "function_value_parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "parameter") {
      const id = childByType(p, "simple_identifier");
      names.push(id?.text ?? "_");
    }
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function navigationProp(nav: SyntaxNode): string | null {
  const suffix = childByType(nav, "navigation_suffix");
  const id = suffix ? childByType(suffix, "simple_identifier") : null;
  return id?.text ?? null;
}

function calleeKey(node: SyntaxNode, className: string | null): string | null {
  if (node.type === "simple_identifier") {
    if (isLikelyTypeName(node.text)) return `new ${node.text}`;
    return node.text;
  }

  if (node.type === "navigation_expression") {
    const object = node.namedChild(0);
    const prop = navigationProp(node);
    if (!object || !prop) return null;

    if (object.type === "this_expression" && className) {
      return `${className}.${prop}`;
    }
    if (object.type === "simple_identifier") {
      return `${object.text}.${prop}`;
    }
    if (className) return `${className}.${prop}`;
    return prop;
  }

  return null;
}

function statementsOf(body: SyntaxNode | null): SyntaxNode[] {
  if (!body) return [];
  if (body.type === "function_body" || body.type === "control_structure_body") {
    const stmts = childByType(body, "statements");
    if (stmts) return namedChildren(stmts);
    // empty `{}` body — or a bare nested if_expression
    return namedChildren(body).filter((c) => c.type !== "statements");
  }
  if (body.type === "statements") return namedChildren(body);
  return [body];
}

/**
 * Body statements of a lambda/anonymous-function argument. Kotlin higher-order
 * calls (`runBlocking { ... }`, `use { ... }`) execute these as part of the
 * enclosing call flow, so they nest as call-site children of the receiving call.
 */
function lambdaBodyStatements(lambda: SyntaxNode): SyntaxNode[] {
  if (lambda.type === "anonymous_function") {
    return statementsOf(childByType(lambda, "function_body"));
  }
  const stmts = childByType(lambda, "statements");
  return stmts ? namedChildren(stmts) : [];
}

function collectStatements(
  file: string,
  statements: SyntaxNode[],
  className: string | null,
): CallStep[] {
  const steps: CallStep[] = [];
  const seen = new Set<string>();

  const addCall = (key: string, node: SyntaxNode, children?: CallStep[]) => {
    const mark = `${key}:${node.startIndex}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    const step: CallStep = {
      type: "call",
      key,
      ...locFromNode(file, node),
    };
    if (children && children.length > 0) {
      step.children = children;
    }
    steps.push(step);
  };

  // Lambda arguments of THIS call only — lambdas under a nested call belong to it.
  const findLambdaArgs = (node: SyntaxNode, into: SyntaxNode[]): void => {
    if (node.type === "call_expression") return;
    if (node.type === "lambda_literal" || node.type === "anonymous_function") {
      into.push(node);
      return;
    }
    for (const child of namedChildren(node)) findLambdaArgs(child, into);
  };

  const pushIfChain = (node: SyntaxNode, asElseIf: boolean): void => {
    const kids = namedChildren(node);
    const bodies = kids.filter((c) => c.type === "control_structure_body");
    const cond =
      kids.find((c) => c.type !== "control_structure_body") ?? null;
    const condText = cond ? collapseWs(cond.text) : "";
    const kind = asElseIf ? "else-if" : "if";
    const labelKind = asElseIf ? "else if" : "if";

    steps.push({
      type: "branch",
      key: condText ? `${kind}:${condText}` : kind,
      label: condText ? `${labelKind} ${condText}` : labelKind,
      ...locFromNode(file, cond ?? node),
      children: collectStatements(
        file,
        statementsOf(bodies[0] ?? null),
        className,
      ),
    });

    if (!bodies[1]) return;

    const elseStmts = statementsOf(bodies[1]);
    if (elseStmts.length === 1 && elseStmts[0]!.type === "if_expression") {
      pushIfChain(elseStmts[0]!, true);
      return;
    }

    steps.push({
      type: "branch",
      key: "else",
      label: "else",
      ...locFromNode(file, bodies[1]),
      children: collectStatements(file, elseStmts, className),
    });
  };

  const walk = (node: SyntaxNode): void => {
    if (
      node.type === "function_declaration" ||
      node.type === "class_declaration" ||
      node.type === "object_declaration" ||
      node.type === "companion_object" ||
      node.type === "anonymous_function" ||
      node.type === "lambda_literal" ||
      node.type === "secondary_constructor" ||
      node.type === "anonymous_initializer"
    ) {
      return;
    }

    if (node.type === "if_expression") {
      pushIfChain(node, false);
      return;
    }

    if (node.type === "try_expression") {
      const tryStmts = childByType(node, "statements");
      steps.push({
        type: "branch",
        key: "try",
        label: "try",
        ...locFromNode(file, node),
        children: tryStmts
          ? collectStatements(file, namedChildren(tryStmts), className)
          : [],
      });
      for (const clause of namedChildren(node)) {
        if (clause.type === "catch_block") {
          const type =
            childByType(clause, "user_type") ??
            namedChildren(clause).find(
              (c) =>
                c.type !== "simple_identifier" && c.type !== "statements",
            ) ??
            null;
          const text = type ? collapseWs(type.text) : "";
          const body = childByType(clause, "statements");
          steps.push({
            type: "branch",
            key: text ? `catch:${text}` : "catch",
            label: text ? `catch ${text}` : "catch",
            ...locFromNode(file, type ?? clause),
            children: body
              ? collectStatements(file, namedChildren(body), className)
              : [],
          });
        }
        if (clause.type === "finally_block") {
          const body = childByType(clause, "statements");
          steps.push({
            type: "branch",
            key: "finally",
            label: "finally",
            ...locFromNode(file, clause),
            children: body
              ? collectStatements(file, namedChildren(body), className)
              : [],
          });
        }
      }
      return;
    }

    if (node.type === "when_expression") {
      for (const entry of namedChildren(node)) {
        if (entry.type !== "when_entry") continue;
        const cond = childByType(entry, "when_condition");
        const body = childByType(entry, "control_structure_body");
        if (cond) {
          const text = collapseWs(cond.text);
          steps.push({
            type: "branch",
            key: text ? `case:${text}` : "case",
            label: text ? `case ${text}` : "case",
            ...locFromNode(file, cond),
            children: collectStatements(file, statementsOf(body), className),
          });
        } else {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            ...locFromNode(file, entry),
            children: collectStatements(file, statementsOf(body), className),
          });
        }
      }
      return;
    }

    if (node.type === "call_expression") {
      // `f(args) { lambda }` parses as call_expression(call_expression(f, args), lambda):
      // unwrap to the innermost callee, keeping every suffix level's arguments.
      const argSubtrees: SyntaxNode[] = namedChildren(node).slice(1);
      let callee = node.namedChild(0);
      while (callee?.type === "call_expression") {
        argSubtrees.push(...namedChildren(callee).slice(1));
        callee = callee.namedChild(0);
      }
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) {
          const lambdas: SyntaxNode[] = [];
          for (const subtree of argSubtrees) findLambdaArgs(subtree, lambdas);
          const children = lambdas.flatMap((lambda) =>
            collectStatements(file, lambdaBodyStatements(lambda), className),
          );
          addCall(key, node, children);
        }
      }
      // Nested calls in arguments stay siblings; lambda bodies were claimed
      // above and `walk` still skips lambda nodes, so nothing double-counts.
      for (const subtree of argSubtrees) walk(subtree);
      return;
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function handleFunction(
  file: string,
  node: SyntaxNode,
  className: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "simple_identifier")?.text ?? null;
  if (!name) return;
  const params = childByType(node, "function_value_parameters");
  const body = childByType(node, "function_body");
  const key = className ? `${className}.${name}` : name;
  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: collectStatements(file, statementsOf(body), className),
    exported: !isPrivate(node),
    start: node.startIndex,
    end: node.endIndex,
  });
}

function handleSecondaryConstructor(
  file: string,
  node: SyntaxNode,
  className: string,
  functions: FunctionInfo[],
) {
  const params = childByType(node, "function_value_parameters");
  const stmts = childByType(node, "statements");
  const info: FunctionInfo = {
    key: `${className}.constructor`,
    label: `${className}${getParamsLabel(params)}`,
    file,
    steps: collectStatements(file, stmts ? namedChildren(stmts) : [], className),
    exported: !isPrivate(node),
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);
  functions.push({ ...info, key: `new ${className}` });
}

function handleInitBlock(
  file: string,
  node: SyntaxNode,
  className: string,
  functions: FunctionInfo[],
) {
  const stmts = childByType(node, "statements");
  const info: FunctionInfo = {
    key: `${className}.init`,
    label: `${className}()`,
    file,
    steps: collectStatements(file, stmts ? namedChildren(stmts) : [], className),
    exported: true,
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);
  functions.push({ ...info, key: `new ${className}` });
}

function handleClass(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const className = childByType(node, "type_identifier")?.text ?? null;
  if (!className) return;
  const body = childByType(node, "class_body");
  if (!body) return;

  for (const element of namedChildren(body)) {
    if (element.type === "function_declaration") {
      handleFunction(file, element, className, functions);
    } else if (element.type === "secondary_constructor") {
      handleSecondaryConstructor(file, element, className, functions);
    } else if (element.type === "anonymous_initializer") {
      handleInitBlock(file, element, className, functions);
    } else if (element.type === "class_declaration") {
      handleClass(file, element, functions);
    } else if (
      element.type === "companion_object" ||
      element.type === "object_declaration"
    ) {
      handleObjectLike(file, element, className, functions);
    }
  }
}

function handleObjectLike(
  file: string,
  node: SyntaxNode,
  parentClass: string | null,
  functions: FunctionInfo[],
) {
  // companion object methods are called as Class.method — attribute to parent
  // (or the object name for top-level `object Foo`).
  const objectName =
    childByType(node, "type_identifier")?.text ??
    childByType(node, "simple_identifier")?.text ??
    null;
  const typeName =
    node.type === "companion_object"
      ? (parentClass ?? objectName)
      : (objectName ?? parentClass);
  const body = childByType(node, "class_body");
  if (!body || !typeName) return;

  for (const element of namedChildren(body)) {
    if (element.type === "function_declaration") {
      handleFunction(file, element, typeName, functions);
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
    if (stmt.type === "function_declaration") {
      handleFunction(file, stmt, null, functions);
    } else if (stmt.type === "class_declaration") {
      handleClass(file, stmt, functions);
    } else if (stmt.type === "object_declaration") {
      handleObjectLike(file, stmt, null, functions);
    }
  }
  return functions;
}

export const kotlinExtractor: LanguageExtractor = {
  id: "kotlin",
  extensions: [".kt", ".kts"],
  grammarPackage: "tree-sitter-kotlin",
  extract: extractFromTree,
};
