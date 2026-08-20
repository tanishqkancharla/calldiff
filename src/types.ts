export type CallNodeKind = "call" | "branch";

/** Source location as shown in editors: `file:line` or `file:line-line`. */
export interface SourceLoc {
  file: string;
  /** 1-based start line */
  line: number;
  /** 1-based end line when the span covers multiple lines */
  endLine?: number;
}

export interface CallNode {
  /** Stable identity used for matching across versions, e.g. "PiService.createAgentSession" */
  key: string;
  /** Display label, e.g. "PiService.createAgentSession" or "if (!options.sessionId)" */
  label: string;
  /** Branches omit the continuing │ rail so arms read as alternate paths */
  kind?: CallNodeKind;
  /**
   * Root: definition location. Children: call-site (or branch keyword) in the parent.
   * Matching/diff keys ignore these fields.
   */
  file?: string;
  line?: number;
  endLine?: number;
  /**
   * Did this call resolve to a definition in the indexed tree?
   *
   * Present on call nodes, absent on branches, which are not calls. Without it
   * a childless leaf is three different facts in one shape: an unresolved
   * callee (builtin, external package, dynamic), a resolved definition whose
   * body was cut off by `--max-depth`, and a resolved definition that makes no
   * calls. The resolver knows which; only the ASCII reader can afford not to.
   */
  resolved?: boolean;
  /** Where that definition is declared. Present iff `resolved`. */
  declaredIn?: SourceLoc;
  /** Children omitted because `--max-depth` was reached, not because there are none. */
  truncated?: true;
  /** Re-entry into a definition already on the stack (rendered as a `⇄` suffix). */
  recursive?: true;
  /**
   * Calls from a branch test / switch subject, as an expression tree
   * (not inlined callee bodies).
   *
   * Not rendered in ASCII (`label` already shows the condition). `reach` walks
   * these so `--to guard` and `--to foo` in `if (guard(foo(x)))` find that
   * `if` line without a sibling next to the branch. Arm calls stay in
   * `children`. Targets inside a condition callee's body still expand through
   * the callee after the branch.
   */
  condition?: CallNode[];
  children: CallNode[];
}

/** One step in a function body: a call, or a conditional branch with nested steps. */
export type CallStep =
  | {
      type: "call";
      key: string;
      /** Call-expression span in the caller file. */
      file?: string;
      line?: number;
      endLine?: number;
      /** Inline children (e.g. JSX component children at the call site). */
      children?: CallStep[];
    }
  | {
      type: "branch";
      key: string;
      label: string;
      /** Branch keyword / condition span. */
      file?: string;
      line?: number;
      endLine?: number;
      /**
       * Calls in the test / subject as an expression tree. Not ASCII children;
       * `reach` walks these. Empty / omitted when the test has no calls
       * (`if (x > 0)`). Nested `if (guard(foo(x)))` is `guard` with child `foo`.
       */
      condition?: CallStep[];
      children: CallStep[];
    };

export type BranchStep = Extract<CallStep, { type: "branch" }>;

/** Attach test/subject calls to a branch without emitting them as siblings. */
export function branchWithCondition(
  branch: BranchStep,
  condition: CallStep[],
): BranchStep {
  if (condition.length === 0) return branch;
  return { ...branch, condition };
}

export type DiffStatus = "same" | "added" | "removed";

export interface DiffNode {
  key: string;
  label: string;
  status: DiffStatus;
  kind?: CallNodeKind;
  file?: string;
  line?: number;
  endLine?: number;
  children: DiffNode[];
}

export interface FunctionInfo {
  /** Stable key: "foo" or "ClassName.method" or "ClassName.constructor" */
  key: string;
  label: string;
  file: string;
  /** Ordered body steps (calls + if/else branches) */
  steps: CallStep[];
  exported: boolean;
  /**
   * Declared inside another function body (a helper or closure) rather than at
   * file top level. Locals only answer calls made from their own file, so a
   * helper never shadows a top-level definition elsewhere in the repo.
   */
  local?: boolean;
  /** Source span for change detection */
  start: number;
  end: number;
  /** 1-based definition line (derived from start/end + source) */
  line?: number;
  endLine?: number;
}

export interface Snapshot {
  kind: "commit" | "worktree";
  /** Commit-ish, or "WORKTREE" */
  ref: string;
}

export interface SnapshotPair {
  from: Snapshot;
  to: Snapshot;
}

export interface SnapshotPairWithPaths extends SnapshotPair {
  paths: string[];
}

export interface SnapshotWithPaths {
  snapshot: Snapshot;
  paths: string[];
}

/** Copy optional location / kind fields onto a tree node without empty spreads. */
export function assignOptionalTreeFields<
  T extends {
    kind?: CallNodeKind;
    file?: string;
    line?: number;
    endLine?: number;
  },
>(
  target: T,
  source: {
    kind?: CallNodeKind;
    file?: string;
    line?: number;
    endLine?: number;
  },
): T {
  if (source.kind) target.kind = source.kind;
  if (source.file) target.file = source.file;
  if (source.line != null) target.line = source.line;
  if (source.endLine != null) target.endLine = source.endLine;
  return target;
}

/** Copy call-resolution fields that `assignOptionalTreeFields` does not own. */
export function assignOptionalResolutionFields(
  target: CallNode,
  source: CallNode,
): CallNode {
  if (source.resolved != null) target.resolved = source.resolved;
  if (source.declaredIn) target.declaredIn = source.declaredIn;
  if (source.truncated) target.truncated = source.truncated;
  if (source.recursive) target.recursive = source.recursive;
  if (source.condition?.length) target.condition = source.condition;
  return target;
}

export type CliMode = "diff" | "tree" | "reach";

export interface DiffTreeResult {
  entry: string;
  /** Colorless ASCII rendering of this entry's diff tree. */
  ascii: string;
  tree: DiffNode;
}

export interface DiffResult {
  mode: "diff";
  from: string;
  to: string;
  message?: string;
  trees: DiffTreeResult[];
  /** Full human-oriented ASCII output (may include ANSI colors). */
  ascii: string;
}

export interface TreeEntryResult {
  entry: string;
  /** Colorless ASCII rendering of this entry's call tree. */
  ascii: string;
  tree: CallNode;
}

export interface TreeResult {
  mode: "tree";
  ref: string;
  trees: TreeEntryResult[];
  /** Full human-oriented ASCII output (may include ANSI colors). */
  ascii: string;
}

export interface ReachPathResult {
  /** Colorless ASCII rendering of this path. */
  ascii: string;
  tree: CallNode;
}

export interface ReachResult {
  mode: "reach";
  ref: string;
  from: string;
  to: string;
  message?: string;
  paths: ReachPathResult[];
  /** Full human-oriented ASCII output (may include ANSI colors). */
  ascii: string;
}
