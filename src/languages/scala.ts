/**
 * Scala callable extraction (tree-sitter-scala).
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
  return /\bprivate\b|\bprotected\b/.test(
    namedChildren(node)
      .filter((c) => c.type === "modifiers" || c.type === "access_modifier")
      .map((c) => c.text)
      .join(" ") || node.text.slice(0, 40),
  );
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "parameter") {
      const id = childByType(p, "identifier");
      names.push(id?.text ?? "_");
    }
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function isLikelyTypeName(name: string): boolean {
  const c = name[0];
  return c !== undefined && c === c.toUpperCase() && c !== c.toLowerCase();
}

function calleeKey(node: SyntaxNode, typeName: string | null): string | null {
  if (node.type === "identifier") {
    // Services() → constructor-style call (common Scala apply sugar)
    if (isLikelyTypeName(node.text)) return `new ${node.text}`;
    // Bare calls inside a class/object refer to siblings: prepare() → Runner.prepare
    if (typeName) return `${typeName}.${node.text}`;
    return node.text;
  }

  if (node.type === "field_expression") {
    const object = node.namedChild(0);
    const field = node.namedChild(1);
    if (!object || !field) return null;
    const prop = field.text;

    if (object.type === "identifier") {
      if ((object.text === "this" || object.text === "self") && typeName) {
        return `${typeName}.${prop}`;
      }
      return `${object.text}.${prop}`;
    }
    if (typeName) return `${typeName}.${prop}`;
    return prop;
  }

  return null;
}

function statementsOf(body: SyntaxNode | null): SyntaxNode[] {
  if (!body) return [];
  if (body.type === "block") return namedChildren(body);
  return [body];
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
    const blocks = kids.filter((c) => c.type === "block");
    const nestedIf = kids.find((c) => c.type === "if_expression") ?? null;
    const cond =
      childByType(node, "parenthesized_expression") ??
      kids.find(
        (c) => c.type !== "block" && c.type !== "if_expression",
      ) ??
      null;
    const condInner =
      cond?.type === "parenthesized_expression"
        ? (cond.namedChild(0) ?? cond)
        : cond;
    const condText = condInner ? collapseWs(condInner.text) : "";
    const kind = asElseIf ? "else-if" : "if";
    const labelKind = asElseIf ? "else if" : "if";

    steps.push({
      type: "branch",
      key: condText ? `${kind}:${condText}` : kind,
      label: condText ? `${labelKind} (${condText})` : labelKind,
      ...locFromNode(file, condInner ?? node),
      children: collectStatements(
        file,
        statementsOf(blocks[0] ?? null),
        typeName,
      ),
    });

    if (nestedIf) {
      pushIfChain(nestedIf, true);
      return;
    }

    if (blocks[1]) {
      steps.push({
        type: "branch",
        key: "else",
        label: "else",
        ...locFromNode(file, blocks[1]),
        children: collectStatements(file, statementsOf(blocks[1]), typeName),
      });
    }
  };

  const walk = (node: SyntaxNode): void => {
    if (
      node.type === "function_definition" ||
      node.type === "class_definition" ||
      node.type === "object_definition" ||
      node.type === "trait_definition" ||
      node.type === "lambda_expression"
    ) {
      return;
    }

    if (node.type === "if_expression") {
      pushIfChain(node, false);
      return;
    }

    if (node.type === "try_expression") {
      const tryBlock = childByType(node, "block");
      steps.push({
        type: "branch",
        key: "try",
        label: "try",
        ...locFromNode(file, node),
        children: collectStatements(file, statementsOf(tryBlock), typeName),
      });
      for (const clause of namedChildren(node)) {
        if (clause.type === "catch_clause") {
          const caseBlock = childByType(clause, "case_block");
          const cases = caseBlock ? namedChildren(caseBlock) : [];
          if (cases.length === 0) {
            steps.push({
              type: "branch",
              key: "catch",
              label: "catch",
              ...locFromNode(file, clause),
              children: collectStatements(file, namedChildren(clause), typeName),
            });
          } else {
            for (const c of cases) {
              if (c.type !== "case_clause") continue;
              const pattern =
                namedChildren(c).find(
                  (x) =>
                    x.type !== "block" &&
                    x.type !== "call_expression" &&
                    x.type !== "infix_expression",
                ) ?? namedChildren(c)[0] ?? null;
              const text = pattern ? collapseWs(pattern.text) : "";
              const bodyNodes = namedChildren(c).slice(1);
              steps.push({
                type: "branch",
                key: text ? `catch:${text}` : "catch",
                label: text ? `catch ${text}` : "catch",
                ...locFromNode(file, pattern ?? c),
                children: collectStatements(file, bodyNodes, typeName),
              });
            }
          }
        }
        if (clause.type === "finally_clause") {
          const body =
            childByType(clause, "block") ?? clause.namedChild(0) ?? null;
          steps.push({
            type: "branch",
            key: "finally",
            label: "finally",
            ...locFromNode(file, clause),
            children: collectStatements(file, statementsOf(body), typeName),
          });
        }
      }
      return;
    }

    if (node.type === "match_expression") {
      const caseBlock = childByType(node, "case_block");
      for (const clause of caseBlock ? namedChildren(caseBlock) : []) {
        if (clause.type !== "case_clause") continue;
        const kids = namedChildren(clause);
        const pattern = kids[0] ?? null;
        const text = pattern ? collapseWs(pattern.text) : "";
        const bodyNodes = kids.slice(1);
        steps.push({
          type: "branch",
          key: text ? `case:${text}` : "case",
          label: text ? `case ${text}` : "case",
          ...locFromNode(file, pattern ?? clause),
          children: collectStatements(file, bodyNodes, typeName),
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

    if (node.type === "instance_expression") {
      // new Foo(args)
      const typeId = childByType(node, "type_identifier");
      if (typeId) addCall(`new ${typeId.text}`, node);
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
  typeName: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  const params = childByType(node, "parameters");
  const body =
    childByType(node, "block") ??
    namedChildren(node).find(
      (c) =>
        c.type !== "identifier" &&
        c.type !== "parameters" &&
        c.type !== "type_identifier" &&
        c.type !== "modifiers" &&
        c.type !== "access_modifier" &&
        c.type !== "singleton_type",
    ) ??
    null;

  const key = typeName ? `${typeName}.${name}` : name;
  const exported = !isPrivate(node);
  const steps = collectStatements(file, statementsOf(body), typeName);
  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps,
    exported,
    start: node.startIndex,
    end: node.endIndex,
  });

  // object Foo { def apply(...) } → also index as constructor alias
  if (typeName && name === "apply") {
    functions.push({
      key: `new ${typeName}`,
      label: `${typeName}${getParamsLabel(params)}`,
      file,
      steps,
      exported,
      start: node.startIndex,
      end: node.endIndex,
    });
  }

  // class Foo { def this(...) } → secondary constructor alias
  if (typeName && name === "this") {
    functions.push({
      key: `new ${typeName}`,
      label: `${typeName}${getParamsLabel(params)}`,
      file,
      steps,
      exported,
      start: node.startIndex,
      end: node.endIndex,
    });
  }
}

function handleTemplate(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const typeName = childByType(node, "identifier")?.text ?? null;
  if (!typeName) return;
  const body = childByType(node, "template_body");
  if (!body) return;

  for (const element of namedChildren(body)) {
    if (element.type === "function_definition") {
      handleFunction(file, element, typeName, functions);
    } else if (
      element.type === "class_definition" ||
      element.type === "object_definition" ||
      element.type === "trait_definition"
    ) {
      handleTemplate(file, element, functions);
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
    if (stmt.type === "function_definition") {
      handleFunction(file, stmt, null, functions);
    } else if (
      stmt.type === "class_definition" ||
      stmt.type === "object_definition" ||
      stmt.type === "trait_definition"
    ) {
      handleTemplate(file, stmt, functions);
    }
  }
  return functions;
}

export const scalaExtractor: LanguageExtractor = {
  id: "scala",
  extensions: [".scala"],
  grammarPackage: "tree-sitter-scala",
  extract: extractFromTree,
};
