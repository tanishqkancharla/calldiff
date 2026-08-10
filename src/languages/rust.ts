/**
 * Rust callable extraction (tree-sitter-rust).
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

function isPublic(node: SyntaxNode): boolean {
  return childByType(node, "visibility_modifier") !== null;
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "self_parameter") {
      names.push("self");
      continue;
    }
    if (p.type === "parameter") {
      const ident =
        namedChildren(p).find((c) => c.type === "identifier") ?? null;
      names.push(ident?.text ?? "_");
      continue;
    }
    if (p.type === "variadic_parameter") {
      names.push("...");
    }
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function calleeKey(node: SyntaxNode, typeName: string | null): string | null {
  if (node.type === "identifier") return node.text;

  if (node.type === "field_expression") {
    const object = node.namedChild(0);
    const field = childByType(node, "field_identifier");
    if (!object || !field) return null;
    const prop = field.text;
    if (object.type === "self" && typeName) {
      return `${typeName}.${prop}`;
    }
    if (object.type === "identifier") {
      const objName = object.text;
      if (
        typeName &&
        objName[0] &&
        objName[0] === objName[0].toLowerCase()
      ) {
        return `${typeName}.${prop}`;
      }
      return `${objName}.${prop}`;
    }
    if (typeName) return `${typeName}.${prop}`;
    return prop;
  }

  if (node.type === "scoped_identifier") {
    // Foo::new / Foo::bar — last two identifier-like parts
    const parts = namedChildren(node).filter(
      (c) =>
        c.type === "identifier" ||
        c.type === "type_identifier" ||
        c.type === "scoped_identifier",
    );
    // Flatten: take text of last child as name, preceding type_identifier/identifier
    const nameNode = parts.at(-1);
    if (!nameNode) return null;
    const name = nameNode.text;
    // Prefer a type_identifier sibling before the name
    const typeNode =
      namedChildren(node).find((c) => c.type === "type_identifier") ??
      namedChildren(node).find(
        (c) => c.type === "identifier" && c !== nameNode,
      ) ??
      null;
    if (typeNode) {
      if (name === "new") return `new ${typeNode.text}`;
      return `${typeNode.text}.${name}`;
    }
    return name;
  }

  return null;
}

function statementsOf(node: SyntaxNode): SyntaxNode[] {
  if (node.type === "block") return namedChildren(node);
  return [node];
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

  const pushIfChain = (node: SyntaxNode, asElseIf: boolean): void => {
    const kids = namedChildren(node);
    const cond =
      kids.find((c) => c.type !== "block" && c.type !== "else_clause") ?? null;
    const thenBlock = kids.find((c) => c.type === "block") ?? null;
    const elseClause = childByType(node, "else_clause");
    const condText = cond ? collapseWs(cond.text) : "";
    const kind = asElseIf ? "else-if" : "if";
    const labelKind = asElseIf ? "else if" : "if";

    steps.push({
      type: "branch",
      key: condText ? `${kind}:${condText}` : kind,
      label: condText ? `${labelKind} ${condText}` : labelKind,
      ...locFromNode(file, cond ?? node),
      children: thenBlock
        ? collectStatements(file, statementsOf(thenBlock), typeName)
        : [],
    });

    if (!elseClause) return;
    const elseInner = elseClause.namedChild(0);
    if (!elseInner) return;

    if (elseInner.type === "if_expression") {
      pushIfChain(elseInner, true);
      return;
    }

    steps.push({
      type: "branch",
      key: "else",
      label: "else",
      ...locFromNode(file, elseClause),
      children: collectStatements(file, statementsOf(elseInner), typeName),
    });
  };

  const walk = (node: SyntaxNode): void => {
    if (
      node.type === "function_item" ||
      node.type === "closure_expression" ||
      node.type === "impl_item"
    ) {
      return;
    }

    if (node.type === "if_expression") {
      pushIfChain(node, false);
      return;
    }

    if (node.type === "match_expression") {
      const block = childByType(node, "match_block");
      for (const arm of block ? namedChildren(block) : []) {
        if (arm.type !== "match_arm") continue;
        const pattern =
          childByType(arm, "match_pattern") ??
          namedChildren(arm).find(
            (c) =>
              c.type !== "block" &&
              c.type !== "call_expression" &&
              c.type !== "identifier" &&
              c.type !== "if_expression" &&
              c.type !== "match_expression" &&
              c.type !== "closure_expression",
          ) ??
          null;
        // Body is the last named child that isn't the pattern / attribute
        const kids = namedChildren(arm).filter(
          (c) => c.type !== "attribute_item",
        );
        const body = kids.length > 1 ? kids[kids.length - 1]! : null;
        const text = pattern ? collapseWs(pattern.text) : "";
        steps.push({
          type: "branch",
          key: text ? `case:${text}` : "case",
          label: text ? `case ${text}` : "case",
          ...locFromNode(file, pattern ?? arm),
          children: body
            ? collectStatements(file, statementsOf(body), typeName)
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
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(stmt);
  return steps;
}

function handleFunctionItem(
  file: string,
  node: SyntaxNode,
  typeName: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;

  const params = childByType(node, "parameters");
  const body = childByType(node, "block");
  const isNew = typeName !== null && name === "new";
  const key = typeName
    ? isNew
      ? `${typeName}.new`
      : `${typeName}.${name}`
    : name;
  const labelBase = isNew ? `new ${typeName}` : key;
  const exported = isPublic(node) || !name.startsWith("_");

  const info: FunctionInfo = {
    key,
    label: `${labelBase}${getParamsLabel(params)}`,
    file,
    steps: body ? collectStatements(file, statementsOf(body), typeName) : [],
    exported,
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);

  if (isNew && typeName) {
    functions.push({
      ...info,
      key: `new ${typeName}`,
      label: `new ${typeName}${getParamsLabel(params)}`,
    });
  }
}

function handleImpl(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const typeIds = namedChildren(node).filter((c) => c.type === "type_identifier");
  // `impl Foo` → one type_identifier; `impl Trait for Foo` → last is the type
  const typeName = typeIds.at(-1)?.text ?? null;
  if (!typeName) return;

  const list = childByType(node, "declaration_list");
  if (!list) return;

  for (const item of namedChildren(list)) {
    if (item.type === "function_item") {
      handleFunctionItem(file, item, typeName, functions);
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
    if (stmt.type === "function_item") {
      handleFunctionItem(file, stmt, null, functions);
    } else if (stmt.type === "impl_item") {
      handleImpl(file, stmt, functions);
    }
  }
  return functions;
}

export const rustExtractor: LanguageExtractor = {
  id: "rust",
  extensions: [".rs"],
  grammarPackage: "tree-sitter-rust",
  extract: extractFromTree,
};
