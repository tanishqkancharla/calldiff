import { allFunctions, type FunctionIndex } from "./extract.js";
import { pickLoc } from "./loc.js";
import type { CallNode, CallStep, FunctionInfo } from "./types.js";

function displayCallLabel(
  key: string,
  index: FunctionIndex,
  info?: FunctionInfo,
): string {
  if (info) return info.label;
  const fromIndex = index.get(key);
  if (fromIndex) return fromIndex.label;
  return key.includes("(") ? key : `${key}()`;
}

function expandSteps(
  steps: CallStep[],
  index: FunctionIndex,
  depth: number,
  maxDepth: number,
  visiting: Set<string>,
): CallNode[] {
  return steps.map((step) => {
    if (step.type === "branch") {
      return {
        key: step.key,
        label: step.label,
        kind: "branch" as const,
        ...pickLoc(step),
        children: expandSteps(
          step.children,
          index,
          depth,
          maxDepth,
          visiting,
        ),
      };
    }
    return expandCall(
      step.key,
      index,
      depth,
      maxDepth,
      visiting,
      step.children,
      step,
    );
  });
}

function expandCall(
  key: string,
  index: FunctionIndex,
  depth: number,
  maxDepth: number,
  visiting: Set<string>,
  inlineChildren?: CallStep[],
  callSite?: { file?: string; line?: number; endLine?: number },
  /** When set, expand this body even if another definition owns the bare key. */
  infoOverride?: FunctionInfo,
): CallNode {
  const info = infoOverride ?? index.get(key);
  const label = displayCallLabel(key, index, info);

  // Root uses the definition start line; every other node uses the call-site in the parent.
  const loc =
    depth === 0 && info?.line != null
      ? pickLoc({ file: info.file, line: info.line })
      : pickLoc(callSite);

  if (depth >= maxDepth) {
    return { key, label, kind: "call", ...loc, children: [] };
  }

  if (!info && !inlineChildren?.length) {
    return { key, label, kind: "call", ...loc, children: [] };
  }

  if (info && visiting.has(key)) {
    // Still expand call-site JSX children; they are not a re-entry into `key`'s body.
    const callSiteChildren = inlineChildren?.length
      ? expandSteps(inlineChildren, index, depth + 1, maxDepth, visiting)
      : [];
    return {
      key,
      label: `${label} ⇄`,
      kind: "call",
      ...loc,
      children: callSiteChildren,
    };
  }

  if (info) visiting.add(key);
  const bodyChildren = info
    ? expandSteps(info.steps, index, depth + 1, maxDepth, visiting)
    : [];
  const callSiteChildren = inlineChildren?.length
    ? expandSteps(inlineChildren, index, depth + 1, maxDepth, visiting)
    : [];
  if (info) visiting.delete(key);

  return {
    key,
    label,
    kind: "call",
    ...loc,
    children: [...bodyChildren, ...callSiteChildren],
  };
}

/**
 * Expand a function into a nested call tree by following known definitions.
 */
export function buildCallTree(
  entryKey: string,
  index: FunctionIndex,
  maxDepth: number,
): CallNode {
  const resolved = resolveEntry(entryKey, index) ?? entryKey;
  return expandCall(resolved, index, 0, maxDepth, new Set());
}

/**
 * Expand a specific definition. Used by `reach` when several functions share a
 * bare key and first-wins indexing would otherwise hide all but one body.
 */
export function buildCallTreeFromInfo(
  info: FunctionInfo,
  index: FunctionIndex,
  maxDepth: number,
): CallNode {
  return expandCall(
    info.key,
    index,
    0,
    maxDepth,
    new Set(),
    undefined,
    undefined,
    info,
  );
}

export function resolveEntry(
  entry: string,
  index: FunctionIndex,
): string | null {
  if (index.has(entry)) return entry;

  const stripped = entry.replace(/\(\)$/, "");
  if (index.has(stripped)) return stripped;

  const matches = [...index.keys()].filter(
    (key) =>
      key === entry ||
      key.endsWith(`.${entry}`) ||
      key === `new ${entry}`,
  );

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const exported = matches.filter((key) => index.get(key)?.exported);
    if (exported.length === 1) return exported[0]!;
    return matches.sort()[0]!;
  }

  return null;
}

function entryNameMatches(key: string, entry: string): boolean {
  return (
    key === entry ||
    key.endsWith(`.${entry}`) ||
    key === `new ${entry}`
  );
}

function sortDefinitions(fns: FunctionInfo[]): FunctionInfo[] {
  return [...fns].sort((a, b) => {
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

/**
 * Every definition that matches `entry` (including those shadowed in the
 * bare-key map). Prefer exact bare-key hits; otherwise Class.method / `new X`.
 * Order is stable by label, then file — independent of extract order.
 */
export function resolveAllEntries(
  entry: string,
  index: FunctionIndex,
): FunctionInfo[] {
  const stripped = entry.replace(/\(\)$/, "");
  const all = allFunctions(index);

  const exact = all.filter(
    (fn) => fn.key === entry || fn.key === stripped,
  );
  if (exact.length > 0) return sortDefinitions(exact);

  const matches = all.filter(
    (fn) =>
      entryNameMatches(fn.key, entry) || entryNameMatches(fn.key, stripped),
  );
  return sortDefinitions(matches);
}
