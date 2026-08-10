import { buildCallTree, resolveEntry } from "./calltree.js";
import type { FunctionIndex } from "./extract.js";
import type { CallNode } from "./types.js";

function nodeMatchesTarget(
  nodeKey: string,
  resolvedTarget: string,
  rawTarget: string,
): boolean {
  if (nodeKey === resolvedTarget || nodeKey === rawTarget) return true;
  const stripped = nodeKey.replace(/\(\)$/, "");
  if (stripped === resolvedTarget || stripped === rawTarget) return true;
  return (
    nodeKey.endsWith(`.${rawTarget}`) ||
    nodeKey.endsWith(`.${resolvedTarget}`)
  );
}

/** Collapse a root→target node list into a linear single-child tree. */
export function pathToTree(nodes: CallNode[]): CallNode {
  if (nodes.length === 0) {
    throw new Error("pathToTree requires at least one node");
  }
  const [head, ...rest] = nodes;
  return {
    key: head!.key,
    label: head!.label,
    ...(head!.kind ? { kind: head!.kind } : {}),
    ...(head!.file ? { file: head!.file } : {}),
    ...(head!.line != null ? { line: head!.line } : {}),
    ...(head!.endLine != null ? { endLine: head!.endLine } : {}),
    children: rest.length > 0 ? [pathToTree(rest)] : [],
  };
}

/**
 * Collect every root-to-node path in `tree` that ends at `target`
 * (first hit on a path; does not continue below the target).
 */
export function collectPathsTo(
  tree: CallNode,
  resolvedTarget: string,
  rawTarget: string,
): CallNode[] {
  const paths: CallNode[] = [];

  const walk = (node: CallNode, ancestors: CallNode[]) => {
    const chain = [...ancestors, node];
    if (nodeMatchesTarget(node.key, resolvedTarget, rawTarget)) {
      paths.push(pathToTree(chain));
      return;
    }
    for (const child of node.children) {
      walk(child, chain);
    }
  };

  walk(tree, []);
  return paths;
}

/**
 * Find all call paths from `fromEntry` to `toEntry` in the indexed call graph.
 * Expands via the same rules as `buildCallTree` (including branch forks).
 */
export function findReachPaths(
  fromEntry: string,
  toEntry: string,
  index: FunctionIndex,
  maxDepth: number,
): CallNode[] {
  const fromKey = resolveEntry(fromEntry, index) ?? fromEntry;
  const toKey = resolveEntry(toEntry, index) ?? toEntry;
  const tree = buildCallTree(fromKey, index, maxDepth);
  return collectPathsTo(tree, toKey, toEntry);
}
