/**
 * Python callable extraction (tree-sitter-python) — parity with the TS extractor
 * where Python has an analogue.
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

function isLikelyClassName(name: string): boolean {
  const c = name[0];
  return c !== undefined && c === c.toUpperCase() && c !== c.toLowerCase();
}

function isPrivateName(name: string): boolean {
  return name.startsWith("_") && !name.startsWith("__");
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "identifier") {
      names.push(p.text);
      continue;
    }
    if (
      p.type === "list_splat_pattern" ||
      p.type === "dictionary_splat_pattern"
    ) {
      const id = childByType(p, "identifier");
      const star = p.type === "dictionary_splat_pattern" ? "**" : "*";
      names.push(id ? `${star}${id.text}` : star);
      continue;
    }
    if (
      p.type === "default_parameter" ||
      p.type === "typed_parameter" ||
      p.type === "typed_default_parameter"
    ) {
      const id = childByType(p, "identifier");
      names.push(id?.text ?? "_");
      continue;
    }
    if (p.type === "keyword_separator" || p.type === "positional_separator") {
      continue;
    }
    names.push("_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, className: string | null): string | null {
  if (node.type === "identifier") {
    // ClassName() → constructor alias used by __init__ indexing
    if (isLikelyClassName(node.text)) return `new ${node.text}`;
    return node.text;
  }

  if (node.type === "attribute") {
    const object = node.namedChild(0);
    const attr = node.namedChild(1);
    if (!object || !attr) return null;
    const prop = attr.text;

    // super().method() → Class.method (same compromise as TS super.)
    if (
      object.type === "call" &&
      object.namedChild(0)?.type === "identifier" &&
      object.namedChild(0)?.text === "super" &&
      className
    ) {
      return `${className}.${prop}`;
    }

    if (object.type === "identifier") {
      if ((object.text === "self" || object.text === "cls") && className) {
        return `${className}.${prop}`;
      }
      return `${object.text}.${prop}`;
    }
    if (className) return `${className}.${prop}`;
    return prop;
  }

  // obj[key]() — ignore computed
  if (node.type === "subscript") return null;

  return null;
}

function collectBlock(
  file: string,
  block: SyntaxNode | null,
  className: string | null,
): CallStep[] {
  if (!block) return [];
  return collectStatements(file, namedChildren(block), className);
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
    // Nested defs / lambdas: do not attribute their bodies to the outer fn
    if (
      node.type === "function_definition" ||
      node.type === "class_definition" ||
      node.type === "lambda" ||
      node.type === "decorated_definition"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      const condNode =
        namedChildren(node).find(
          (c) =>
            c.type !== "block" &&
            c.type !== "else_clause" &&
            c.type !== "elif_clause",
        ) ?? null;
      const cond = condNode ? collapseWs(condNode.text) : "";
      steps.push({
        type: "branch",
        key: cond ? `if:${cond}` : "if",
        label: cond ? `if ${cond}` : "if",
        ...locFromNode(file, condNode ?? node),
        children: collectBlock(file, childByType(node, "block"), className),
      });

      for (const clause of namedChildren(node)) {
        if (clause.type === "elif_clause") {
          const elifCond =
            namedChildren(clause).find((c) => c.type !== "block") ?? null;
          const text = elifCond ? collapseWs(elifCond.text) : "";
          steps.push({
            type: "branch",
            key: text ? `else-if:${text}` : "else-if",
            label: text ? `elif ${text}` : "elif",
            ...locFromNode(file, elifCond ?? clause),
            children: collectBlock(file, childByType(clause, "block"), className),
          });
        }
        if (clause.type === "else_clause") {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            ...locFromNode(file, clause),
            children: collectBlock(file, childByType(clause, "block"), className),
          });
        }
      }
      return;
    }

    if (node.type === "match_statement") {
      const subject =
        namedChildren(node).find((c) => c.type !== "block") ?? null;
      const subjectText = subject ? collapseWs(subject.text) : "";
      const block = childByType(node, "block");
      for (const clause of block ? namedChildren(block) : []) {
        if (clause.type !== "case_clause") continue;
        const pattern =
          namedChildren(clause).find((c) => c.type !== "block") ?? null;
        const text = pattern ? collapseWs(pattern.text) : "";
        const label = text
          ? `case ${text}`
          : subjectText
            ? `case ${subjectText}`
            : "case";
        steps.push({
          type: "branch",
          key: text ? `case:${text}` : "case",
          label,
          ...locFromNode(file, pattern ?? clause),
          children: collectBlock(file, childByType(clause, "block"), className),
        });
      }
      return;
    }

    if (node.type === "try_statement") {
      const tryBlock = childByType(node, "block");
      steps.push({
        type: "branch",
        key: "try",
        label: "try",
        ...locFromNode(file, node),
        children: collectBlock(file, tryBlock, className),
      });
      for (const clause of namedChildren(node)) {
        if (clause.type === "except_clause") {
          const handlerType =
            namedChildren(clause).find(
              (c) => c.type !== "block" && c.type !== "as_pattern",
            ) ?? null;
          const text = handlerType ? collapseWs(handlerType.text) : "";
          steps.push({
            type: "branch",
            key: text ? `except:${text}` : "except",
            label: text ? `except ${text}` : "except",
            ...locFromNode(file, handlerType ?? clause),
            children: collectBlock(file, childByType(clause, "block"), className),
          });
        }
        if (clause.type === "else_clause") {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            ...locFromNode(file, clause),
            children: collectBlock(file, childByType(clause, "block"), className),
          });
        }
        if (clause.type === "finally_clause") {
          steps.push({
            type: "branch",
            key: "finally",
            label: "finally",
            ...locFromNode(file, clause),
            children: collectBlock(file, childByType(clause, "block"), className),
          });
        }
      }
      return;
    }

    if (node.type === "call") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) addCall(key, node);
      }
      // Still walk arguments for nested calls, but not into nested lambdas
      for (const child of namedChildren(node).slice(1)) walk(child);
      return;
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function pushFunction(
  file: string,
  node: SyntaxNode,
  name: string,
  exported: boolean,
  className: string | null,
  params: SyntaxNode | null,
  body: SyntaxNode | null,
  functions: FunctionInfo[],
) {
  const isInit = className !== null && name === "__init__";
  const key = className
    ? isInit
      ? `${className}.__init__`
      : `${className}.${name}`
    : name;
  const label = isInit ? `${className}()` : key;
  const info: FunctionInfo = {
    key,
    label: `${label}${getParamsLabel(params)}`,
    file,
    steps:
      body && body.type === "block"
        ? collectBlock(file, body, className)
        : body
          ? collectStatements(file, [body], className)
          : [],
    exported,
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);

  if (isInit && className) {
    functions.push({
      ...info,
      key: `new ${className}`,
      label: `${className}()`,
    });
  }
}

function handleFunctionDefinition(
  file: string,
  node: SyntaxNode,
  exported: boolean,
  className: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  // Skip most dunders; keep __init__ and __call__
  if (
    name.startsWith("__") &&
    name.endsWith("__") &&
    name !== "__init__" &&
    name !== "__call__"
  ) {
    return;
  }

  const params = childByType(node, "parameters");
  const body = childByType(node, "block");
  const methodExported =
    className !== null ? exported && !isPrivateName(name) : exported && !isPrivateName(name);

  pushFunction(
    file,
    node,
    name,
    methodExported,
    className,
    params,
    body,
    functions,
  );
}

function handleLambdaAssignment(
  file: string,
  assignment: SyntaxNode,
  exported: boolean,
  className: string | null,
  functions: FunctionInfo[],
) {
  const id = childByType(assignment, "identifier");
  const lambda = childByType(assignment, "lambda");
  if (!id || !lambda) return;
  if (isPrivateName(id.text) && className === null) {
    // still index, but not exported
  }
  const params = childByType(lambda, "lambda_parameters");
  // lambda body is last named child that isn't params
  const body =
    namedChildren(lambda).find((c) => c.type !== "lambda_parameters") ?? null;
  pushFunction(
    file,
    lambda,
    id.text,
    exported && !isPrivateName(id.text),
    className,
    params,
    body,
    functions,
  );
}

function hasPropertyDecorator(decorated: SyntaxNode): boolean {
  for (const child of namedChildren(decorated)) {
    if (child.type !== "decorator") continue;
    const id =
      childByType(child, "identifier") ??
      childByType(childByType(child, "attribute") ?? child, "identifier");
    // @property or @x.property / @foo.setter — treat name "property" / "setter" / "getter"
    if (child.text.includes("property") || child.text.includes("setter")) {
      return true;
    }
    void id;
  }
  return false;
}

function handleClass(
  file: string,
  node: SyntaxNode,
  exported: boolean,
  functions: FunctionInfo[],
) {
  const className = childByType(node, "identifier")?.text ?? null;
  if (!className) return;
  const body = childByType(node, "block");
  if (!body) return;

  for (const stmt of namedChildren(body)) {
    if (stmt.type === "decorated_definition") {
      const fn = childByType(stmt, "function_definition");
      if (fn) {
        // @property methods are still indexed (like TS getters)
        void hasPropertyDecorator(stmt);
        handleFunctionDefinition(
          file,
          fn,
          exported && !isPrivateName(className),
          className,
          functions,
        );
      }
      continue;
    }
    if (stmt.type === "function_definition") {
      handleFunctionDefinition(
        file,
        stmt,
        exported && !isPrivateName(className),
        className,
        functions,
      );
      continue;
    }
    if (stmt.type === "expression_statement") {
      const assignment = childByType(stmt, "assignment");
      if (assignment) {
        handleLambdaAssignment(
          file,
          assignment,
          exported && !isPrivateName(className),
          className,
          functions,
        );
      }
    }
  }
}

function visitModule(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  if (node.type === "decorated_definition") {
    const inner =
      childByType(node, "function_definition") ??
      childByType(node, "class_definition");
    if (inner?.type === "function_definition") {
      const name = childByType(inner, "identifier")?.text ?? "";
      handleFunctionDefinition(
        file,
        inner,
        !isPrivateName(name),
        null,
        functions,
      );
    } else if (inner?.type === "class_definition") {
      const name = childByType(inner, "identifier")?.text ?? "";
      handleClass(file, inner, !isPrivateName(name), functions);
    }
    return;
  }

  if (node.type === "function_definition") {
    const name = childByType(node, "identifier")?.text ?? "";
    handleFunctionDefinition(file, node, !isPrivateName(name), null, functions);
    return;
  }

  if (node.type === "class_definition") {
    const name = childByType(node, "identifier")?.text ?? "";
    handleClass(file, node, !isPrivateName(name), functions);
    return;
  }

  if (node.type === "expression_statement") {
    const assignment = childByType(node, "assignment");
    if (assignment) {
      const id = childByType(assignment, "identifier");
      handleLambdaAssignment(
        file,
        assignment,
        id ? !isPrivateName(id.text) : true,
        null,
        functions,
      );
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
    visitModule(file, stmt, functions);
  }
  return functions;
}

export const pythonExtractor: LanguageExtractor = {
  id: "python",
  extensions: [".py"],
  grammarPackage: "tree-sitter-python",
  extract: extractFromTree,
};
