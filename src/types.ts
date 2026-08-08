export type CallNodeKind = "call" | "branch";

/**
 * Where a node lives in source: the call/branch *site* (the line where the
 * call is written in its caller's file), or the definition site for tree
 * roots. Lines are 1-based. In a DiffNode, "removed" nodes reference the
 * `from` snapshot's file content; all other statuses reference `to`.
 */
export interface SourceRef {
  file: string;
  line: number;
}

export interface CallNode {
  /** Stable identity used for matching across versions, e.g. "PiService.createAgentSession" */
  key: string;
  /** Display label, e.g. "PiService.createAgentSession" or "if (!options.sessionId)" */
  label: string;
  /** Branches omit the continuing │ rail so arms read as alternate paths */
  kind?: CallNodeKind;
  site?: SourceRef;
  children: CallNode[];
}

/** One step in a function body: a call, or a conditional branch with nested steps. */
export type CallStep =
  | { type: "call"; key: string; site?: SourceRef }
  | {
      type: "branch";
      key: string;
      label: string;
      site?: SourceRef;
      children: CallStep[];
    };

export type DiffStatus = "same" | "added" | "removed";

export interface DiffNode {
  key: string;
  label: string;
  status: DiffStatus;
  kind?: CallNodeKind;
  /** "removed" → from-snapshot coordinates; "added"/"same" → to-snapshot. */
  site?: SourceRef;
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
  /** 1-based line of the definition, for root-node anchors */
  startLine: number;
}

export interface Snapshot {
  kind: "commit" | "worktree";
  /** Commit-ish, or "WORKTREE" */
  ref: string;
}

export interface CliOptions {
  from?: string;
  to?: string;
  entries: string[];
  paths: string[];
  cwd: string;
  maxDepth: number;
  help: boolean;
  /** Emit the diff trees as JSON (with source anchors) instead of ASCII. */
  json: boolean;
  /** Append file:line to each rendered row. */
  locations: boolean;
}
