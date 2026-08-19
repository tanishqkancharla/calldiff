import {
  buildCallTreeFromInfo,
  exportsInFile,
  resolveEntry,
  resolveEntrypointFile,
  indexedFiles,
} from "./calltree.js";
import { buildIndex, extractCached } from "./extract.js";
import {
  assertGitRepo,
  describeSnapshot,
  listSnapshotFiles,
  resolveDiffSnapshotsAndPaths,
  resolveSnapshotAndPaths,
  verifyCommit,
  visitCommitBlobs,
  visitWorktreeFiles,
} from "./git.js";
import {
  diffEntry,
  diffPinnedEntry,
  inferEntries,
  resolveExplicitDiffEntries,
} from "./infer.js";
import { collectPathsTo, findReachPaths } from "./reach.js";
import { renderDiff, renderTree } from "./render.js";
import type { ExtractionCache, FunctionIndex } from "./extract.js";
import type { SnapshotFile } from "./git.js";
import type {
  CallNode,
  DiffNode,
  DiffResult,
  FunctionInfo,
  ReachResult,
  Snapshot,
  TreeResult,
} from "./types.js";
import { assignOptionalTreeFields } from "./types.js";

export type DiffRunOptions = {
  from?: string;
  to?: string;
  /** Symbol entrypoints (`-e`). */
  entries?: string[];
  /** File entrypoints (`--file`): expand to that file's exports. */
  files?: string[];
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
  entries?: string[];
  files?: string[];
  paths?: string[];
  cwd?: string;
  maxDepth?: number;
  color?: boolean;
  locs?: boolean;
};

export type ReachRunOptions = {
  ref?: string;
  /** Start symbol(s). */
  entries?: string[];
  /** Start file(s): every export in the file. */
  files?: string[];
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
  cache: ExtractionCache = new Map(),
): FunctionIndex {
  const files = listSnapshotFiles(cwd, snapshot, pathFilters);
  const extracted = new Map<string, FunctionInfo[]>();
  const extract = (file: SnapshotFile, source: string): void => {
    try {
      extracted.set(file.path, extractCached(file.path, source, cache));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `warn: failed to parse ${file.path} @ ${snapshot.ref}: ${message}`,
      );
    }
  };

  if (snapshot.kind === "worktree") {
    visitWorktreeFiles(cwd, files, extract);
  } else {
    const filesByOid = new Map<string, SnapshotFile[]>();
    for (const file of files) {
      if (!file.oid) continue;
      const matches = filesByOid.get(file.oid) ?? [];
      matches.push(file);
      filesByOid.set(file.oid, matches);
    }
    visitCommitBlobs(cwd, files, (oid, source) => {
      for (const file of filesByOid.get(oid) ?? []) extract(file, source);
    });
  }

  const functions: FunctionInfo[] = [];
  for (const file of files) {
    functions.push(...(extracted.get(file.path) ?? []));
  }
  return buildIndex(functions);
}

/** Resolve `-e` symbols to concrete definitions. */
function resolveSymbolInfos(
  index: FunctionIndex,
  symbols: string[],
): FunctionInfo[] {
  const resolved: FunctionInfo[] = [];
  const seen = new Set<string>();

  for (const entry of symbols) {
    const key = resolveEntry(entry, index);
    if (!key) {
      throw new Error(`Entrypoint not found: ${entry}`);
    }
    const info = index.get(key);
    if (!info) {
      throw new Error(`Entrypoint not found: ${entry}`);
    }
    const id = `${info.file}\0${info.key}\0${info.line ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(info);
  }

  return resolved;
}

/** Resolve `--file` paths to exported definitions (file-pinned). */
function resolveFileInfos(
  index: FunctionIndex,
  files: string[],
): FunctionInfo[] {
  const resolved: FunctionInfo[] = [];
  const seen = new Set<string>();

  for (const entry of files) {
    const file = resolveEntrypointFile(entry, indexedFiles(index));
    const infos = exportsInFile(file, index);
    if (infos.length === 0) {
      throw new Error(`No exported entrypoints in ${file}`);
    }
    for (const info of infos) {
      const id = `${info.file}\0${info.key}\0${info.line ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      resolved.push(info);
    }
  }

  return resolved;
}

function resolveEntrypointInfos(
  index: FunctionIndex,
  symbols: string[],
  files: string[],
): FunctionInfo[] {
  return [
    ...resolveSymbolInfos(index, symbols),
    ...resolveFileInfos(index, files),
  ];
}

function serializeCallNode(node: CallNode): CallNode {
  const serialized: CallNode = {
    key: node.key,
    label: node.label,
    children: node.children.map(serializeCallNode),
  };
  return assignOptionalTreeFields(serialized, node);
}

function serializeDiffNode(node: DiffNode): DiffNode {
  const serialized: DiffNode = {
    key: node.key,
    label: node.label,
    status: node.status,
    children: node.children.map(serializeDiffNode),
  };
  return assignOptionalTreeFields(serialized, node);
}

