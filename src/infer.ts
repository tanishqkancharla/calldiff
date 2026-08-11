import type { FunctionIndex } from "./extract.js";
import { flattenCallKeys } from "./extract.js";
import { buildCallTree, resolveEntry } from "./calltree.js";
import { diffTrees, treeHasChanges } from "./diff.js";
import { SymbolNotFoundError } from "./errors.js";
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

/**
 * Infer entrypoints: exported functions whose expanded call trees differ,
 * plus any explicitly requested entries.
 */
export function inferEntries(
  before: FunctionIndex,
  after: FunctionIndex,
  explicit: string[],
  maxDepth: number,
  hintFor?: (entry: string) => string | undefined,
): string[] {
  if (explicit.length > 0) {
    const entries: string[] = [];
    for (const entry of explicit) {
      const key = resolveEntry(entry, after) ?? resolveEntry(entry, before);
      if (!key) {
        throw new SymbolNotFoundError("entrypoint", entry, hintFor?.(entry));
      }
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
