import { buildCallTree, resolveEntry } from "./calltree.js";
import { buildIndex, extractFunctions } from "./extract.js";
import {
  assertGitRepo,
  describeSnapshot,
  listTsFiles,
  readSnapshotFile,
  resolveSnapshot,
  resolveSnapshots,
  verifyCommit,
} from "./git.js";
import { diffEntry, inferEntries } from "./infer.js";
import { renderDiff, renderTree } from "./render.js";
import type {
  CallNode,
  DiffNode,
  DiffResult,
  ShowResult,
  Snapshot,
} from "./types.js";
import type { FunctionIndex } from "./extract.js";

export type DiffRunOptions = {
  from?: string;
  to?: string;
  entries?: string[];
  paths?: string[];
  cwd?: string;
  maxDepth?: number;
  /** When false, skip ANSI colors in ascii output. Default: true */
  color?: boolean;
};

export type ShowRunOptions = {
  ref?: string;
  entries: string[];
  paths?: string[];
  cwd?: string;
  maxDepth?: number;
  color?: boolean;
};

function loadIndex(
  cwd: string,
  snapshot: Snapshot,
  pathFilters: string[],
): FunctionIndex {
  const files = listTsFiles(cwd, snapshot, pathFilters);
  const all = [];
  for (const file of files) {
    const source = readSnapshotFile(cwd, snapshot, file);
    if (source === null) continue;
    try {
      all.push(...extractFunctions(file, source));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`warn: failed to parse ${file} @ ${snapshot.ref}: ${message}`);
    }
  }
  return buildIndex(all);
}

function resolveShowEntries(index: FunctionIndex, explicit: string[]): string[] {
  const resolved: string[] = [];
  for (const entry of explicit) {
    const key = resolveEntry(entry, index);
    if (!key) {
      throw new Error(`Entrypoint not found: ${entry}`);
    }
    if (!resolved.includes(key)) resolved.push(key);
  }
  return resolved;
}

function serializeCallNode(node: CallNode): CallNode {
  return {
    key: node.key,
    label: node.label,
    ...(node.kind ? { kind: node.kind } : {}),
    children: node.children.map(serializeCallNode),
  };
}

function serializeDiffNode(node: DiffNode): DiffNode {
  return {
    key: node.key,
    label: node.label,
    status: node.status,
    ...(node.kind ? { kind: node.kind } : {}),
    children: node.children.map(serializeDiffNode),
  };
}

/** Diff call stacks between two snapshots. Returns structured data + ASCII. */
export function runDiff(options: DiffRunOptions = {}): DiffResult {
  const cwd = options.cwd ?? process.cwd();
  const maxDepth = options.maxDepth ?? 12;
  const entriesOpt = options.entries ?? [];
  const paths = options.paths ?? [];
  const color = options.color !== false;

  assertGitRepo(cwd);

  const { from, to } = resolveSnapshots(options.from, options.to);
  if (from.kind === "commit") verifyCommit(cwd, from.ref);
  if (to.kind === "commit") verifyCommit(cwd, to.ref);

  const before = loadIndex(cwd, from, paths);
  const after = loadIndex(cwd, to, paths);

  const entries = inferEntries(before, after, entriesOpt, maxDepth);

  const fromLabel = describeSnapshot(from);
  const toLabel = describeSnapshot(to);

  if (entries.length === 0) {
    const message = `No callstack changes between ${fromLabel} and ${toLabel}.`;
    return {
      mode: "diff",
      from: fromLabel,
      to: toLabel,
      message,
      trees: [],
      ascii: message,
    };
  }

  const trees: DiffResult["trees"] = [];
  const asciiParts: string[] = [
    `calldiff ${fromLabel} → ${toLabel}`,
    "",
  ];

  for (const entry of entries) {
    const diff = diffEntry(entry, before, after, maxDepth);
    if (!diff) continue;
    const ascii = renderDiff(diff, { color });
    trees.push({
      entry,
      ascii: renderDiff(diff, { color: false }),
      tree: serializeDiffNode(diff),
    });
    if (asciiParts.length > 2) asciiParts.push("");
    asciiParts.push(ascii);
  }

  if (trees.length === 0) {
    const message = "No callstack changes for inferred entrypoints.";
    return {
      mode: "diff",
      from: fromLabel,
      to: toLabel,
      message,
      trees: [],
      ascii: `${asciiParts[0]}\n\n${message}`,
    };
  }

  return {
    mode: "diff",
    from: fromLabel,
    to: toLabel,
    trees,
    ascii: asciiParts.join("\n"),
  };
}

/** Show call tree(s) for entrypoint(s) from a single snapshot. */
export function runShow(options: ShowRunOptions): ShowResult {
  const cwd = options.cwd ?? process.cwd();
  const maxDepth = options.maxDepth ?? 12;
  const paths = options.paths ?? [];
  const color = options.color !== false;

  assertGitRepo(cwd);

  const snapshot = resolveSnapshot(options.ref);
  if (snapshot.kind === "commit") verifyCommit(cwd, snapshot.ref);

  const index = loadIndex(cwd, snapshot, paths);
  const entries = resolveShowEntries(index, options.entries);
  const refLabel = describeSnapshot(snapshot);

  const trees: ShowResult["trees"] = [];
  const asciiParts: string[] = [`calldiff show ${refLabel}`, ""];

  for (const entry of entries) {
    const tree = buildCallTree(entry, index, maxDepth);
    const ascii = renderTree(tree, { color });
    trees.push({
      entry,
      ascii: renderTree(tree, { color: false }),
      tree: serializeCallNode(tree),
    });
    if (asciiParts.length > 2) asciiParts.push("");
    asciiParts.push(ascii);
  }

  return {
    mode: "show",
    ref: refLabel,
    trees,
    ascii: asciiParts.join("\n"),
  };
}
