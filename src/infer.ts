import type { FunctionIndex } from "./extract.js";
import { allFunctions, flattenCallKeys } from "./extract.js";
import {
  buildCallTree,
  buildCallTreeFromInfo,
  isFileEntrypoint,
  matchEntrypointFiles,
  resolveEntry,
  resolveFileEntrypoints,
} from "./calltree.js";
import { diffTrees, treeHasChanges } from "./diff.js";
import type { DiffNode, FunctionInfo } from "./types.js";

function functionShape(fn: FunctionInfo | undefined): string | null {
  if (!fn) return null;
  return JSON.stringify({ label: fn.label, steps: fn.steps });
}

function addReverseEdges(
  reverse: Map<string, Set<string>>,
  index: FunctionIndex,
): void {
  for (const [caller, fn] of index) {
    for (const callee of flattenCallKeys(fn.steps)) {
      let callers = reverse.get(callee);
      if (!callers) {
        callers = new Set();
        reverse.set(callee, callers);
      }
      callers.add(caller);
    }
  }
}

function findAffected(
  before: FunctionIndex,
  after: FunctionIndex,
  maxDepth: number,
): Set<string> {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const reverse = new Map<string, Set<string>>();
  addReverseEdges(reverse, before);
  addReverseEdges(reverse, after);

  const distance = new Map<string, number>();
  const queue: string[] = [];

  for (const key of keys) {
    if (functionShape(before.get(key)) === functionShape(after.get(key))) {
      continue;
    }
    distance.set(key, 0);
    queue.push(key);
  }

  for (let i = 0; i < queue.length; i += 1) {
    const callee = queue[i]!;
    const nextDistance = distance.get(callee)! + 1;
    if (nextDistance > maxDepth) continue;

    for (const caller of reverse.get(callee) ?? []) {
      const previous = distance.get(caller);
      if (previous !== undefined && previous <= nextDistance) continue;
      distance.set(caller, nextDistance);
      queue.push(caller);
    }
  }

  return new Set(distance.keys());
}

function changedKeys(
  keys: string[],
  before: FunctionIndex,
  after: FunctionIndex,
  maxDepth: number,
): string[] {
  return keys
    .filter((key) => diffEntry(key, before, after, maxDepth) !== null)
    .sort((a, b) => a.localeCompare(b));
}

function fileExistsInIndex(entry: string, index: FunctionIndex): string[] {
  return matchEntrypointFiles(
    entry,
    allFunctions(index).map((fn) => fn.file),
  );
}

function assertFileEntrypoints(
  entry: string,
  before: FunctionIndex,
  after: FunctionIndex,
): FunctionInfo[] {
  const fromBefore = resolveFileEntrypoints(entry, before);
  const fromAfter = resolveFileEntrypoints(entry, after);
  if (fromBefore.length > 0 || fromAfter.length > 0) {
    const byKey = new Map<string, FunctionInfo>();
    for (const info of [...fromBefore, ...fromAfter]) {
      if (!byKey.has(info.key)) byKey.set(info.key, info);
    }
    return [...byKey.values()].sort((a, b) => {
      if (a.label !== b.label) return a.label < b.label ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }

  const matched = [
    ...new Set([
      ...fileExistsInIndex(entry, before),
      ...fileExistsInIndex(entry, after),
    ]),
  ].sort();
  if (matched.length === 0) {
    throw new Error(`Entrypoint file not found: ${entry}`);
  }
  if (matched.length > 1) {
    throw new Error(
      `Ambiguous entrypoint file: ${entry} matches ${matched.join(", ")}. Use a more specific path.`,
    );
  }
  throw new Error(`No exported entrypoints in ${matched[0]}`);
}

/**
 * Infer entrypoints: exported functions whose expanded call trees differ,
 * plus any explicitly requested entries (symbols or source file paths).
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
      if (isFileEntrypoint(entry)) {
        for (const info of assertFileEntrypoints(entry, before, after)) {
          if (!entries.includes(info.key)) entries.push(info.key);
        }
        continue;
      }
      const key = resolveEntry(entry, after) ?? resolveEntry(entry, before);
      if (!key) throw new Error(`Entrypoint not found: ${entry}`);
      if (!entries.includes(key)) entries.push(key);
    }
    return entries;
  }

  const affected = [...findAffected(before, after, maxDepth)].filter(
    (key) => !key.startsWith("new "),
  );
  const exported = affected.filter((key) =>
    Boolean(before.get(key)?.exported || after.get(key)?.exported),
  );
  const entries = changedKeys(exported, before, after, maxDepth);
  if (entries.length > 0) return entries;

  const checked = new Set(exported);
  const fallback = affected.filter((key) => !checked.has(key));
  return changedKeys(fallback, before, after, maxDepth);
}

/**
 * Expand explicit `-e` values into concrete definitions for diffing.
 * File paths pin to exported symbols in that file (both snapshots).
 */
export function resolveExplicitDiffEntries(
  before: FunctionIndex,
  after: FunctionIndex,
  explicit: string[],
): Array<{
  key: string;
  beforeInfo?: FunctionInfo;
  afterInfo?: FunctionInfo;
  /** When set, trees are built from these file-pinned definitions. */
  file?: string;
}> {
  const out: Array<{
    key: string;
    beforeInfo?: FunctionInfo;
    afterInfo?: FunctionInfo;
    file?: string;
  }> = [];
  const seen = new Set<string>();

  for (const entry of explicit) {
    if (isFileEntrypoint(entry)) {
      const infos = assertFileEntrypoints(entry, before, after);
      const file =
        infos[0]?.file ??
        fileExistsInIndex(entry, after)[0] ??
        fileExistsInIndex(entry, before)[0];
      if (!file) throw new Error(`Entrypoint file not found: ${entry}`);

      const keys = [
        ...new Set(
          [
            ...resolveFileEntrypoints(entry, before),
            ...resolveFileEntrypoints(entry, after),
          ].map((info) => info.key),
        ),
      ].sort((a, b) => a.localeCompare(b));

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
      continue;
    }

    const key = resolveEntry(entry, after) ?? resolveEntry(entry, before);
    if (!key) throw new Error(`Entrypoint not found: ${entry}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key });
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
    : {
        key: afterKey,
        label: after.get(afterKey)?.label ?? afterKey,
        children: [] as [],
      };

  const afterTree = hasAfter
    ? buildCallTree(afterKey, after, maxDepth)
    : {
        key: beforeKey,
        label: before.get(beforeKey)?.label ?? beforeKey,
        children: [] as [],
      };

  // If function only on one side, mark root accordingly via empty opposite
  if (!hasBefore && hasAfter) {
    const diff = diffTrees(
      { key: afterKey, label: afterTree.label, children: [] },
      afterTree,
    );
    // Force root added
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
    : {
        key,
        label: afterInfo?.label ?? key,
        children: [] as [],
      };

  const afterTree = afterInfo
    ? buildCallTreeFromInfo(afterInfo, after, maxDepth)
    : {
        key,
        label: beforeInfo?.label ?? key,
        children: [] as [],
      };

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
