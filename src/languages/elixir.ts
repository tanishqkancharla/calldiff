/**
 * Elixir callable extraction (tree-sitter-elixir).
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

function isDefKw(name: string): boolean {
  return name === "def" || name === "defp" || name === "defmacro" || name === "defmacrop";
}

function isPrivateDef(name: string): boolean {
  return name === "defp" || name === "defmacrop";
}

function getParamsLabel(args: SyntaxNode | null): string {
  if (!args) return "()";
  // def foo(a, b) → arguments node under the name call
  const names: string[] = [];
  for (const c of namedChildren(args)) {
    if (c.type === "identifier") names.push(c.text);
    else if (c.type === "keywords") continue;
    else names.push("_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

/** Extract def name + params from `def`/`defp` call arguments. */
function defNameAndParams(
  args: SyntaxNode | null,
): { name: string; params: SyntaxNode | null } | null {
  if (!args) return null;
  const kids = namedChildren(args);
  const head = kids[0] ?? null;
  if (!head) return null;
  if (head.type === "identifier") {
    return { name: head.text, params: null };
  }
  if (head.type === "call") {
    const id = childByType(head, "identifier");
    if (!id) return null;
    return { name: id.text, params: childByType(head, "arguments") };
  }
  // def foo(%{}), do: ... — pattern head
  if (head.type === "binary_operator") {
    const left = head.namedChild(0);
    if (left?.type === "identifier") return { name: left.text, params: null };
    if (left?.type === "call") {
      const id = childByType(left, "identifier");
      if (id) return { name: id.text, params: childByType(left, "arguments") };
    }
  }
  return null;
}

function calleeKey(
  node: SyntaxNode,
  moduleName: string | null,
  hasExplicitArgs: boolean,
): string | null {
  if (node.type === "identifier") {
    // Bare call inside a module → Module.fun (local call)
    if (moduleName) return `${moduleName}.${node.text}`;
    return node.text;
  }
  if (node.type === "dot") {
    const left = node.namedChild(0);
    const right = node.namedChild(1);
    if (!right) return null;
    const prop = right.text;
    if (!left) return prop;
    if (left.type === "alias") {
      // Foo.Bar.baz → use full alias text
      return `${left.text}.${prop}`;
    }
    if (left.type === "identifier") {
      // options.session_id with no args is field-ish remote call noise — skip
      if (!hasExplicitArgs && left.text[0] && left.text[0] === left.text[0].toLowerCase()) {
        return null;
      }
      return `${left.text}.${prop}`;
    }
    // get_services().boot() — left is call; keep receiver.prop when possible
    if (left.type === "call") {
      return prop;
    }
    if (moduleName) return `${moduleName}.${prop}`;
    return prop;
  }
  // access_call opts[:ok] — not a callable we track
  if (node.type === "access_call") return null;
  return null;
}

function bodyOfDef(call: SyntaxNode): SyntaxNode | null {
  const doBlock = childByType(call, "do_block");
  if (doBlock) return doBlock;
  // def foo, do: expr  → keywords pair
  const args = childByType(call, "arguments");
  const keywords = args ? childByType(args, "keywords") : null;
  if (keywords) {
    const pair = childByType(keywords, "pair");
    if (pair) {
      // keyword + value; value is last named child
      const kids = namedChildren(pair);
      return kids[kids.length - 1] ?? null;
    }
  }
  return null;
}

function collectBody(
  body: SyntaxNode | null,
  moduleName: string | null,
): CallStep[] {
  if (!body) return [];
  return collectStatements(namedChildren(body), moduleName);
}

