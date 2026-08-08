import type { FunctionIndex } from "./extract.js";
import type { CallNode, CallStep } from "./types.js";

function displayCallLabel(key: string, index: FunctionIndex): string {
  const info = index.get(key);
  if (info) return info.label;
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
        site: step.site,
        children: expandSteps(
          step.children,
          index,
          depth,
          maxDepth,
          visiting,
        ),
      };
    }
    const node = expandCall(step.key, index, depth, maxDepth, visiting);
    // The step knows where the call is written (the caller's file); that
    // site beats the callee's definition as a diff anchor.
    return step.site ? { ...node, site: step.site } : node;
  });
}

function expandCall(
  key: string,
  index: FunctionIndex,
  depth: number,
  maxDepth: number,
  visiting: Set<string>,
): CallNode {
  const label = displayCallLabel(key, index);

  if (depth >= maxDepth) {
    return { key, label, kind: "call", children: [] };
  }

  const info = index.get(key);
  if (!info) {
    return { key, label, kind: "call", children: [] };
  }

  if (visiting.has(key)) {
    return { key, label: `${label} ⇄`, kind: "call", children: [] };
  }

  visiting.add(key);
  const children = expandSteps(
    info.steps,
    index,
    depth + 1,
    maxDepth,
    visiting,
  );
  visiting.delete(key);

  return { key, label, kind: "call", children };
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
  const tree = expandCall(resolved, index, 0, maxDepth, new Set());
  // The root has no call site — anchor it at its definition.
  const info = index.get(resolved);
  if (!tree.site && info) {
    tree.site = { file: info.file, line: info.startLine };
  }
  return tree;
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
