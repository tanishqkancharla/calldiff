/**
 * Perl callable extraction (tree-sitter-perl).
 *
 * Quirks: paren-less calls with args parse as
 * ambiguous_function_call_expression; zero-arg ones as a bare bareword
 * statement. `package Foo;` scopes until the next package statement,
 * `package Foo { }` only its block.
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

type Scope = {
  readonly file: string;
  readonly packageName: string | null;
};

// "My::App::log" -> { pkg: "My::App", name: "log" }
// "foo" -> { pkg: null, name: "foo" }
function splitQualified(text: string) {
  const idx = text.lastIndexOf("::");
  if (idx === -1) return { pkg: null, name: text };

  const pkg = text.slice(0, idx);
  const name = text.slice(idx + 2);

  return { pkg, name };
}

// ("Foo::Bar", "baz") -> "Foo.Bar.baz"
// (null, "bar") -> "bar"
function packageKey(packageName: string | null, name: string) {
  if (packageName === null) return name;

  const normalizedPackage = packageName.replaceAll("::", ".");
  return `${normalizedPackage}.${name}`;
}

function normalizePackage(name: string | null) {
  return name === "main" ? null : name;
}

// ("Thing", "new") -> "new Thing" (constructor alias, skipped by entry inference)
// ("Thing", "run") -> "Thing.run"
function methodKey(packageName: string | null, name: string) {
  if (packageName !== null && name === "new") {
    return `new ${packageName.replaceAll("::", ".")}`;
  }

  return packageKey(packageName, name);
}

const SIGILS = new Map([
  ["scalar", "$"],
  ["array", "@"],
  ["hash", "%"],
]);

function varWithSigil(node: SyntaxNode) {
  const sigil = SIGILS.get(node.type);
  const name = childByType(node, "varname")?.text;
  if (sigil === undefined || name === undefined) return null;

  return `${sigil}${name}`;
}

function isSelfLike(name: string) {
  return name === "$self" || name === "$class";
}

// ($self, $x, @rest) nodes -> ["$x", "@rest"]
function paramNames(variables: SyntaxNode[]) {
  return variables
    .map((variable) => varWithSigil(variable))
    .filter((name) => name !== null)
    .filter((name) => !isSelfLike(name));
}

// signature ($x, $y = 1, @rest) -> ["$x", "$y", "@rest"]
function signatureParams(signature: SyntaxNode) {
  return namedChildren(signature).map((parameter) => {
    const variable = namedChildren(parameter).at(0);
    if (variable === undefined) return "_";

    return varWithSigil(variable) ?? "_";
  });
}

// `my <left> = <right>;` statement -> { left, right }
function assignmentOf(statement: SyntaxNode) {
  if (statement.type !== "expression_statement") return null;

  const assignment = namedChildren(statement).at(0);
  if (assignment?.type !== "assignment_expression") return null;

  const sides = namedChildren(assignment);
  const left = sides.at(0);
  const right = sides.at(1);
  if (left?.type !== "variable_declaration" || right === undefined) return null;

  return { left, right };
}

// `shift`, `shift @_` -> true, `shift @queue` -> false
function shiftsArgs(right: SyntaxNode) {
  if (right.type !== "func1op_call_expression") return false;
  if (right.child(0)?.type !== "shift") return false;

  const operand = namedChildren(right).at(0);
  if (operand === undefined) return true;

  return (
    operand.type === "array" && childByType(operand, "varname")?.text === "_"
  );
}

// [`my ($self, $x) = @_;`, ...] -> ["$x"]
// [`my $a = shift;`, `my $b = shift;`, ...] -> ["$a", "$b"]
function conventionalParams(statements: SyntaxNode[]): string[] {
  const names: string[] = [];

  for (const statement of statements) {
    if (statement.type === "comment") continue;

    const assignment = assignmentOf(statement);
    if (assignment === null) break;

    const { left, right } = assignment;

    const unpacksArgs =
      right.type === "array" && childByType(right, "varname")?.text === "_";
    if (unpacksArgs) {
      names.push(...paramNames(namedChildren(left)));
      break;
    }

    if (!shiftsArgs(right)) break;

    const declared = namedChildren(left).at(0);
    if (declared !== undefined) names.push(...paramNames([declared]));
  }

  return names;
}

function formatParams(names: string[]) {
  return `(${names.join(", ")})`;
}

function getParamsLabel(node: SyntaxNode, body: SyntaxNode | null) {
  const signature = childByType(node, "signature");

  if (signature !== null) {
    const names = signatureParams(signature).filter((n) => !isSelfLike(n));
    return formatParams(names);
  }
  if (body === null) return "()";

  const names = conventionalParams(namedChildren(body));
  return formatParams(names);
}

// ("foo", "Pkg") -> "Pkg.foo"
// ("Util::log", any) -> "Util.log"
function nameKey(text: string, packageName: string | null) {
  const { pkg, name } = splitQualified(text);
  if (pkg !== null) return packageKey(normalizePackage(pkg), name);

  return packageKey(packageName, name);
}

// foo() -> "foo" | "Pkg.foo"
// &foo() -> "foo"
function calleeKey(node: SyntaxNode, packageName: string | null) {
  const fn = childByType(node, "function");
  if (fn === null) return null;

  const text = childByType(fn, "varname")?.text ?? fn.text;
  if (text === "" || text.startsWith("$")) return null;

  return nameKey(text, packageName);
}

// $self->m -> "Pkg.m"
// Foo::Bar->m -> "Foo.Bar.m"
function methodCallKey(node: SyntaxNode, packageName: string | null) {
  const receiver = namedChildren(node).at(0);
  const method = childByType(node, "method");
  if (receiver === undefined || method === null) return null;

  const rawName = method.text;
  if (rawName === "" || rawName.startsWith("$")) return null; // computed: $obj->$m

  if (rawName.startsWith("SUPER::")) {
    return methodKey(packageName, rawName.slice("SUPER::".length));
  }

  const { pkg: methodPkg, name: prop } = splitQualified(rawName);
  if (methodPkg !== null) return methodKey(normalizePackage(methodPkg), prop);

  switch (receiver.type) {
    case "scalar": {
      const name = childByType(receiver, "varname")?.text;
      if (name === undefined) return null;
      if (name === "self" || name === "class") {
        return methodKey(packageName, prop);
      }
      return `${name}.${prop}`;
    }
    case "bareword":
      return methodKey(normalizePackage(receiver.text), prop);
    default:
      // __PACKAGE__ and chained/complex receivers: package-scope fallback
      return methodKey(packageName, prop);
  }
}

// `new Foo(1)`, `new Foo` target -> "Foo", else null
function constructedClass(target: SyntaxNode) {
  let text: string | null = null;
  if (target.type === "bareword") text = target.text;
  if (target.type === "function_call_expression") {
    text = childByType(target, "function")?.text ?? null;
  }
  if (text === null || text === "" || text.startsWith("$")) return null;

  return text;
}

function keywordToken(node: SyntaxNode, keywords: string[]) {
  const token = node.children.find((c) => !c.isNamed && keywords.includes(c.type));
  return token?.type ?? null;
}

const NON_CONDITION_TYPES = new Set(["block", "elsif", "else", "comment"]);

function conditionOf(node: SyntaxNode) {
  const condition = namedChildren(node).find((c) => !NON_CONDITION_TYPES.has(c.type));
  return condition ?? null;
}

const TRY_KEYWORDS = new Set(["try", "catch", "finally"]);

function callStep(scope: Scope, key: string, node: SyntaxNode) {
  return {
    type: "call",
    key,
    ...locFromNode(scope.file, node),
  } satisfies CallStep;
}

function branchStep(
  scope: Scope,
  key: string,
  label: string,
  cond: SyntaxNode | null,
  anchor: SyntaxNode,
  children: CallStep[],
) {
  const text = cond === null ? "" : collapseWs(cond.text);

  return {
    type: "branch",
    key: text === "" ? key : `${key}:${text}`,
    label: text === "" ? label : `${label} ${text}`,
    ...locFromNode(scope.file, cond ?? anchor),
    children,
  } satisfies CallStep;
}

function collectStatements(scope: Scope, statements: SyntaxNode[]) {
  return statements.flatMap((statement) => collectNode(scope, statement));
}

function collectBlock(scope: Scope, block: SyntaxNode | null) {
  if (block === null) return [];
  return collectStatements(scope, namedChildren(block));
}

// zero-arg paren-less call (`helper;`, `helper if $x;`) -> lone bareword
function collectExpression(scope: Scope, node: SyntaxNode): CallStep[] {
  if (node.type === "bareword") {
    return [callStep(scope, nameKey(node.text, scope.packageName), node)];
  }

  return collectNode(scope, node);
}

function collectNode(scope: Scope, node: SyntaxNode): CallStep[] {
  switch (node.type) {
    case "subroutine_declaration_statement":
    case "method_declaration_statement":
    case "anonymous_subroutine_expression":
      return [];
    case "conditional_statement":
      return collectConditional(scope, node);
    case "postfix_conditional_expression":
      return collectPostfixConditional(scope, node);
    case "try_statement":
      return collectTryStatement(scope, node);
    case "eval_expression":
      return collectEval(scope, node);
    case "function_call_expression":
    case "ambiguous_function_call_expression":
      return collectFunctionCall(scope, node);
    case "method_call_expression":
      return collectMethodCall(scope, node);
    // map, grep, sort block: callback, not caller body
    case "map_grep_expression":
    case "sort_expression":
      return namedChildren(node)
        .filter((c) => c.type !== "block")
        .flatMap((c) => collectNode(scope, c));
    case "expression_statement":
      return namedChildren(node).flatMap((c) => collectExpression(scope, c));
    case "assignment_expression": {
      const kids = namedChildren(node);
      const right = kids.at(-1);
      return kids.flatMap((c) =>
        c === right ? collectExpression(scope, c) : collectNode(scope, c),
      );
    }
    case "return_expression":
      return namedChildren(node).flatMap((c) => collectExpression(scope, c));
    default:
      return collectStatements(scope, namedChildren(node));
  }
}

function collectConditional(scope: Scope, node: SyntaxNode) {
  const keyword = keywordToken(node, ["if", "unless"]) ?? "if";
  const head = branchStep(
    scope,
    keyword,
    keyword,
    conditionOf(node),
    node,
    collectBlock(scope, childByType(node, "block")),
  );
  const clauses = namedChildren(node).flatMap((clause) =>
    collectClause(scope, clause),
  );

  return [head, ...clauses];
}

// elsif chains nest in the CST
function collectClause(scope: Scope, clause: SyntaxNode): CallStep[] {
  if (clause.type === "elsif") {
    const head = branchStep(
      scope,
      "else-if",
      "elsif",
      conditionOf(clause),
      clause,
      collectBlock(scope, childByType(clause, "block")),
    );
    const nested = namedChildren(clause).flatMap((next) =>
      collectClause(scope, next),
    );

    return [head, ...nested];
  }
  if (clause.type === "else") {
    const body = collectBlock(scope, childByType(clause, "block"));
    return [branchStep(scope, "else", "else", null, clause, body)];
  }

  return [];
}

function collectPostfixConditional(scope: Scope, node: SyntaxNode) {
  const keyword = keywordToken(node, ["if", "unless"]) ?? "if";
  const kids = namedChildren(node).filter((c) => c.type !== "comment");
  const expression = kids.at(0);
  const condition = kids.at(1) ?? null;
  const children =
    expression === undefined ? [] : collectExpression(scope, expression);

  return [branchStep(scope, keyword, keyword, condition, node, children)];
}

// keyword tokens precede blocks; catch var left out of keys (not rename-stable)
function collectTryStatement(scope: Scope, node: SyntaxNode) {
  const children = node.children;

  return children.flatMap((child, index) => {
    if (child.type !== "block") return [];

    const keyword = children
      .slice(0, index)
      .reverse()
      .find((c) => !c.isNamed && TRY_KEYWORDS.has(c.type));
    const kind = keyword?.type ?? "try";
    const body = collectStatements(scope, namedChildren(child));

    return [branchStep(scope, kind, kind, null, keyword ?? node, body)];
  });
}

// eval { ... } -> "try" branch; string eval (no block) -> no branch
function collectEval(scope: Scope, node: SyntaxNode) {
  const block = childByType(node, "block");
  if (block === null) return collectStatements(scope, namedChildren(node));

  const body = collectBlock(scope, block);

  return [branchStep(scope, "try", "eval", null, node, body)];
}

function collectFunctionCall(scope: Scope, node: SyntaxNode) {
  const fn = childByType(node, "function");
  const io = childByType(node, "indirect_object");
  const fnText = fn?.text;

  // legacy indirect-object constructor (always paren-less): `new Foo(1)` -> `Foo->new(1)`
  if (node.type === "ambiguous_function_call_expression" && fnText === "new") {
    const target = namedChildren(node).find((c) => c !== fn);
    const cls = target === undefined ? null : constructedClass(target);
    if (target !== undefined && cls !== null) {
      const constructorArgSteps =
        target.type === "function_call_expression"
          ? namedChildren(target)
              .filter((c) => c.type !== "function")
              .flatMap((c) => collectNode(scope, c))
          : [];
      return [
        callStep(scope, methodKey(normalizePackage(cls), "new"), node),
        ...constructorArgSteps,
      ];
    }
  }

  // indirect_object block (`helper { ... } 3`): callback, not caller body
  const key = calleeKey(node, scope.packageName);
  const argumentSteps = namedChildren(node)
    .filter((c) => c !== fn && c !== io)
    .flatMap((c) => collectNode(scope, c));

  if (key === null) return argumentSteps;

  return [callStep(scope, key, node), ...argumentSteps];
}

function collectMethodCall(scope: Scope, node: SyntaxNode) {
  const method = childByType(node, "method");
  const key = methodCallKey(node, scope.packageName);
  const receiverAndArgSteps = namedChildren(node)
    .filter((c) => c !== method)
    .flatMap((c) => collectNode(scope, c));

  if (key === null) return receiverAndArgSteps;

  return [callStep(scope, key, node), ...receiverAndArgSteps];
}

// sub greet in Foo -> { key: "Foo.greet", label: "Foo.greet($name)", ... }
// sub new in Foo -> primary "Foo.new" plus constructor alias "new Foo"
function functionInfos(
  file: string,
  node: SyntaxNode,
  packageName: string | null,
): FunctionInfo[] {
  const nameNode = childByType(node, "bareword");
  if (nameNode === null) return [];

  const body = childByType(node, "block");

  const { pkg: inlinePkg, name } = splitQualified(nameNode.text);
  const pkg = inlinePkg === null ? packageName : normalizePackage(inlinePkg);
  const key = packageKey(pkg, name);
  const isConstructor = pkg !== null && name === "new";
  const labelBase = isConstructor ? methodKey(pkg, name) : key;

  const info = {
    key,
    label: `${labelBase}${getParamsLabel(node, body)}`,
    file,
    steps: collectBlock({ file, packageName: pkg }, body),
    exported: !name.startsWith("_"),
    start: node.startIndex,
    end: node.endIndex,
  } satisfies FunctionInfo;

  if (!isConstructor) return [info];

  return [info, { ...info, key: labelBase }];
}

// [`package Foo;`, `sub a`, `sub b`] -> [Foo.a, Foo.b]
// [`package Foo { sub a }`, `sub b`] -> [Foo.a, b]
function definitionsIn(
  file: string,
  statements: SyntaxNode[],
  packageName: string | null,
): FunctionInfo[] {
  const out: FunctionInfo[] = [];
  let currentPackage = packageName;

  for (const statement of statements) {
    if (
      statement.type === "package_statement" ||
      statement.type === "class_statement"
    ) {
      const declared = normalizePackage(
        childByType(statement, "package")?.text ?? null,
      );
      const block = childByType(statement, "block");

      if (block === null) {
        currentPackage = declared;
      } else {
        out.push(...definitionsIn(file, namedChildren(block), declared));
      }
      continue;
    }

    if (
      statement.type === "subroutine_declaration_statement" ||
      statement.type === "method_declaration_statement"
    ) {
      out.push(...functionInfos(file, statement, currentPackage));
    }
  }

  return out;
}

function extractFromTree(file: string, _source: string, tree: Tree) {
  return definitionsIn(file, namedChildren(tree.rootNode), null);
}

export const perlExtractor: LanguageExtractor = {
  id: "perl",
  extensions: [".pl", ".pm", ".t"],
  grammarPackage: "tree-sitter-perl",
  extract: extractFromTree,
};