function collectStatements(
  statements: SyntaxNode[],
  moduleName: string | null,
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
    // Nested defs / anonymous fn — do not attribute to outer
    if (node.type === "anonymous_function") return;

    if (node.type === "call") {
      const head = childByType(node, "identifier");
      if (head && (isDefKw(head.text) || head.text === "fn" || head.text === "defmodule")) {
        return;
      }
      if (head && head.text === "if") {
        const args = childByType(node, "arguments");
        const cond = args?.namedChild(0) ?? null;
        const condText = cond ? collapseWs(cond.text) : "";
        const doBlock = childByType(node, "do_block");
        const thenKids = doBlock
          ? namedChildren(doBlock).filter((c) => c.type !== "else_block")
          : [];
        const elseBlock = doBlock ? childByType(doBlock, "else_block") : null;
        steps.push({
          type: "branch",
          key: condText ? `if:${condText}` : "if",
          label: condText ? `if ${condText}` : "if",
          children: collectStatements(thenKids, moduleName),
        });
        if (elseBlock) {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            children: collectBody(elseBlock, moduleName),
          });
        }
        // cond may contain calls — walk it
        if (cond) walk(cond);
        return;
      }
      if (head && head.text === "case") {
        const doBlock = childByType(node, "do_block");
        for (const clause of doBlock ? namedChildren(doBlock) : []) {
          if (clause.type !== "stab_clause") continue;
          const pattern = childByType(clause, "arguments");
          const text = pattern ? collapseWs(pattern.text) : "";
          const body = childByType(clause, "body");
          steps.push({
            type: "branch",
            key: text ? `case:${text}` : "case",
            label: text ? `case ${text}` : "case",
            children: body ? collectBody(body, moduleName) : [],
          });
        }
        return;
      }
      if (head && head.text === "cond") {
        const doBlock = childByType(node, "do_block");
        for (const clause of doBlock ? namedChildren(doBlock) : []) {
          if (clause.type !== "stab_clause") continue;
          const pattern = childByType(clause, "arguments");
          const text = pattern ? collapseWs(pattern.text) : "";
          const body = childByType(clause, "body");
          steps.push({
            type: "branch",
            key: text ? `cond:${text}` : "cond",
            label: text ? `cond ${text}` : "cond",
            children: body ? collectBody(body, moduleName) : [],
          });
        }
        return;
      }
      if (head && head.text === "try") {
        const doBlock = childByType(node, "do_block");
        const tryKids = doBlock
          ? namedChildren(doBlock).filter(
              (c) =>
                c.type !== "rescue_block" &&
                c.type !== "catch_block" &&
                c.type !== "after_block" &&
                c.type !== "else_block",
            )
          : [];
        steps.push({
          type: "branch",
          key: "try",
          label: "try",
          children: collectStatements(tryKids, moduleName),
        });
        const rescue = doBlock ? childByType(doBlock, "rescue_block") : null;
        if (rescue) {
          for (const clause of namedChildren(rescue)) {
            if (clause.type !== "stab_clause") continue;
            const pattern = childByType(clause, "arguments");
            const text = pattern ? collapseWs(pattern.text) : "";
            const body = childByType(clause, "body");
            steps.push({
              type: "branch",
              key: text ? `rescue:${text}` : "rescue",
              label: text ? `rescue ${text}` : "rescue",
              children: body ? collectBody(body, moduleName) : [],
            });
          }
        }
        const after = doBlock ? childByType(doBlock, "after_block") : null;
        if (after) {
          steps.push({
            type: "branch",
            key: "after",
            label: "after",
            children: collectBody(after, moduleName),
          });
        }
        return;
      }

      // Regular call — callee is first named child (identifier or dot)
      const callee = node.namedChild(0);
      const args = childByType(node, "arguments");
      // Explicit args node present (even empty `()`) vs bare `foo.bar`
      const hasExplicitArgs = args !== null;
      if (callee && callee.type !== "do_block") {
        const key = calleeKey(callee, moduleName, hasExplicitArgs);
        if (key) addCall(key, node.startIndex);
      }
      // Walk args for nested calls, but skip field-ish dots without further calls
      if (args) walk(args);
      const doBlock = childByType(node, "do_block");
      if (doBlock) walk(doBlock);
      return;
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function handleDef(
  file: string,
  call: SyntaxNode,
  moduleName: string | null,
  functions: FunctionInfo[],
) {
  const kw = childByType(call, "identifier")?.text ?? "def";
  const args = childByType(call, "arguments");
  const parsed = defNameAndParams(args);
  if (!parsed) return;
  const { name, params } = parsed;
  const body = bodyOfDef(call);
  const key = moduleName ? `${moduleName}.${name}` : name;
  const exported = !isPrivateDef(kw);
  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: collectBody(body, moduleName),
    exported,
    start: call.startIndex,
    end: call.endIndex,
  });
}

function handleDefmodule(
  file: string,
  call: SyntaxNode,
  functions: FunctionInfo[],
) {
  const args = childByType(call, "arguments");
  const alias = args ? childByType(args, "alias") : null;
  const moduleName = alias?.text ?? null;
  if (!moduleName) return;
  const body = childByType(call, "do_block");
  if (!body) return;
  for (const stmt of namedChildren(body)) {
    if (stmt.type !== "call") continue;
    const kw = childByType(stmt, "identifier")?.text;
    if (kw && isDefKw(kw)) {
      handleDef(file, stmt, moduleName, functions);
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
    if (stmt.type !== "call") continue;
    const kw = childByType(stmt, "identifier")?.text;
    if (kw === "defmodule") {
      handleDefmodule(file, stmt, functions);
    } else if (kw && isDefKw(kw)) {
      handleDef(file, stmt, null, functions);
    }
  }
  return functions;
}

export const elixirExtractor: LanguageExtractor = {
  id: "elixir",
  extensions: [".ex", ".exs"],
  grammarPackage: "tree-sitter-elixir",
  extract: extractFromTree,
};
