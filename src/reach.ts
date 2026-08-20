import {
  buildCallTree,
  buildCallTreeFromInfo,
  resolveAllEntries,
  resolveEntry,
} from "./calltree.js";
import type { FunctionIndex } from "./extract.js";
import type { CallNode } from "./types.js";
import {
  assignOptionalResolutionFields,
  assignOptionalTreeFields,
} from "./types.js";

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
  const tree: CallNode = {
    key: head!.key,
    label: head!.label,
    children: rest.length > 0 ? [pathToTree(rest)] : [],
  };
  assignOptionalTreeFields(tree, head!);
  assignOptionalResolutionFields(tree, head!);
  return tree;
}

function conditionExprContains(
  node: CallNode,
  resolvedTarget: string,
  rawTarget: string,
): boolean {
  if (nodeMatchesTarget(node.key, resolvedTarget, rawTarget)) return true;
  if (
    node.condition?.some((child) =>
      conditionExprContains(child, resolvedTarget, rawTarget),
    )
  ) {
    return true;
  }
  return node.children.some((child) =>
    conditionExprContains(child, resolvedTarget, rawTarget),
  );
}

/**
 * Collect every root-to-node path in `tree` that ends at `target`
 * (first hit on a path; does not continue below the target).
 *
 * A hit anywhere in a branch `condition` expression ends at the branch
 * (`--to foo` in `if (guard(foo(x)))` is the `if` line). Targets inside a
 * condition callee's *body* still walk `if → guard → helper`.
 */
export function collectPathsTo(
  tree: CallNode,
  resolvedTarget: string,
  rawTarget: string,
  index?: FunctionIndex,
  maxDepth = 12,
): CallNode[] {
  const paths: CallNode[] = [];
  const expanding = new Set<string>();

  const matches = (node: CallNode): boolean =>
    nodeMatchesTarget(node.key, resolvedTarget, rawTarget);

  const walk = (node: CallNode, ancestors: CallNode[]) => {
    const chain = [...ancestors, node];
    if (matches(node)) {
      paths.push(pathToTree(chain));
      return;
    }
    if (node.condition?.length) {
      if (
        node.condition.some((cond) =>
          conditionExprContains(cond, resolvedTarget, rawTarget),
        )
      ) {
        paths.push(pathToTree(chain));
        return;
      }
      if (index) {
        for (const cond of node.condition) {
          walkConditionBodies(cond, chain);
        }
      }
    }
    for (const child of node.children) {
      walk(child, chain);
    }
  };

  /** Expand a condition callee's definition, not its expression children. */
  const walkConditionBodies = (expr: CallNode, branchChain: CallNode[]) => {
    if (index && !expanding.has(expr.key)) {
      expanding.add(expr.key);
      const body = buildCallTree(expr.key, index, maxDepth);
      for (const child of body.children) {
        walk(child, [...branchChain, expr]);
      }
      expanding.delete(expr.key);
    }
    for (const nested of expr.children) {
      walkConditionBodies(nested, [...branchChain, expr]);
    }
  };

  walk(tree, []);
  return paths;
}

/**
 * Find all call paths from `fromEntry` to `toEntry` in the indexed call graph.
 * Expands via the same rules as `buildCallTree` (including branch forks).
 *
 * When several definitions share the entry name, every definition is walked
 * (reach's contract is completeness). Order is stable across file reorderings.
 */
export function findReachPaths(
  fromEntry: string,
  toEntry: string,
  index: FunctionIndex,
  maxDepth: number,
): CallNode[] {
  const toKey = resolveEntry(toEntry, index) ?? toEntry;
  const fromInfos = resolveAllEntries(fromEntry, index);

  if (fromInfos.length === 0) {
    const fromKey = resolveEntry(fromEntry, index) ?? fromEntry;
    const tree = buildCallTree(fromKey, index, maxDepth);
    return collectPathsTo(tree, toKey, toEntry, index, maxDepth);
  }

  const paths: CallNode[] = [];
  for (const info of fromInfos) {
    const tree = buildCallTreeFromInfo(info, index, maxDepth);
    paths.push(...collectPathsTo(tree, toKey, toEntry, index, maxDepth));
  }
  return paths;
}
