/**
 * Ruby callable extraction (tree-sitter-ruby).
 *
 * Quirks: paren-less calls are often bare `identifier` nodes (not `call`).
 * `Foo.new` is a `call` with constant + identifier "new".
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

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "method_parameters") return "()";
  const names: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "identifier" || p.type === "optional_parameter") {
      const id =
        p.type === "identifier" ? p : childByType(p, "identifier");
      names.push(id?.text ?? "_");
      continue;
    }
    if (
      p.type === "splat_parameter" ||
      p.type === "hash_splat_parameter" ||
      p.type === "block_parameter"
    ) {
      const id = childByType(p, "identifier");
      const prefix =
        p.type === "hash_splat_parameter"
          ? "**"
          : p.type === "block_parameter"
            ? "&"
            : "*";
      names.push(id ? `${prefix}${id.text}` : prefix);
      continue;
    }
    if (p.type === "keyword_parameter") {
      const id = childByType(p, "identifier");
      names.push(id ? `${id.text}:` : "_:");
      continue;
    }
    names.push("_");
  }
  return names.length === 0 ? "()" : `(${names.join(", ")})`;
}

function callKey(node: SyntaxNode, className: string | null): string | null {
  // call → [receiver,] identifier/constant, [argument_list|!]
  const kids = namedChildren(node).filter(
    (c) =>
      c.type !== "argument_list" &&
      c.type !== "block" &&
      c.type !== "do_block",
  );
  if (kids.length === 0) return null;

  if (kids.length === 1) {
    const only = kids[0]!;
    if (only.type === "identifier") {
      return className ? `${className}.${only.text}` : only.text;
    }
    return null;
  }

  const method = kids[kids.length - 1]!;
  const receiver = kids[0]!;
  if (method.type !== "identifier") return null;
  const prop = method.text;

  if (receiver.type === "self" && className) {
    return `${className}.${prop}`;
  }
  if (receiver.type === "constant") {
    if (prop === "new") return `new ${receiver.text}`;
    return `${receiver.text}.${prop}`;
  }
  if (receiver.type === "identifier") {
    return `${receiver.text}.${prop}`;
  }
  if (className) return `${className}.${prop}`;
  return prop;
}

/**
 * Bare identifier used as a call (Ruby paren-less style).
 * Only treat as call when it appears in statement/expression call position.
 */
function bareCallKey(
  node: SyntaxNode,
  className: string | null,
): string | null {
  if (node.type !== "identifier") return null;
  const name = node.text;
  // Skip assignment targets handled elsewhere; keywords-ish
  if (name === "self" || name === "super") {
    return className && name === "super" ? className : null;
  }
  return className ? `${className}.${name}` : name;
}

