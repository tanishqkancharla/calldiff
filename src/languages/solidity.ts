/**
 * Solidity callable extraction (tree-sitter-solidity).
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

function getParamsLabel(fn: SyntaxNode): string {
  const names: string[] = [];
  for (const c of namedChildren(fn)) {
    if (c.type !== "parameter") continue;
    const id = childByType(c, "identifier");
    names.push(id?.text ?? "_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function typeNameFrom(node: SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.type === "identifier") return node.text;
  if (node.type === "user_defined_type" || node.type === "type_name") {
    const id = childByType(node, "identifier") ?? childByType(node, "user_defined_type");
    if (id?.type === "identifier") return id.text;
    return typeNameFrom(id);
  }
  const id = childByType(node, "identifier");
  return id?.text ?? null;
}

function calleeKey(node: SyntaxNode, contractName: string | null): string | null {
  if (node.type === "identifier") {
    // Bare call inside contract → Contract.fn (local)
    if (contractName) return `${contractName}.${node.text}`;
    return node.text;
  }
  if (node.type === "member_expression") {
    const object = node.namedChild(0);
    const prop = node.namedChild(1);
    if (!prop) return null;
    const propName = prop.text;
    if (object?.type === "identifier") {
      if (object.text === "this" && contractName) {
        return `${contractName}.${propName}`;
      }
      return `${object.text}.${propName}`;
    }
    if (contractName) return `${contractName}.${propName}`;
    return propName;
  }
  if (node.type === "new_expression") {
    const t =
      typeNameFrom(childByType(node, "type_name")) ??
      typeNameFrom(childByType(node, "user_defined_type")) ??
      typeNameFrom(node.namedChild(0));
    return t ? `new ${t}` : null;
  }
  return null;
}

function statementsOf(body: SyntaxNode | null): SyntaxNode[] {
  if (!body) return [];
  if (body.type === "function_body" || body.type === "block_statement") {
    return namedChildren(body);
  }
  if (body.type === "statement") {
    return namedChildren(body);
  }
  return [body];
}

function unwrapStatement(stmt: SyntaxNode): SyntaxNode {
  if (stmt.type === "statement" && stmt.namedChildCount === 1) {
    return stmt.namedChild(0) ?? stmt;
  }
  return stmt;
}

function collectStatements(
  file: string,
  statements: SyntaxNode[],
  contractName: string | null,
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
      node.type === "function_definition" ||
      node.type === "constructor_definition" ||
      node.type === "modifier_definition" ||
      node.type === "contract_declaration" ||
      node.type === "library_declaration" ||
      node.type === "interface_declaration"
    ) {
      return;
    }

    if (node.type === "if_statement") {
      const kids = namedChildren(node);
      const cond =
        kids.find(
          (c) =>
            c.type !== "statement" &&
            c.type !== "block_statement",
        ) ?? kids[0] ?? null;
      const bodies = kids.filter(
        (c) => c.type === "statement" || c.type === "block_statement",
      );
      const condText = cond ? collapseWs(cond.text) : "";
      const thenNode = bodies[0] ? unwrapStatement(bodies[0]) : null;
      const elseNode = bodies[1] ? unwrapStatement(bodies[1]) : null;
      steps.push({
        type: "branch",
        key: condText ? `if:${condText}` : "if",
        label: condText ? `if ${condText}` : "if",
        ...locFromNode(file, cond ?? node),
        children: thenNode
          ? collectStatements(file, statementsOf(thenNode), contractName)
          : [],
      });
      if (elseNode) {
        if (elseNode.type === "if_statement") {
          const nested = collectStatements(file, [elseNode], contractName);
          for (const s of nested) {
            if (s.type === "branch" && (s.key === "if" || s.key.startsWith("if:"))) {
              steps.push({
                ...s,
                key: s.key === "if" ? "else-if" : s.key.replace(/^if:/, "else-if:"),
                label: s.label.replace(/^if /, "else if "),
              });
            } else {
              steps.push(s);
            }
          }
        } else {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            ...locFromNode(file, elseNode),
            children: collectStatements(
              file,
              statementsOf(elseNode),
              contractName,
            ),
          });
        }
      }
      return;
    }

    if (node.type === "call_expression") {
      const callee =
        childByType(node, "expression")?.namedChild?.(0) ??
        childByType(node, "expression") ??
        node.namedChild(0);
      // expression → identifier | member_expression | new_expression
      let target = callee;
      if (callee?.type === "expression") {
        target = callee.namedChild(0) ?? callee;
      }
      if (target) {
        const key = calleeKey(target, contractName);
        if (key) addCall(key, node);
      }
      for (const child of namedChildren(node).slice(1)) walk(child);
      return;
    }

    for (const child of namedChildren(node)) walk(child);
  };

  for (const stmt of statements) walk(unwrapStatement(stmt));
  return steps;
}

function handleFunction(
  file: string,
  node: SyntaxNode,
  contractName: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  const body = childByType(node, "function_body");
  const key = contractName ? `${contractName}.${name}` : name;
  const visibility = childByType(node, "visibility")?.text;
  const exported =
    visibility === "public" ||
    visibility === "external" ||
    visibility === undefined ||
    contractName === null;

  functions.push({
    key,
    label: `${key}${getParamsLabel(node)}`,
    file,
    steps: body
      ? collectStatements(file, statementsOf(body), contractName)
      : [],
    exported: visibility === "private" || visibility === "internal" ? false : exported,
    start: node.startIndex,
    end: node.endIndex,
  });
}

function handleConstructor(
  file: string,
  node: SyntaxNode,
  contractName: string,
  functions: FunctionInfo[],
) {
  const body = childByType(node, "function_body");
  const info: FunctionInfo = {
    key: `${contractName}.constructor`,
    label: `new ${contractName}${getParamsLabel(node)}`,
    file,
    steps: body
      ? collectStatements(file, statementsOf(body), contractName)
      : [],
    exported: true,
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);
  functions.push({
    ...info,
    key: `new ${contractName}`,
    label: `new ${contractName}()`,
  });
}

function handleContractLike(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  const body =
    childByType(node, "contract_body") ?? childByType(node, "interface_body");
  if (!body) return;
  for (const child of namedChildren(body)) {
    if (child.type === "function_definition") {
      handleFunction(file, child, name, functions);
    } else if (child.type === "constructor_definition") {
      handleConstructor(file, child, name, functions);
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
    if (
      stmt.type === "contract_declaration" ||
      stmt.type === "library_declaration" ||
      stmt.type === "interface_declaration"
    ) {
      handleContractLike(file, stmt, functions);
    } else if (stmt.type === "function_definition") {
      handleFunction(file, stmt, null, functions);
    }
  }
  return functions;
}

export const solidityExtractor: LanguageExtractor = {
  id: "solidity",
  extensions: [".sol"],
  grammarPackage: "tree-sitter-solidity",
  extract: extractFromTree,
};
