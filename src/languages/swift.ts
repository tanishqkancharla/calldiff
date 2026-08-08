/**
 * Swift callable extraction (tree-sitter-swift).
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
  return /\bprivate\b|\bfileprivate\b/.test(mods.text);
}

function isLikelyTypeName(name: string): boolean {
  const c = name[0];
  return c !== undefined && c === c.toUpperCase() && c !== c.toLowerCase();
}

function getParamsLabel(node: SyntaxNode): string {
  const params = namedChildren(node).filter((c) => c.type === "parameter");
  if (params.length === 0) return "()";
  const names: string[] = [];
  for (const p of params) {
    // Prefer external/local simple_identifier; last id is usually the local name
    const ids = namedChildren(p).filter((c) => c.type === "simple_identifier");
    names.push(ids.at(-1)?.text ?? "_");
  }
  return `(${names.join(", ")})`;
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

    if (object.type === "self_expression" && className) {
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
  if (body.type === "function_body") {
    const stmts = childByType(body, "statements");
    return stmts ? namedChildren(stmts) : [];
  }
  if (body.type === "statements") return namedChildren(body);
  return [body];
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

  const pushIfChain = (node: SyntaxNode, asElseIf: boolean): void => {
    const kids = namedChildren(node);
    const stmtBlocks = kids.filter((c) => c.type === "statements");
    const nestedIf = kids.find((c) => c.type === "if_statement") ?? null;
    const cond =
      kids.find(
        (c) =>
          c.type !== "statements" &&
          c.type !== "else" &&
          c.type !== "if_statement",
      ) ?? null;
    const condText = cond ? collapseWs(cond.text) : "";
    const kind = asElseIf ? "else-if" : "if";
    const labelKind = asElseIf ? "else if" : "if";

    steps.push({
      type: "branch",
      key: condText ? `${kind}:${condText}` : kind,
      label: condText ? `${labelKind} ${condText}` : labelKind,
      children: collectStatements(
        statementsOf(stmtBlocks[0] ?? null),
        className,
      ),
    });

    if (nestedIf) {
      pushIfChain(nestedIf, true);
      return;
    }

    if (stmtBlocks[1]) {
      steps.push({
        type: "branch",
        key: "else",
        label: "else",
        children: collectStatements(statementsOf(stmtBlocks[1]), className),
      });
    }
  };

  const walk = (node: SyntaxNode): void => {
    if (
      node.type === "function_declaration" ||
      node.type === "init_declaration" ||
      node.type === "class_declaration" ||
      node.type === "lambda_literal"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      pushIfChain(node, false);
      return;
    }

    if (node.type === "do_statement") {
      const doBody = childByType(node, "statements");
      steps.push({
        type: "branch",
        key: "do",
        label: "do",
        children: doBody
          ? collectStatements(namedChildren(doBody), className)
          : [],
      });
      for (const clause of namedChildren(node)) {
        if (clause.type === "catch_block") {
          const body = childByType(clause, "statements");
          steps.push({
            type: "branch",
            key: "catch",
            label: "catch",
            children: body
              ? collectStatements(namedChildren(body), className)
              : [],
          });
        }
      }
      return;
    }

    if (node.type === "switch_statement") {
      for (const entry of namedChildren(node)) {
        if (entry.type !== "switch_entry") continue;
        const pattern = childByType(entry, "switch_pattern");
        const isDefault = namedChildren(entry).some(
          (c) => c.type === "default_keyword",
        );
        const body = childByType(entry, "statements");
        if (isDefault || !pattern) {
          steps.push({
            type: "branch",
            key: "default",
            label: "default",
            children: body
              ? collectStatements(namedChildren(body), className)
              : [],
          });
        } else {
          const text = collapseWs(pattern.text);
          steps.push({
            type: "branch",
            key: text ? `case:${text}` : "case",
            label: text ? `case ${text}` : "case",
            children: body
              ? collectStatements(namedChildren(body), className)
              : [],
          });
        }
      }
      return;
    }

    if (node.type === "call_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, className);
        if (key) addCall(key, node.startIndex);
      }
      for (const child of namedChildren(node).slice(1)) walk(child);
      return;
    }

    // Unwrap try openIt() → still see the call
    if (node.type === "try_expression") {
      for (const child of namedChildren(node)) walk(child);
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
  const body = childByType(node, "function_body");
  const key = className ? `${className}.${name}` : name;
  functions.push({
    key,
    label: `${key}${getParamsLabel(node)}`,
    file,
    steps: collectStatements(statementsOf(body), className),
    exported: !isPrivate(node),
    start: node.startIndex,
    end: node.endIndex,
  });
}

function handleInit(
  file: string,
  node: SyntaxNode,
  className: string,
  functions: FunctionInfo[],
) {
  const body = childByType(node, "function_body");
  const info: FunctionInfo = {
    key: `${className}.init`,
    label: `${className}${getParamsLabel(node)}`,
    file,
    steps: collectStatements(statementsOf(body), className),
    exported: !isPrivate(node),
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
    } else if (element.type === "init_declaration") {
      handleInit(file, element, className, functions);
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
    if (stmt.type === "function_declaration") {
      handleFunction(file, stmt, null, functions);
    } else if (stmt.type === "class_declaration") {
      handleClass(file, stmt, functions);
    }
  }
  return functions;
}

export const swiftExtractor: LanguageExtractor = {
  id: "swift",
  extensions: [".swift"],
  grammarPackage: "tree-sitter-swift",
  extract: extractFromTree,
};