function collectBody(
  body: SyntaxNode | null,
  className: string | null,
): CallStep[] {
  if (!body) return [];
  if (body.type === "body_statement" || body.type === "then" || body.type === "else") {
    return collectStatements(namedChildren(body), className);
  }
  return collectStatements([body], className);
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

  const walk = (node: SyntaxNode, asStatement: boolean): void => {
    if (
      node.type === "method" ||
      node.type === "singleton_method" ||
      node.type === "class" ||
      node.type === "module" ||
      node.type === "lambda" ||
      node.type === "block" ||
      node.type === "do_block"
    ) {
      return;
    }

    if (node.type === "if" || node.type === "unless") {
      const kids = namedChildren(node);
      const cond =
        kids.find(
          (c) =>
            c.type !== "then" &&
            c.type !== "else" &&
            c.type !== "elsif",
        ) ?? null;
      const thenNode = childByType(node, "then");
      const condText = cond ? collapseWs(cond.text) : "";
      const kind = node.type; // if | unless

      steps.push({
        type: "branch",
        key: condText ? `${kind}:${condText}` : kind,
        label: condText ? `${kind} ${condText}` : kind,
        children: collectBody(thenNode, className),
      });

      for (const clause of kids) {
        if (clause.type === "elsif") {
          const elsifKids = namedChildren(clause);
          const elsifCond =
            elsifKids.find((c) => c.type !== "then" && c.type !== "else") ??
            null;
          const text = elsifCond ? collapseWs(elsifCond.text) : "";
          steps.push({
            type: "branch",
            key: text ? `else-if:${text}` : "else-if",
            label: text ? `elsif ${text}` : "elsif",
            children: collectBody(childByType(clause, "then"), className),
          });
          // nested else under elsif
          const nestedElse = childByType(clause, "else");
          if (nestedElse) {
            steps.push({
              type: "branch",
              key: "else",
              label: "else",
              children: collectBody(nestedElse, className),
            });
          }
        }
        if (clause.type === "else") {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            children: collectBody(clause, className),
          });
        }
      }
      return;
    }

    if (node.type === "begin") {
      // Body statements are direct children before rescue/ensure/else
      const bodyStmts = namedChildren(node).filter(
        (c) =>
          c.type !== "rescue" &&
          c.type !== "ensure" &&
          c.type !== "else",
      );
      steps.push({
        type: "branch",
        key: "try",
        label: "begin",
        children: collectStatements(bodyStmts, className),
      });
      for (const clause of namedChildren(node)) {
        if (clause.type === "rescue") {
          const exceptions = childByType(clause, "exceptions");
          const text = exceptions ? collapseWs(exceptions.text) : "";
          const thenNode = childByType(clause, "then");
          steps.push({
            type: "branch",
            key: text ? `rescue:${text}` : "rescue",
            label: text ? `rescue ${text}` : "rescue",
            children: thenNode
              ? collectBody(thenNode, className)
              : collectStatements(
                  namedChildren(clause).filter(
                    (c) => c.type !== "exceptions" && c.type !== "exception_variable",
                  ),
                  className,
                ),
          });
        }
        if (clause.type === "else") {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            children: collectBody(clause, className),
          });
        }
        if (clause.type === "ensure") {
          steps.push({
            type: "branch",
            key: "ensure",
            label: "ensure",
            children: collectStatements(namedChildren(clause), className),
          });
        }
      }
      return;
    }

    if (node.type === "case") {
      for (const clause of namedChildren(node)) {
        if (clause.type === "when") {
          const pattern =
            childByType(clause, "pattern") ??
            namedChildren(clause).find((c) => c.type !== "then") ??
            null;
          const text = pattern ? collapseWs(pattern.text) : "";
          steps.push({
            type: "branch",
            key: text ? `when:${text}` : "when",
            label: text ? `when ${text}` : "when",
            children: collectBody(childByType(clause, "then"), className),
          });
        }
        if (clause.type === "else") {
          steps.push({
            type: "branch",
            key: "else",
            label: "else",
            children: collectBody(clause, className),
          });
        }
      }
      return;
    }

    if (node.type === "call") {
      // Ruby models `obj.attr` as `call` even without args. Count those only
      // at statement level; always count calls that pass an argument_list.
      const hasArgs = childByType(node, "argument_list") !== null;
      const hasBlock =
        childByType(node, "block") !== null ||
        childByType(node, "do_block") !== null;
      const kids = namedChildren(node).filter(
        (c) =>
          c.type !== "argument_list" &&
          c.type !== "block" &&
          c.type !== "do_block",
      );
      const isReceiverCall = kids.length >= 2;
      // `lambda { ... }` / `proc { ... }` are closures, not real callees
      const bareName =
        kids.length === 1 && kids[0]!.type === "identifier"
          ? kids[0]!.text
          : null;
      const isClosureCtor =
        hasBlock && (bareName === "lambda" || bareName === "proc");
      if (
        !isClosureCtor &&
        (asStatement || hasArgs || !isReceiverCall)
      ) {
        const key = callKey(node, className);
        if (key) addCall(key, node.startIndex);
      }
      // Nested invocations inside arguments (not bare attr reads)
      const args = childByType(node, "argument_list");
      if (args) {
        for (const child of namedChildren(args)) walk(child, false);
      }
      return;
    }

    if (node.type === "assignment") {
      // RHS may be bare call identifier
      const kids = namedChildren(node);
      const rhs = kids[1] ?? null;
      if (rhs) {
        if (rhs.type === "identifier") {
          const key = bareCallKey(rhs, null); // free-call style on RHS
          // Prefer free name for top-level helpers assigned into locals
          if (key) {
            // If className set, bareCallKey prefixes — for assignment RHS use free name
            addCall(rhs.text, rhs.startIndex);
          }
        } else {
          walk(rhs, false);
        }
      }
      return;
    }

    // Statement-level bare identifier → method call
    if (node.type === "identifier" && asStatement) {
      const key = bareCallKey(node, className);
      if (key) addCall(key, node.startIndex);
      return;
    }

    for (const child of namedChildren(node)) {
      walk(child, false);
    }
  };

  for (const stmt of statements) walk(stmt, true);
  return steps;
}

function handleMethod(
  file: string,
  node: SyntaxNode,
  className: string | null,
  functions: FunctionInfo[],
) {
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;

  const params = childByType(node, "method_parameters");
  const body = childByType(node, "body_statement");
  const isInit = className !== null && name === "initialize";
  const key = className
    ? isInit
      ? `${className}.initialize`
      : `${className}.${name}`
    : name;
  const labelBase = isInit ? `${className}` : key;

  const info: FunctionInfo = {
    key,
    label: `${labelBase}${getParamsLabel(params)}`,
    file,
    steps: collectBody(body, className),
    exported: !name.startsWith("_"),
    start: node.startIndex,
    end: node.endIndex,
  };
  functions.push(info);

  if (isInit && className) {
    functions.push({
      ...info,
      key: `new ${className}`,
      label: `${className}${getParamsLabel(params)}`,
    });
  }
}

function handleSingletonMethod(
  file: string,
  node: SyntaxNode,
  className: string | null,
  functions: FunctionInfo[],
) {
  // def self.bar / def Foo.bar
  const name = childByType(node, "identifier")?.text ?? null;
  if (!name) return;
  const params = childByType(node, "method_parameters");
  const body = childByType(node, "body_statement");
  const key = className ? `${className}.${name}` : name;
  functions.push({
    key,
    label: `${key}${getParamsLabel(params)}`,
    file,
    steps: collectBody(body, className),
    exported: !name.startsWith("_"),
    start: node.startIndex,
    end: node.endIndex,
  });
}

function handleClass(
  file: string,
  node: SyntaxNode,
  functions: FunctionInfo[],
) {
  const className = childByType(node, "constant")?.text ?? null;
  if (!className) return;
  const body = childByType(node, "body_statement");
  if (!body) return;

  for (const stmt of namedChildren(body)) {
    if (stmt.type === "method") {
      handleMethod(file, stmt, className, functions);
    } else if (stmt.type === "singleton_method") {
      handleSingletonMethod(file, stmt, className, functions);
    } else if (stmt.type === "class") {
      handleClass(file, stmt, functions);
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
    if (stmt.type === "method") {
      handleMethod(file, stmt, null, functions);
    } else if (stmt.type === "singleton_method") {
      handleSingletonMethod(file, stmt, null, functions);
    } else if (stmt.type === "class") {
      handleClass(file, stmt, functions);
    }
  }
  return functions;
}

export const rubyExtractor: LanguageExtractor = {
  id: "ruby",
  extensions: [".rb"],
  grammarPackage: "tree-sitter-ruby",
  extract: extractFromTree,
};
