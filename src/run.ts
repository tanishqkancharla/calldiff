import { buildCallTree, resolveEntry } from "./calltree.js";
import { buildIndex, extractFunctions } from "./extract.js";
import {
  assertGitRepo,
  describeSnapshot,
  listTsFiles,
  readSnapshotFile,
  resolveDiffSnapshotsAndPaths,
  resolveSnapshotAndPaths,
  verifyCommit,
} from "./git.js";
import { diffEntry, inferEntries } from "./infer.js";
import { findReachPaths } from "./reach.js";
import { renderDiff, renderTree } from "./render.js";
import type {
  CallNode,
  DiffNode,
  DiffResult,
  ReachResult,
  Snapshot,
  TreeResult,
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
  /** When true, append file:line suffixes in ascii. Default: false */
  locs?: boolean;
};

export type TreeRunOptions = {
  ref?: string;
  entries: string[];
  paths?: string[];
  cwd?: string;
  maxDepth?: number;
  color?: boolean;
  locs?: boolean;
};

export type ReachRunOptions = {
  ref?: string;
  /** Start symbol(s). */
  entries: string[];
  /** Target symbol to reach. */
  to: string;
  paths?: string[];
  cwd?: string;
  maxDepth?: number;
  color?: boolean;
  locs?: boolean;
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

function resolveEntries(index: FunctionIndex, explicit: string[]): string[] {
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
    ...(node.file ? { file: node.file } : {}),
    ...(node.line != null ? { line: node.line } : {}),
    ...(node.endLine != null ? { endLine: node.endLine } : {}),
    children: node.children.map(serializeCallNode),
  };
}

function serializeDiffNode(node: DiffNode): DiffNode {
  return {
    key: node.key,
    label: node.label,
    status: node.status,
    ...(node.kind ? { kind: node.kind } : {}),
    ...(node.file ? { file: node.file } : {}),
    ...(node.line != null ? { line: node.line } : {}),
    ...(node.endLine != null ? { endLine: node.endLine } : {}),
    children: node.children.map(serializeDiffNode),
  };
}

/** Diff call stacks between two snapshots. Returns structured data + ASCII. */
export function runDiff(options: DiffRunOptions = {}): DiffResult {
  const cwd = options.cwd ?? process.cwd();
  const maxDepth = options.maxDepth ?? 12;
  const entriesOpt = options.entries ?? [];
  const color = options.color !== false;
  const locs = options.locs === true;

  assertGitRepo(cwd);

  const {
    from,
    to,
    paths: resolvedPaths,
  } = resolveDiffSnapshotsAndPaths(
    cwd,
    options.from,
    options.to,
    options.paths ?? [],
  );
  if (from.kind === "commit") verifyCommit(cwd, from.ref);
  if (to.kind === "commit") verifyCommit(cwd, to.ref);

  const before = loadIndex(cwd, from, resolvedPaths);
  const after = loadIndex(cwd, to, resolvedPaths);

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
    `calldiff diff ${fromLabel} → ${toLabel}`,
    "",
  ];

  for (const entry of entries) {
    const diff = diffEntry(entry, before, after, maxDepth);
    if (!diff) continue;
    const ascii = renderDiff(diff, { color, locs });
    trees.push({
      entry,
      ascii: renderDiff(diff, { color: false, locs }),
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

/** View call tree(s) for entrypoint(s) from a single snapshot. */
export function runTree(options: TreeRunOptions): TreeResult {
  const cwd = options.cwd ?? process.cwd();
  const maxDepth = options.maxDepth ?? 12;
  const color = options.color !== false;
  const locs = options.locs === true;

  assertGitRepo(cwd);

  const { snapshot, paths } = resolveSnapshotAndPaths(
    cwd,
    options.ref,
    options.paths ?? [],
  );
  if (snapshot.kind === "commit") verifyCommit(cwd, snapshot.ref);

  const index = loadIndex(cwd, snapshot, paths);
  const entries = resolveEntries(index, options.entries);
  const refLabel = describeSnapshot(snapshot);

  const trees: TreeResult["trees"] = [];
  const asciiParts: string[] = [`calldiff tree ${refLabel}`, ""];

  for (const entry of entries) {
    const tree = buildCallTree(entry, index, maxDepth);
    const ascii = renderTree(tree, { color, locs });
    trees.push({
      entry,
      ascii: renderTree(tree, { color: false, locs }),
      tree: serializeCallNode(tree),
    });
    if (asciiParts.length > 2) asciiParts.push("");
    asciiParts.push(ascii);
  }

  return {
    mode: "tree",
    ref: refLabel,
    trees,
    ascii: asciiParts.join("\n"),
  };
}

/** Find all call paths from entrypoint(s) to a target symbol. */
export function runReach(options: ReachRunOptions): ReachResult {
  const cwd = options.cwd ?? process.cwd();
  const maxDepth = options.maxDepth ?? 12;
  const color = options.color !== false;
  const locs = options.locs === true;

  assertGitRepo(cwd);

  const { snapshot, paths } = resolveSnapshotAndPaths(
    cwd,
    options.ref,
    options.paths ?? [],
  );
  if (snapshot.kind === "commit") verifyCommit(cwd, snapshot.ref);

  const index = loadIndex(cwd, snapshot, paths);
  const entries = resolveEntries(index, options.entries);
  const targetKey = resolveEntry(options.to, index);
  if (!targetKey) {
    throw new Error(`Target not found: ${options.to}`);
  }
  const refLabel = describeSnapshot(snapshot);

  const pathResults: ReachResult["paths"] = [];
  for (const entry of entries) {
    const found = findReachPaths(entry, targetKey, index, maxDepth);
    for (const path of found) {
      pathResults.push({
        ascii: renderTree(path, { color: false, locs }),
        tree: serializeCallNode(path),
      });
    }
  }

  const fromLabel =
    entries.length === 1 ? entries[0]! : entries.join(", ");
  const header = `calldiff reach ${refLabel}: ${fromLabel} → ${targetKey}`;

  if (pathResults.length === 0) {
    const message = `No paths from ${fromLabel} to ${targetKey}.`;
    return {
      mode: "reach",
      ref: refLabel,
      from: fromLabel,
      to: targetKey,
      message,
      paths: [],
      ascii: `${header}\n\n${message}`,
    };
  }

  const asciiParts: string[] = [header, ""];
  for (let i = 0; i < pathResults.length; i++) {
    const path = pathResults[i]!;
    if (i > 0) asciiParts.push("");
    if (pathResults.length > 1) {
      asciiParts.push(`# path ${i + 1}`);
    }
    asciiParts.push(renderTree(path.tree, { color, locs }));
  }

  return {
    mode: "reach",
    ref: refLabel,
    from: fromLabel,
    to: targetKey,
    paths: pathResults,
    ascii: asciiParts.join("\n"),
  };
}
