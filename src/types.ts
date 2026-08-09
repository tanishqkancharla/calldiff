export type CallNodeKind = "call" | "branch";

export interface CallNode {
  /** Stable identity used for matching across versions, e.g. "PiService.createAgentSession" */
  key: string;
  /** Display label, e.g. "PiService.createAgentSession" or "if (!options.sessionId)" */
  label: string;
  /** Branches omit the continuing │ rail so arms read as alternate paths */
  kind?: CallNodeKind;
  children: CallNode[];
}

/** One step in a function body: a call, or a conditional branch with nested steps. */
export type CallStep =
  | {
      type: "call";
      key: string;
      /** Inline children (e.g. JSX component children at the call site). */
      children?: CallStep[];
    }
  | {
      type: "branch";
      key: string;
      label: string;
      children: CallStep[];
    };

export type DiffStatus = "same" | "added" | "removed";

export interface DiffNode {
  key: string;
  label: string;
  status: DiffStatus;
  kind?: CallNodeKind;
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
  /** Source span for change detection */
  start: number;
  end: number;
}

export interface Snapshot {
  kind: "commit" | "worktree";
  /** Commit-ish, or "WORKTREE" */
  ref: string;
}

export type CliMode = "diff" | "show";

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

export interface ShowTreeResult {
  entry: string;
  /** Colorless ASCII rendering of this entry's call tree. */
  ascii: string;
  tree: CallNode;
}

export interface ShowResult {
  mode: "show";
  ref: string;
  trees: ShowTreeResult[];
  /** Full human-oriented ASCII output (may include ANSI colors). */
  ascii: string;
}