/** Diff call stacks between two snapshots. Returns structured data + ASCII. */
export function runDiff(options: DiffRunOptions = {}): DiffResult {
  const cwd = options.cwd ?? process.cwd();
  const maxDepth = options.maxDepth ?? 12;
  const entriesOpt = options.entries ?? [];
  const filesOpt = options.files ?? [];
  const color = options.color !== false;
  const locs = options.locs === true;
  const hasExplicit = entriesOpt.length > 0 || filesOpt.length > 0;

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

  const extractionCache: ExtractionCache = new Map();
  const before = loadIndex(cwd, from, resolvedPaths, extractionCache);
  const after = loadIndex(cwd, to, resolvedPaths, extractionCache);
  extractionCache.clear();

  const fromLabel = describeSnapshot(from);
  const toLabel = describeSnapshot(to);

  const trees: DiffResult["trees"] = [];
  const asciiParts: string[] = [
    `calldiff diff ${fromLabel} → ${toLabel}`,
    "",
  ];

  const pushDiff = (entry: string, diff: DiffNode): void => {
    const ascii = renderDiff(diff, { color, locs });
    trees.push({
      entry,
      ascii: renderDiff(diff, { color: false, locs }),
      tree: serializeDiffNode(diff),
    });
    if (asciiParts.length > 2) asciiParts.push("");
    asciiParts.push(ascii);
  };

  if (hasExplicit) {
    const explicit = resolveExplicitDiffEntries(
      before,
      after,
      entriesOpt,
      filesOpt,
    );
    for (const item of explicit) {
      const diff = item.file
        ? diffPinnedEntry(
            item.key,
            item.beforeInfo,
            item.afterInfo,
            before,
            after,
            maxDepth,
          )
        : diffEntry(item.key, before, after, maxDepth);
      if (!diff) continue;
      pushDiff(item.key, diff);
    }
  } else {
    const entries = inferEntries(before, after, [], maxDepth);
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

    for (const entry of entries) {
      const diff = diffEntry(entry, before, after, maxDepth);
      if (!diff) continue;
      pushDiff(entry, diff);
    }
  }

  if (trees.length === 0) {
    const message = hasExplicit
      ? "No callstack changes for requested entrypoints."
      : "No callstack changes for inferred entrypoints.";
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
  const symbols = options.entries ?? [];
  const files = options.files ?? [];

  assertGitRepo(cwd);

  const { snapshot, paths } = resolveSnapshotAndPaths(
    cwd,
    options.ref,
    options.paths ?? [],
  );
  if (snapshot.kind === "commit") verifyCommit(cwd, snapshot.ref);

  const index = loadIndex(cwd, snapshot, paths);
  const infos = resolveEntrypointInfos(index, symbols, files);
  const refLabel = describeSnapshot(snapshot);

  const trees: TreeResult["trees"] = [];
  const asciiParts: string[] = [`calldiff tree ${refLabel}`, ""];

  for (const info of infos) {
    const tree = buildCallTreeFromInfo(info, index, maxDepth);
    const ascii = renderTree(tree, { color, locs });
    trees.push({
      entry: info.key,
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
  const symbols = options.entries ?? [];
  const files = options.files ?? [];

  assertGitRepo(cwd);

  const { snapshot, paths } = resolveSnapshotAndPaths(
    cwd,
    options.ref,
    options.paths ?? [],
  );
  if (snapshot.kind === "commit") verifyCommit(cwd, snapshot.ref);

  const index = loadIndex(cwd, snapshot, paths);
  const targetKey = resolveEntry(options.to, index);
  if (!targetKey) {
    throw new Error(`Target not found: ${options.to}`);
  }
  const refLabel = describeSnapshot(snapshot);

  const pathResults: ReachResult["paths"] = [];
  const entryKeys: string[] = [];

  for (const entry of symbols) {
    const key = resolveEntry(entry, index);
    if (!key) {
      throw new Error(`Entrypoint not found: ${entry}`);
    }
    if (!entryKeys.includes(key)) entryKeys.push(key);
    const found = findReachPaths(entry, targetKey, index, maxDepth);
    for (const path of found) {
      pathResults.push({
        ascii: renderTree(path, { color: false, locs }),
        tree: serializeCallNode(path),
      });
    }
  }

  for (const info of resolveFileInfos(index, files)) {
    if (!entryKeys.includes(info.key)) entryKeys.push(info.key);
    const tree = buildCallTreeFromInfo(info, index, maxDepth);
    for (const path of collectPathsTo(tree, targetKey, options.to)) {
      pathResults.push({
        ascii: renderTree(path, { color: false, locs }),
        tree: serializeCallNode(path),
      });
    }
  }

  const fromLabel =
    entryKeys.length === 1 ? entryKeys[0]! : entryKeys.join(", ");
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
