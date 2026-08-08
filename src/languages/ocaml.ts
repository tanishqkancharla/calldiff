/**
 * OCaml callable extraction (tree-sitter-ocaml).
 * Package exports: `ocaml`, `ocaml_interface`, `ocaml_type` — we use `.ocaml`.
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

function getParamsLabel(binding: SyntaxNode): string {
  const names: string[] = [];
  for (const c of namedChildren(binding)) {
    if (c.type !== "parameter") continue;
    const pat =
      childByType(c, "value_pattern") ??
      childByType(c, "unit") ??
      c.namedChild(0);
    if (!pat) {
      names.push("_");
      continue;
    }
    if (pat.type === "unit") continue; // `()` param → show as no-arg slot
    names.push(pat.text);
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function valuePathKey(node: SyntaxNode, moduleName: string | null): string | null {
  if (node.type === "value_name") {
    return moduleName ? `${moduleName}.${node.text}` : node.text;
  }
  if (node.type === "value_path") {
    const value = childByType(node, "value_name");
    if (!value) return null;
    const modPath = childByType(node, "module_path");
    if (modPath) {
      // Flatten module_path text: Runner.Validate.x → keep as written
      const mods: string[] = [];
      const collectMods = (n: SyntaxNode) => {
        for (const c of namedChildren(n)) {
          if (c.type === "module_path") collectMods(c);
          else if (c.type === "module_name") mods.push(c.text);
        }
      };
      collectMods(modPath);
      return mods.length > 0 ? `${mods.join(".")}.${value.text}` : value.text;
    }
    // Bare value inside module → Module.value
    return moduleName ? `${moduleName}.${value.text}` : value.text;
  }
  if (node.type === "field_get_expression") {
    const obj = node.namedChild(0);
    const field = childByType(node, "field_path") ?? node.namedChild(1);
    const fieldName =
      field && (childByType(field, "field_name")?.text ?? field.text);
    if (!fieldName) return null;
    if (obj?.type === "value_path") {
      const simple = childByType(obj, "value_name");
      if (simple && !childByType(obj, "module_path")) {
        return `${simple.text}.${fieldName}`;
      }
    }
    return fieldName;
  }
  return null;
}

function collectExpr(
  node: SyntaxNode | null,
  moduleName: string | null,
): CallStep[] {
  if (!node) return [];
  const steps: CallStep[] = [];
  const seen = new Set<string>();

  const addCall = (key: string, start: number) => {
    const mark = `${key}:${start}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    steps.push({ type: "call", key });
  };

  const walk = (n: SyntaxNode): void => {
    // Nested functions
    if (
      n.type === "fun_expression" ||
      n.type === "function_expression" ||
      n.type === "value_definition" ||
      n.type === "let_binding" ||
      n.type === "module_definition"
    ) {
      // let_expression contains value_definition for `let x = e in body` —
      // we still need to walk the bound expression and body, but not index nested lets as functions.
      if (n.type === "let_binding" || n.type === "value_definition") return;
      if (n.type === "fun_expression" || n.type === "function_expression") return;
      if (n.type === "module_definition") return;
    }

    if (n.type === "let_expression") {
      // let x = rhs in body — walk rhs + body; skip indexing nested binding
      const vd = childByType(n, "value_definition");
      if (vd) {
        for (const b of namedChildren(vd)) {
          if (b.type !== "let_binding") continue;
          const hasParams = namedChildren(b).some((c) => c.type === "parameter");
          // Nested function bodies are not attributed to the outer caller
          if (hasParams) continue;
          // rhs is last non-parameter child
          const kids = namedChildren(b);
          const rhs =
            kids.find(
              (c) =>
                c.type !== "value_name" &&
                c.type !== "parameter" &&
                c.type !== "type_constraint",
            ) ?? kids[kids.length - 1] ?? null;
          if (rhs) walk(rhs);
        }
      }
      // body is typically last named child
      const body =
        namedChildren(n).find((c) => c.type !== "value_definition") ?? null;
      if (body) walk(body);
      return;
    }

    if (n.type === "match_expression" || n.type === "try_expression") {
      if (n.type === "try_expression") {
        const tryBody =
          namedChildren(n).find((c) => c.type !== "match_case") ?? null;
        steps.push({
          type: "branch",
          key: "try",
          label: "try",
          children: tryBody ? collectExpr(tryBody, moduleName) : [],
        });
      }
      for (const clause of namedChildren(n)) {
        if (clause.type !== "match_case") continue;
        const kids = namedChildren(clause);
        const body = kids[kids.length - 1] ?? null;
        const pattern = kids.length > 1 ? kids[0] : null;
        const text = pattern ? collapseWs(pattern.text) : "";
        const labelKind = n.type === "try_expression" ? "with" : "case";
        steps.push({
          type: "branch",
          key: text ? `${labelKind}:${text}` : labelKind,
          label: text ? `${labelKind} ${text}` : labelKind,
          children: body ? collectExpr(body, moduleName) : [],
        });
      }
      return;
    }

    if (n.type === "if_expression") {
      const kids = namedChildren(n);
      const thenClause = childByType(n, "then_clause");
      const elseClause = childByType(n, "else_clause");
      const cond =
        kids.find(
          (c) => c.type !== "then_clause" && c.type !== "else_clause",
        ) ?? null;
      const condText = cond ? collapseWs(cond.text) : "";
      steps.push({
        type: "branch",
        key: condText ? `if:${condText}` : "if",
        label: condText ? `if ${condText}` : "if",
        children: thenClause
          ? collectExpr(thenClause.namedChild(0) ?? thenClause, moduleName)
          : [],
      });
      if (elseClause) {
        const elseBody = elseClause.namedChild(0) ?? elseClause;
        if (elseBody.type === "if_expression") {
          const nested = collectExpr(elseBody, moduleName);
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
            children: collectExpr(elseBody, moduleName),
          });
        }
      }
      if (cond) walk(cond);
      return;
    }

    if (n.type === "application_expression") {
      const callee = n.namedChild(0);
      if (callee) {
        const key = valuePathKey(callee, moduleName);
        if (key) addCall(key, n.startIndex);
      }
      for (const child of namedChildren(n).slice(1)) walk(child);
      return;
    }

    if (n.type === "sequence_expression") {
      for (const child of namedChildren(n)) walk(child);
      return;
    }

    for (const child of namedChildren(n)) walk(child);
  };

  walk(node);
  return steps;
}

function bindingBody(binding: SyntaxNode): SyntaxNode | null {
  const kids = namedChildren(binding);
  // skip value_name, parameters, type constraints
  const body =
    [...kids]
      .reverse()
      .find(
        (c) =>
          c.type !== "value_name" &&
          c.type !== "parameter" &&
          c.type !== "type_constraint" &&
          c.type !== "attribute",
      ) ?? null;
  return body;
}

function handleLetBinding(
  file: string,
  binding: SyntaxNode,
  moduleName: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(binding, "value_name")?.text ?? null;
  if (!name) return;
  // Only treat as function if it has parameters or is clearly a fun
  const hasParams = namedChildren(binding).some((c) => c.type === "parameter");
  const body = bindingBody(binding);
  if (!hasParams && body?.type === "fun_expression") {
    // let f = fun x -> ...
  } else if (!hasParams) {
    // plain value binding — skip (not a callable)
    return;
  }
  const key = moduleName ? `${moduleName}.${name}` : name;
  const funBody =
    body?.type === "fun_expression"
      ? bindingBody(body) ?? body.namedChild(body.namedChildCount - 1)
      : body;
  functions.push({
    key,
    label: `${key}${getParamsLabel(binding)}`,
    file,
    steps: collectExpr(funBody, moduleName),
    exported: true,
    start: binding.startIndex,
    end: binding.endIndex,
  });
}

function handleValueDefinition(
  file: string,
  node: SyntaxNode,
  moduleName: string | null,
  functions: FunctionInfo[],
) {
  for (const b of namedChildren(node)) {
    if (b.type === "let_binding") {
      handleLetBinding(file, b, moduleName, functions);
    }
  }
}

function handleModule(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const binding = childByType(node, "module_binding") ?? node;
  const name =
    childByType(binding, "module_name")?.text ??
    childByType(node, "module_name")?.text ??
    null;
  if (!name) return;
  const structure =
    childByType(binding, "structure") ?? childByType(node, "structure");
  if (!structure) return;
  for (const item of namedChildren(structure)) {
    if (item.type === "value_definition") {
      handleValueDefinition(file, item, name, functions);
    } else if (item.type === "module_definition") {
      // nested modules — prefix could be nested; skip deep nesting for prototype
      handleModule(file, item, functions);
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
    if (stmt.type === "value_definition") {
      handleValueDefinition(file, stmt, null, functions);
    } else if (stmt.type === "module_definition") {
      handleModule(file, stmt, functions);
    }
  }
  return functions;
}

export const ocamlExtractor: LanguageExtractor = {
  id: "ocaml",
  extensions: [".ml"],
  grammarPackage: "tree-sitter-ocaml",
  grammarExport: "ocaml",
  extract: extractFromTree,
};
