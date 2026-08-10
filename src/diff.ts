import { pickLoc } from "./loc.js";
import type { CallNode, DiffNode } from "./types.js";

/**
 * Structural tree diff keyed by call identity.
 * Children are aligned with LCS so output order stays close to the "after" tree.
 */
export function diffTrees(before: CallNode, after: CallNode): DiffNode {
  return diffNode(before, after);
}

function diffNode(before: CallNode | null, after: CallNode | null): DiffNode {
  if (before && after) {
    return {
      key: after.key,
      label: after.label,
      kind: after.kind ?? before.kind,
      ...pickLoc(after.file ? after : before),
      status: "same",
      children: diffChildren(before.children, after.children),
    };
  }

  if (after) {
    return {
      key: after.key,
      label: after.label,
      kind: after.kind,
      ...pickLoc(after),
      status: "added",
      children: after.children.map(markTree("added")),
    };
  }

  if (before) {
    return {
      key: before.key,
      label: before.label,
      kind: before.kind,
      ...pickLoc(before),
      status: "removed",
      children: before.children.map(markTree("removed")),
    };
  }

  throw new Error("diffNode called with no trees");
}

function markTree(status: "added" | "removed") {
  return function mark(node: CallNode): DiffNode {
    return {
      key: node.key,
      label: node.label,
      kind: node.kind,
      ...pickLoc(node),
      status,
      children: node.children.map(mark),
    };
  };
}

function diffChildren(before: CallNode[], after: CallNode[]): DiffNode[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (before[i]!.key === after[j]!.key) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const result: DiffNode[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i]!.key === after[j]!.key) {
      result.push(diffNode(before[i]!, after[j]!));
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      result.push(diffNode(before[i]!, null));
      i += 1;
    } else {
      result.push(diffNode(null, after[j]!));
      j += 1;
    }
  }
  while (i < n) {
    result.push(diffNode(before[i]!, null));
    i += 1;
  }
  while (j < m) {
    result.push(diffNode(null, after[j]!));
    j += 1;
  }
  return result;
}

export function treeHasChanges(node: DiffNode): boolean {
  if (node.status !== "same") return true;
  return node.children.some(treeHasChanges);
}
