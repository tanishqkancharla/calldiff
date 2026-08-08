/**
 * Bash callable extraction (tree-sitter-bash).
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

const SKIP_COMMANDS = new Set([
  ":",
  "true",
  "false",
  "echo",
  "printf",
  "local",
  "export",
  "readonly",
  "return",
  "exit",
  "shift",
  "set",
  "unset",
  "cd",
  "pwd",
  "test",
  "[",
  "[[",
  "source",
  ".",
  "eval",
  "exec",
  "command",
  "builtin",
  "type",
  "hash",
  "wait",
  "trap",
  "read",
  "mapfile",
  "declare",
  "typeset",
]);

function commandName(cmd: SyntaxNode): string | null {
  const nameNode =
    childByType(cmd, "command_name") ?? namedChildren(cmd)[0] ?? null;
  if (!nameNode) return null;
  const word =
    nameNode.type === "word"
      ? nameNode
      : childByType(nameNode, "word") ?? nameNode.namedChild(0);
  const text = (word ?? nameNode).text;
  if (!text || SKIP_COMMANDS.has(text)) return null;
  // Dynamic: "$cmd" / "${cmd}" / $(...) as name
  if (text.startsWith("$") || nameNode.type === "command_substitution") {
    return null;
  }
  return text;
}

function collectStatements(statements: SyntaxNode[]): CallStep[] {
  const steps: CallStep[] = [];
  const seen = new Set<string>();

  const addCall = (key: string, start: number) => {
    const mark = `${key}:${start}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    steps.push({ type: "call", key });
  };

  const walk = (node: SyntaxNode): void => {
    // Nested function bodies are not attributed to the outer function
    if (node.type === "function_definition") return;

    if (node.type === "if_statement") {
      const kids = namedChildren(node);
      const cond =
        kids.find(
          (c) =>
            c.type === "test_command" ||
            c.type === "condition" ||
            c.type === "command" ||
            c.type === "list" ||
            c.type === "parenthesized_expression" ||
            c.type === "unary_expression" ||
            c.type === "binary_expression" ||
            c.type === "negated_command" ||
            c.type === "subscript" ||
            c.type === "variable_name" ||
            c.type === "string" ||
            c.type === "word",
        ) ?? kids[0] ?? null;
      // Prefer test_command text
      const test = childByType(node, "test_command") ?? cond;
      const condText = test ? collapseWs(test.text) : "";
      // Consequent: statements before else/elif clauses
      const elseClause = childByType(node, "else_clause");
      const elifClauses = namedChildren(node).filter(
        (c) => c.type === "elif_clause",
      );
      const consequent = kids.filter(
        (c) =>
          c !== test &&
          c.type !== "else_clause" &&
          c.type !== "elif_clause" &&
          c.type !== "test_command",
      );
      // If first kid is the condition already captured as test, drop it from consequent
      const thenStmts = consequent.filter((c) => c !== cond);

      steps.push({
        type: "branch",
        key: condText ? `if:${condText}` : "if",
        label: condText ? `if ${condText}` : "if",
        children: collectStatements(thenStmts),
      });

      for (const clause of elifClauses) {
        const elifKids = namedChildren(clause);
        const elifTest =
          childByType(clause, "test_command") ?? elifKids[0] ?? null;
        const text = elifTest ? collapseWs(elifTest.text) : "";
        const body = elifKids.filter((c) => c !== elifTest);
        steps.push({
          type: "branch",
          key: text ? `else-if:${text}` : "else-if",
          label: text ? `elif ${text}` : "elif",
          children: collectStatements(body),
        });
      }

      if (elseClause) {
        steps.push({
          type: "branch",
          key: "else",
          label: "else",
          children: collectStatements(namedChildren(elseClause)),
        });
      }
      return;
    }

    if (node.type === "case_statement") {
      for (const item of namedChildren(node)) {
        if (item.type !== "case_item") continue;
        const kids = namedChildren(item);
        const pattern =
          kids.find(
            (c) =>
              c.type === "word" ||
              c.type === "string" ||
              c.type === "raw_string" ||
              c.type === "extglob_pattern" ||
              c.type === "concatenation" ||
              c.type === "ansi_c_string",
          ) ?? kids[0] ?? null;
        const text = pattern ? collapseWs(pattern.text) : "";
        const body = kids.filter((c) => c !== pattern);
        steps.push({
          type: "branch",
          key: text ? `case:${text}` : "case",
          label: text ? `case ${text}` : "case",
          children: collectStatements(body),
        });
      }
      return;
    }

    if (node.type === "command") {
      const name = commandName(node);
      if (name) addCall(name, node.startIndex);
      // Walk args / substitutions (including when the name itself is $(...))
      for (const child of namedChildren(node)) {
        if (name && child.type === "command_name") continue;
        walk(child);
      }
      return;
    }

    if (node.type === "command_substitution") {
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
  functions: FunctionInfo[],
) {
  const name =
    childByType(node, "word")?.text ??
    namedChildren(node).find((c) => c.type === "word")?.text ??
    null;
  if (!name) return;
  const body =
    childByType(node, "compound_statement") ??
    childByType(node, "subshell") ??
    childByType(node, "test_command") ??
    null;
  const stmts = body ? namedChildren(body) : [];
  functions.push({
    key: name,
    label: `${name}()`,
    file,
    steps: collectStatements(stmts),
    exported: true,
    start: node.startIndex,
    end: node.endIndex,
  });
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
    }
  }
  return functions;
}

export const bashExtractor: LanguageExtractor = {
  id: "bash",
  extensions: [".sh", ".bash"],
  grammarPackage: "tree-sitter-bash",
  extract: extractFromTree,
};
