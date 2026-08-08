import { parseSync } from "oxc-parser";
import type { Node } from "@oxc-project/types";
import type { CallStep, FunctionInfo } from "./types.js";

type AnyNode = Node & Record<string, unknown>;

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function getParamsLabel(params: unknown): string {
  if (!Array.isArray(params)) return "()";
  if (params.length === 0) return "()";
  const names = params.map((param) => {
    if (!isNode(param)) return "_";
    if (param.type === "Identifier") return String(param.name);
    if (param.type === "AssignmentPattern" && isNode(param.left)) {
      if (param.left.type === "Identifier") return String(param.left.name);
    }
    if (param.type === "RestElement" && isNode(param.argument)) {
      if (param.argument.type === "Identifier") {
        return `...${param.argument.name}`;
      }
      return "...";
    }
    if (param.type === "ObjectPattern") return "{}";
    if (param.type === "ArrayPattern") return "[]";
    if (param.type === "TSParameterProperty" && isNode(param.parameter)) {
      return getParamsLabel([param.parameter]).replace(/^\(|\)$/g, "") || "_";
    }
    return "_";
  });
  return `(${names.join(", ")})`;
}

function calleeKey(node: AnyNode, className: string | null): string | null {
  if (node.type === "Identifier") {
    return String(node.name);
  }

  if (node.type === "ThisExpression") {
    return className;
  }

  if (node.type === "MemberExpression") {
    const computed = Boolean(node.computed);
    const object = isNode(node.object) ? node.object : null;
    const property = isNode(node.property) ? node.property : null;

    if (!object || !property) return null;

    let propName: string | null = null;
    if (!computed && property.type === "Identifier") {
      propName = String(property.name);
    } else if (property.type === "PrivateIdentifier") {
      propName = `#${property.name}`;
    }

    if (!propName) return null;

    if (object.type === "ThisExpression" && className) {
      return `${className}.${propName}`;
    }

    if (object.type === "Identifier") {
      return `${String(object.name)}.${propName}`;
    }

    if (className) return `${className}.${propName}`;
    return propName;
  }

  if (node.type === "ChainExpression" && isNode(node.expression)) {
    return calleeKey(node.expression, className);
  }

  return null;
}

function condText(source: string, test: AnyNode): string {
  return collapseWs(source.slice(Number(test.start), Number(test.end)));
}

/** Label like `if (!options.sessionId)` from the condition text. */
function ifOpenLabel(source: string, ifNode: AnyNode): string {
  const test = isNode(ifNode.test) ? ifNode.test : null;
  if (test) {
    return `if (${condText(source, test)})`;
  }
  return "if";
}

/** Label like `else` or `else if (x)`. */
function elseOpenLabel(
  _source: string,
  _consequent: AnyNode,
  alternate: AnyNode,
): string {
  if (alternate.type === "IfStatement") {
    const test = isNode(alternate.test) ? alternate.test : null;
    return test ? `else if (${condText(_source, test)})` : "else if";
  }
  return "else";
}

function branchKey(kind: "if" | "else-if" | "else", cond: string): string {
  if (kind === "else") return "else";
  return `${kind}:${cond}`;
}

function statementsOf(node: AnyNode): unknown[] {
  if (node.type === "BlockStatement" && Array.isArray(node.body)) {
    return node.body as unknown[];
  }
  return [node];
}

function collectStepsFromBody(
  source: string,
  body: AnyNode | null | undefined,
  className: string | null,
): CallStep[] {
  if (!body) return [];
  if (body.type === "BlockStatement" && Array.isArray(body.body)) {
    return collectStatements(source, body.body as unknown[], className);
  }
  return collectStatements(source, [body], className);
}

