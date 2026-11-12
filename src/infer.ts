import type { FunctionIndex } from "./extract.js";
import { allFunctions, definitionsInFile, fileScopedKey } from "./extract.js";
import {
  buildCallTree,
  buildCallTreeFromInfo,
  exportsInFile,
  indexedFiles,
  resolveCall,
  resolveEntry,
  resolveEntrypointFile,
} from "./calltree.js";
import { diffTrees, treeHasChanges } from "./diff.js";
import type { CallNode, CallStep, DiffNode, FunctionInfo } from "./types.js";

function emptyCallTree(key: string, label: string): CallNode {
  return { key, label, children: [] };
}

/**
 * Every definition a call can resolve to: extracted functions plus the
 * `new Class` aliases {@link buildIndex} adds for constructors.
 */
function definitionsOf(index: FunctionIndex): FunctionInfo[] {
  const out = new Set<FunctionInfo>();
  for (const fn of allFunctions(index)) {
    out.add(fn);
    if (fn.key.endsWith(".constructor")) {
      const newKey = `new ${fn.key.slice(0, -".constructor".length)}`;
      for (const alias of definitionsInFile(index, fn.file, newKey)) {
        out.add(alias);
      }
    }
  }
  for (const fn of index.values()) out.add(fn);
  return [...out];
}

type DefinitionGraph = {
  /** Identity that survives line shifts: file, key, rank among that file's same-key definitions. */
  id: (fn: FunctionInfo) => string;
  /** Call body without source locations, each call tagged with the definition it resolves to. */
  bodies: Map<string, string>;
  /** Resolved call edges: callee id → caller ids. */
  callers: Map<string, Set<string>>;
};

/**
 * Build the resolved definition graph for one snapshot.
 *
 * A call tree only depends on call keys, branch keys and which definition each
 * call resolves to — never on line numbers — so that is all a body records.
 */
function definitionGraph(index: FunctionIndex): DefinitionGraph {
  const ids = new Map<FunctionInfo, string>();
  const id = (fn: FunctionInfo): string => {
    let value = ids.get(fn);
    if (value === undefined) {
      const rank = definitionsInFile(index, fn.file, fn.key).indexOf(fn);
      value = `${fileScopedKey(fn.file, fn.key)}\0${rank}`;
      ids.set(fn, value);
    }
    return value;
  };
  const bodies = new Map<string, string>();
  const callers = new Map<string, Set<string>>();

  for (const fn of definitionsOf(index)) {
    const self = id(fn);
    const encode = (steps: CallStep[]): unknown[] =>
      steps.map((step) => {
        if (step.type === "branch") {
          return ["b", step.key, encode(step.children)];
        }
        const target = resolveCall(step.key, index, step, fn);
        const targetId = target ? id(target) : null;
        if (targetId) {
          let set = callers.get(targetId);
          if (!set) {
            set = new Set();
            callers.set(targetId, set);
          }
          set.add(self);
        }
        return ["c", step.key, targetId, step.children ? encode(step.children) : 0];
      });
    bodies.set(self, JSON.stringify(encode(fn.steps)));
  }

  return { id, bodies, callers };
}

/** Definitions whose body changed, plus their callers up to `maxDepth` calls away. */
function affectedDefinitions(
  before: DefinitionGraph,
  after: DefinitionGraph,
  maxDepth: number,
): Set<string> {
  const distance = new Map<string, number>();
  const queue: string[] = [];

  for (const id of new Set([...before.bodies.keys(), ...after.bodies.keys()])) {
    if (before.bodies.get(id) === after.bodies.get(id)) continue;
    distance.set(id, 0);
    queue.push(id);
  }

  for (let i = 0; i < queue.length; i += 1) {
    const callee = queue[i]!;
    const nextDistance = distance.get(callee)! + 1;
    if (nextDistance > maxDepth) continue;

    for (const graph of [before, after]) {
      for (const caller of graph.callers.get(callee) ?? []) {
        if (distance.has(caller)) continue;
        distance.set(caller, nextDistance);
        queue.push(caller);
      }
    }
  }

  return new Set(distance.keys());
}

/**
 * Index keys whose expanded call tree may differ between the snapshots.
 *
 * A superset of the keys {@link diffEntry} reports as changed: a tree can only
 * change when its root resolves to a different definition, or when a
 * definition it reaches changed body. Line shifts alone never qualify.
 */
export function affectedEntries(
  before: FunctionIndex,
  after: FunctionIndex,
  maxDepth: number,
): string[] {
  const beforeGraph = definitionGraph(before);
  const afterGraph = definitionGraph(after);
  const affected = affectedDefinitions(beforeGraph, afterGraph, maxDepth);

  const keys: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (key.startsWith("new ")) continue;
    const beforeRoot = before.get(key);
    const afterRoot = after.get(key);
    if (!beforeRoot || !afterRoot) {
      keys.push(key);
      continue;
    }
    const beforeId = beforeGraph.id(beforeRoot);
    const afterId = afterGraph.id(afterRoot);
    if (
      beforeId !== afterId ||
      affected.has(beforeId) ||
      affected.has(afterId)
    ) {
      keys.push(key);
    }
  }
  return keys.sort((a, b) => a.localeCompare(b));
}

export type InferredDiff = { entry: string; diff: DiffNode };

function changedDiffs(
  keys: string[],
  before: FunctionIndex,
  after: FunctionIndex,
  maxDepth: number,
): InferredDiff[] {
  const found: InferredDiff[] = [];
  for (const entry of keys) {
    const diff = diffEntry(entry, before, after, maxDepth);
    if (diff) found.push({ entry, diff });
  }
  return found;
}

