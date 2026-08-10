/**
 * Zig callable extraction (@tree-sitter-grammars/tree-sitter-zig).
 * Note: legacy `tree-sitter-zig` (nan) is incompatible with tree-sitter 0.25+.
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

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type !== "parameter") continue;
    const id = childByType(p, "identifier");
    names.push(id?.text ?? "_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, typeName: string | null): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "field_expression") {
    const object = node.namedChild(0);
    const field = node.namedChild(1);
    if (!object || !field) return null;
    const prop = field.text;
    if (object.type === "identifier") {
      if ((object.text === "self" || object.text === "this") && typeName) {
        return `${typeName}.${prop}`;
      }
      return `${object.text}.${prop}`;
    }
    if (typeName) return `${typeName}.${prop}`;
    return prop;
  }
  // builtin @call etc.
  if (node.type === "builtin_type" || node.type === "builtin_function") {
    return null;
  }
  return null;
}

function statementsOf(block: SyntaxNode | null): SyntaxNode[] {
  if (!block) return [];
  if (block.type === "block" || block.type === "block_expression") {
    const inner =
      block.type === "block_expression" ? childByType(block, "block") : block;
    return inner ? namedChildren(inner) : namedChildren(block);
  }
  return [block];
}

function collectStatements(
  file: string,
  statements: SyntaxNode[],
  typeName: string | null,
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
    if (
      node.type === "function_declaration" ||
      node.type === "struct_declaration" ||
      node.type === "enum_declaration" ||
      node.type === "union_declaration" ||
      node.type === "opaque_declaration"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      const kids = namedChildren(node);
      const cond =
        kids.find(
          (c) =>
            c.type !== "block" &&
            c.type !== "block_expression" &&
            c.type !== "else_clause" &&
            c.type !== "labeled_statement",
        ) ?? null;
      const thenBlock =
        kids.find(
          (c) => c.type === "block" || c.type === "block_expression",
        ) ?? null;
      const elseClause = childByType(node, "else_clause");
      const condText = cond ? collapseWs(cond.text) : "";
      steps.push({
        type: "branch",
        key: condText ? `if:${condText}` : "if",
        label: condText ? `if ${condText}` : "if",
        ...locFromNode(file, cond ?? node),
        children: collectStatements(file, statementsOf(thenBlock), typeName),
      });
      if (elseClause) {
        // else_clause → block | labeled_statement → block | if_statement
        const elseBody =
          childByType(elseClause, "block") ??
          childByType(elseClause, "block_expression") ??
          childByType(elseClause, "if_statement") ??
          childByType(elseClause, "labeled_statement") ??
          elseClause.namedChild(0) ??
          null;
        if (elseBody?.type === "if_statement") {
          // else if — flatten by walking as nested if into else-if style
          const nested = collectStatements(file, [elseBody], typeName);
          for (const s of nested) {
            if (s.type === "branch" && s.key.startsWith("if:")) {
              steps.push({
                ...s,
                key: s.key.replace(/^if:/, "else-if:"),
                label: s.label.replace(/^if /, "else if "),
              });
            } else if (s.type === "branch" && s.key === "if") {
              steps.push({ ...s, key: "else-if", label: "else if" });
            } else {
              steps.push(s);
            }
          }
        } else if (elseBody?.type === "labeled_statement") {
          const blk =
            childByType(elseBody, "block") ?? elseBody.namedChild(0) ?? null;
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            ...locFromNode(file, elseClause),
            children: collectStatements(file, statementsOf(blk), typeName),
          });
        } else {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            ...locFromNode(file, elseClause),
            children: collectStatements(file, statementsOf(elseBody), typeName),
          });
        }
      }
      return;
    }

    if (node.type === "try_expression") {
      steps.push({
        type: "branch",
        key: "try",
        label: "try",
        ...locFromNode(file, node),
        children: collectStatements(file, namedChildren(node), typeName),
      });
      return;
    }

    if (node.type === "defer_statement") {
      steps.push({
        type: "branch",
        key: "defer",
        label: "defer",
        ...locFromNode(file, node),
        children: collectStatements(file, namedChildren(node), typeName),
      });
      return;
    }

    if (node.type === "switch_expression") {
      for (const clause of namedChildren(node)) {
        if (clause.type !== "switch_case") continue;
        const kids = namedChildren(clause);
        const bodyNode =
          kids.find(
            (c) =>
              c.type === "block" ||
              c.type === "block_expression" ||
              c.type === "call_expression" ||
              c.type === "identifier",
          ) ?? kids[kids.length - 1] ?? null;
        const pattern =
          kids.find((c) => c !== bodyNode) ?? null;
        const isElse = !pattern;
        const text = pattern ? collapseWs(pattern.text) : "";
        steps.push({
          type: "branch",
          key: isElse ? "else" : text ? `case:${text}` : "case",
          label: isElse ? "else" : text ? `case ${text}` : "case",
          ...locFromNode(file, pattern ?? clause),
          children: bodyNode
            ? collectStatements(file, [bodyNode], typeName)
            : [],
        });
      }
      return;
    }

    if (node.type === "call_expression") {
      const callee = node.namedChild(0);
      if (callee) {
        const key = calleeKey(callee, typeName);
        if (key) addCall(key, node);
      }
      for (const child of namedChildren(node).slice(1)) walk(child);
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
  typeName: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  const params = childByType(node, "parameters");
  const body = childByType(node, "block");
  const key = typeName ? `${typeName}.${name}` : name;
  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(file, statementsOf(body), typeName) : [],
    exported: true,
    start: node.startIndex,
    end: node.endIndex,
  });
}

function handleStruct(
  file: string,
  name: string,
  struct: SyntaxNode,
  functions: FunctionInfo[],
) {
  for (const child of namedChildren(struct)) {
    if (child.type === "function_declaration") {
      handleFunction(file, child, name, functions);
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
      continue;
    }
    if (stmt.type === "variable_declaration") {
      const name = childByType(stmt, "identifier")?.text ?? null;
      const struct = childByType(stmt, "struct_declaration");
      if (name && struct) {
        handleStruct(file, name, struct, functions);
      }
    }
  }
  return functions;
}

export const zigExtractor: LanguageExtractor = {
  id: "zig",
  extensions: [".zig"],
  // Modern grammar; npm `tree-sitter-zig` is nan-era and won't load on tree-sitter 0.25+
  grammarPackage: "@tree-sitter-grammars/tree-sitter-zig",
  extract: extractFromTree,
};