function collectStatements(
  source: string,
  statements: unknown[],
  className: string | null,
): CallStep[] {
  const steps: CallStep[] = [];
  const seenCalls = new Set<string>();

  const addCall = (key: string, start: unknown) => {
    const mark = `${key}:${String(start)}`;
    if (seenCalls.has(mark)) return;
    seenCalls.add(mark);
    steps.push({ type: "call", key });
  };

  const walkExpr = (node: unknown): void => {
    if (!isNode(node)) return;

    const type = node.type;

    if (
      type === "FunctionDeclaration" ||
      type === "FunctionExpression" ||
      type === "ArrowFunctionExpression"
    ) {
      return;
    }

    if (type === "IfStatement") {
      if (isNode(node.test)) walkExpr(node.test);

      const consequent = isNode(node.consequent) ? node.consequent : null;
      const alternate = isNode(node.alternate) ? node.alternate : null;
      const test = isNode(node.test) ? node.test : null;
      const cond = test ? condText(source, test) : "";

      steps.push({
        type: "branch",
        key: branchKey("if", cond),
        label: ifOpenLabel(source, node),
        children: consequent
          ? collectStatements(source, statementsOf(consequent), className)
          : [],
      });

      let prevConsequent = consequent;
      let current = alternate;

      while (current && prevConsequent) {
        if (current.type === "IfStatement") {
          const elseTest = isNode(current.test) ? current.test : null;
          if (elseTest) walkExpr(elseTest);
          const elseCond = elseTest ? condText(source, elseTest) : "";
          const nextConsequent = isNode(current.consequent)
            ? current.consequent
            : null;

          steps.push({
            type: "branch",
            key: branchKey("else-if", elseCond),
            label: elseOpenLabel(source, prevConsequent, current),
            children: nextConsequent
              ? collectStatements(
                  source,
                  statementsOf(nextConsequent),
                  className,
                )
              : [],
          });

          prevConsequent = nextConsequent;
          current = isNode(current.alternate) ? current.alternate : null;
          continue;
        }

        steps.push({
          type: "branch",
          key: branchKey("else", ""),
          label: elseOpenLabel(source, prevConsequent, current),
          children: collectStatements(
            source,
            statementsOf(current),
            className,
          ),
        });
        break;
      }
      return;
    }

    if (type === "CallExpression" && isNode(node.callee)) {
      const key = calleeKey(node.callee, className);
      if (key) addCall(key, node.start);
    } else if (type === "NewExpression" && isNode(node.callee)) {
      const key = calleeKey(node.callee, null);
      if (key) {
        addCall(key.startsWith("new ") ? key : `new ${key}`, node.start);
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) walkExpr(child);
      } else {
        walkExpr(value);
      }
    }
  };

  for (const stmt of statements) {
    walkExpr(stmt);
  }

  return steps;
}

function functionFromNode(
  source: string,
  file: string,
  key: string,
  label: string,
  params: unknown,
  body: AnyNode | null | undefined,
  exported: boolean,
  start: number,
  end: number,
  className: string | null,
): FunctionInfo {
  const paramsLabel = getParamsLabel(params);
  return {
    key,
    label: `${label}${paramsLabel}`,
    file,
    steps: collectStepsFromBody(source, body, className),
    exported,
    start,
    end,
  };
}