/**
 * Inferred entrypoints with their diffs: exported functions whose expanded
 * call trees differ, else any changed function.
 */
export function inferEntryDiffs(
  before: FunctionIndex,
  after: FunctionIndex,
  maxDepth: number,
): InferredDiff[] {
  const affected = affectedEntries(before, after, maxDepth);
  const exported = affected.filter((key) =>
    Boolean(before.get(key)?.exported || after.get(key)?.exported),
  );
  const found = changedDiffs(exported, before, after, maxDepth);
  if (found.length > 0) return found;

  const checked = new Set(exported);
  return changedDiffs(
    affected.filter((key) => !checked.has(key)),
    before,
    after,
    maxDepth,
  );
}

/**
 * Infer entrypoints: exported functions whose expanded call trees differ,
 * plus any explicitly requested symbol entries.
 */
export function inferEntries(
  before: FunctionIndex,
  after: FunctionIndex,
  explicit: string[],
  maxDepth: number,
): string[] {
  if (explicit.length > 0) {
    const entries: string[] = [];
    for (const entry of explicit) {
      const key = resolveEntry(entry, after) ?? resolveEntry(entry, before);
      if (!key) throw new Error(`Entrypoint not found: ${entry}`);
      if (!entries.includes(key)) entries.push(key);
    }
    return entries;
  }

  return inferEntryDiffs(before, after, maxDepth).map((found) => found.entry);
}

export type ExplicitDiffEntry = {
  key: string;
  beforeInfo?: FunctionInfo;
  afterInfo?: FunctionInfo;
  /** When set, trees are built from these file-pinned definitions. */
  file?: string;
};

/**
 * Expand explicit `-e` symbols and `--file` paths into concrete diff roots.
 */
export function resolveExplicitDiffEntries(
  before: FunctionIndex,
  after: FunctionIndex,
  symbols: string[],
  files: string[] = [],
): ExplicitDiffEntry[] {
  const out: ExplicitDiffEntry[] = [];
  const seen = new Set<string>();

  for (const entry of symbols) {
    const key = resolveEntry(entry, after) ?? resolveEntry(entry, before);
    if (!key) throw new Error(`Entrypoint not found: ${entry}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key });
  }

  for (const entry of files) {
    const file = resolveEntrypointFile(entry, [
      ...indexedFiles(before),
      ...indexedFiles(after),
    ]);
    const keys = [
      ...new Set(
        [
          ...exportsInFile(file, before),
          ...exportsInFile(file, after),
        ].map((info) => info.key),
      ),
    ].sort((a, b) => a.localeCompare(b));
    if (keys.length === 0) {
      throw new Error(`No exported entrypoints in ${file}`);
    }

    for (const key of keys) {
      const id = `${file}\0${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const beforeInfo = allFunctions(before).find(
        (fn) => fn.file === file && fn.key === key && fn.exported,
      );
      const afterInfo = allFunctions(after).find(
        (fn) => fn.file === file && fn.key === key && fn.exported,
      );
      out.push({ key, beforeInfo, afterInfo, file });
    }
  }

  return out;
}

export function diffEntry(
  key: string,
  before: FunctionIndex,
  after: FunctionIndex,
  maxDepth: number,
): DiffNode | null {
  const beforeKey = resolveEntry(key, before) ?? key;
  const afterKey = resolveEntry(key, after) ?? key;

  const hasBefore = before.has(beforeKey);
  const hasAfter = after.has(afterKey);

  if (!hasBefore && !hasAfter) return null;

  const beforeTree = hasBefore
    ? buildCallTree(beforeKey, before, maxDepth)
    : emptyCallTree(afterKey, after.get(afterKey)?.label ?? afterKey);

  const afterTree = hasAfter
    ? buildCallTree(afterKey, after, maxDepth)
    : emptyCallTree(beforeKey, before.get(beforeKey)?.label ?? beforeKey);

  if (!hasBefore && hasAfter) {
    const diff = diffTrees(
      { key: afterKey, label: afterTree.label, children: [] },
      afterTree,
    );
    return { ...diff, status: "added" };
  }

  if (hasBefore && !hasAfter) {
    const diff = diffTrees(beforeTree, {
      key: beforeKey,
      label: beforeTree.label,
      children: [],
    });
    return { ...diff, status: "removed" };
  }

  const diff = diffTrees(beforeTree, afterTree);
  if (!treeHasChanges(diff)) return null;
  return diff;
}

/** Diff two file-pinned definitions (or missing on one side). */
export function diffPinnedEntry(
  key: string,
  beforeInfo: FunctionInfo | undefined,
  afterInfo: FunctionInfo | undefined,
  before: FunctionIndex,
  after: FunctionIndex,
  maxDepth: number,
): DiffNode | null {
  if (!beforeInfo && !afterInfo) return null;

  const beforeTree = beforeInfo
    ? buildCallTreeFromInfo(beforeInfo, before, maxDepth)
    : emptyCallTree(key, afterInfo?.label ?? key);

  const afterTree = afterInfo
    ? buildCallTreeFromInfo(afterInfo, after, maxDepth)
    : emptyCallTree(key, beforeInfo?.label ?? key);

  if (!beforeInfo && afterInfo) {
    const diff = diffTrees(
      { key, label: afterTree.label, children: [] },
      afterTree,
    );
    return { ...diff, status: "added" };
  }

  if (beforeInfo && !afterInfo) {
    const diff = diffTrees(beforeTree, {
      key,
      label: beforeTree.label,
      children: [],
    });
    return { ...diff, status: "removed" };
  }

  const diff = diffTrees(beforeTree, afterTree);
  if (!treeHasChanges(diff)) return null;
  return diff;
}