function extractFromProgram(
  file: string,
  source: string,
  program: AnyNode,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];

  const handleFunction = (
    node: AnyNode,
    name: string | null,
    exported: boolean,
    className: string | null,
  ) => {
    if (!name) return;
    const key = className ? `${className}.${name}` : name;
    functions.push(
      functionFromNode(
        source,
        file,
        key,
        key,
        node.params,
        isNode(node.body) ? node.body : null,
        exported,
        Number(node.start ?? 0),
        Number(node.end ?? 0),
        className,
      ),
    );
  };

  const handleClass = (node: AnyNode, exported: boolean) => {
    const id = isNode(node.id) ? node.id : null;
    const className = id && id.type === "Identifier" ? String(id.name) : null;
    if (!className) return;

    const body = isNode(node.body) ? node.body : null;
    const elements = body && Array.isArray(body.body) ? body.body : [];

    for (const element of elements) {
      if (!isNode(element)) continue;

      if (
        element.type === "MethodDefinition" ||
        element.type === "TSMethodSignature"
      ) {
        const keyNode = isNode(element.key) ? element.key : null;
        let methodName: string | null = null;
        if (keyNode?.type === "Identifier") methodName = String(keyNode.name);
        if (element.kind === "constructor") methodName = "constructor";
        if (!methodName) continue;

        const fn = isNode(element.value) ? element.value : element;
        const key =
          element.kind === "constructor"
            ? `${className}.constructor`
            : `${className}.${methodName}`;
        const label =
          element.kind === "constructor" ? `new ${className}()` : key;

        functions.push(
          functionFromNode(
            source,
            file,
            key,
            label,
            fn.params ?? element.params,
            isNode(fn.body) ? fn.body : null,
            exported || element.accessibility === "public",
            Number(element.start ?? 0),
            Number(element.end ?? 0),
            className,
          ),
        );
      }

      if (element.type === "PropertyDefinition") {
        const keyNode = isNode(element.key) ? element.key : null;
        const value = isNode(element.value) ? element.value : null;
        if (
          keyNode?.type === "Identifier" &&
          value &&
          (value.type === "ArrowFunctionExpression" ||
            value.type === "FunctionExpression")
        ) {
          const methodName = String(keyNode.name);
          const key = `${className}.${methodName}`;
          functions.push(
            functionFromNode(
              source,
              file,
              key,
              key,
              value.params,
              isNode(value.body) ? value.body : null,
              exported,
              Number(element.start ?? 0),
              Number(element.end ?? 0),
              className,
            ),
          );
        }
      }
    }
  };

  const visitStatement = (node: AnyNode, exported: boolean) => {
    if (node.type === "ExportNamedDeclaration") {
      if (isNode(node.declaration)) visitStatement(node.declaration, true);
      return;
    }

    if (node.type === "ExportDefaultDeclaration") {
      const decl = isNode(node.declaration) ? node.declaration : null;
      if (!decl) return;
      if (decl.type === "FunctionDeclaration") {
        const name =
          isNode(decl.id) && decl.id.type === "Identifier"
            ? String(decl.id.name)
            : "default";
        handleFunction(decl, name, true, null);
        return;
      }
      if (decl.type === "ClassDeclaration" || decl.type === "ClassExpression") {
        handleClass(decl, true);
        return;
      }
      if (
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        handleFunction(decl, "default", true, null);
      }
      return;
    }

    if (node.type === "FunctionDeclaration") {
      const name =
        isNode(node.id) && node.id.type === "Identifier"
          ? String(node.id.name)
          : null;
      handleFunction(node, name, exported, null);
      return;
    }

    if (node.type === "ClassDeclaration") {
      handleClass(node, exported);
      return;
    }

    if (node.type === "VariableDeclaration") {
      const decls = Array.isArray(node.declarations) ? node.declarations : [];
      for (const d of decls) {
        if (!isNode(d)) continue;
        const id = isNode(d.id) ? d.id : null;
        const init = isNode(d.init) ? d.init : null;
        if (!id || id.type !== "Identifier" || !init) continue;
        if (
          init.type === "ArrowFunctionExpression" ||
          init.type === "FunctionExpression"
        ) {
          handleFunction(init, String(id.name), exported, null);
        }
      }
    }
  };

  const body = Array.isArray(program.body) ? program.body : [];
  for (const stmt of body) {
    if (isNode(stmt)) visitStatement(stmt, false);
  }

  return functions;
}

export function extractFunctions(
  file: string,
  source: string,
): FunctionInfo[] {
  const result = parseSync(file, source, {
    sourceType: "module",
    showSemanticErrors: false,
  });

  if (!result.program) return [];
  return extractFromProgram(file, source, result.program as AnyNode);
}

export type FunctionIndex = Map<string, FunctionInfo>;

export function flattenCallKeys(steps: CallStep[]): string[] {
  const keys: string[] = [];
  const walk = (list: CallStep[]) => {
    for (const step of list) {
      if (step.type === "call") keys.push(step.key);
      else walk(step.children);
    }
  };
  walk(steps);
  return keys;
}

export function buildIndex(functions: FunctionInfo[]): FunctionIndex {
  const index: FunctionIndex = new Map();
  for (const fn of functions) {
    if (!index.has(fn.key)) {
      index.set(fn.key, fn);
    }
    if (fn.key.endsWith(".constructor")) {
      const className = fn.key.slice(0, -".constructor".length);
      const newKey = `new ${className}`;
      if (!index.has(newKey)) {
        index.set(newKey, { ...fn, key: newKey, label: `new ${className}()` });
      }
    }
  }
  return index;
}
