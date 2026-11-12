/**
 * Diff two call trees without building them first.
 *
 * Both snapshots are expanded together, one level at a time, and aligned as
 * they expand. Two rules keep the result proportional to the change instead
 * of to the call graph:
 *
 * - A callee whose call tree cannot differ is not expanded. It shows as
 *   `name …`.
 * - A definition pair whose expansion already showed a change in this entry,
 *   at the same or a shallower depth, is not expanded again. It shows as
 *   `name ↑`.
 *
 * Children align by key exactly as `diffTrees` does, and the collapse
 * decision is made on the aligned pair, so both sides collapse together. A
 * matched pair collapses only when both sides hold the same unaffected
 * definition and every ancestor pair entered the same definitions — the
 * recursion cut (⇄) depends on the ancestors, so a subtree below a pair that
 * resolved differently is expanded in full.
 *
 * A repeat is recorded only after its first expansion showed a change: a
 * recursion cut (⇄) can mask a change in one place and not another, so an
 * expansion that showed nothing proves nothing. Hence when the collapsed diff
 * reports no change, no repeat was collapsed and every collapsed callee was
 * provably identical — it never drops an entry the full diff would report.
 */
import { displayCallLabel, resolveCall } from "./calltree.js";
import { fileScopedKey, type FunctionIndex } from "./extract.js";
import { treeHasChanges } from "./diff.js";
import { pickLoc } from "./loc.js";
import type {
  CallNodeKind,
  CallStep,
  DiffNode,
  DiffStatus,
  FunctionInfo,
  SourceLoc,
} from "./types.js";

export type DiffSide = {
  index: FunctionIndex;
  /** Definition identity shared by both sides (see `changeSet`). */
  id: (fn: FunctionInfo) => string;
};

type Side = DiffSide & {
  affected: Set<string>;
  maxDepth: number;
  visiting: Set<string>;
};

/** A node on one side. Created when its parent expands; expands later itself. */
type Pending = {
  key: string;
  label: string;
  kind: CallNodeKind;
  loc: Partial<SourceLoc>;
  depth: number;
  info?: FunctionInfo;
  /** Branch arms, or call-site children (JSX children, callback bodies). */
  steps?: CallStep[];
  /** Definition `steps` were read from. */
  owner?: FunctionInfo;
  /**
   * Why the definition body is not expanded: `leaf` (depth limit, or nothing
   * to expand), `cycle` (re-entry, label ends in ⇄), `unchanged` (identical
   * on both sides).
   */
  stop?: "leaf" | "cycle" | "unchanged";
};

function pendingCall(
  side: Side,
  key: string,
  depth: number,
  inline: CallStep[] | undefined,
  callSite: { file?: string; line?: number; endLine?: number } | undefined,
  override: FunctionInfo | undefined,
  owner: FunctionInfo | undefined,
): Pending {
  const info = override ?? resolveCall(key, side.index, callSite, owner);
  const label = displayCallLabel(key, side.index, info);
  const loc =
    depth === 0 && info?.line != null
      ? pickLoc({ file: info.file, line: info.line })
      : pickLoc(callSite);
  const node: Pending = { key, label, kind: "call", loc, depth };
  if (info) node.info = info;
  if (inline?.length) node.steps = inline;
  if (owner) node.owner = owner;

  if (depth >= side.maxDepth || (!info && !inline?.length)) {
    node.stop = "leaf";
  } else if (info && side.visiting.has(fileScopedKey(info.file, info.key))) {
    node.stop = "cycle";
    node.label = `${label} ⇄`;
  } else if (
    info &&
    depth > 0 &&
    info.steps.length > 0 &&
    !side.affected.has(side.id(info))
  ) {
    node.stop = "unchanged";
  }
  return node;
}

function pendingSteps(
  side: Side,
  steps: CallStep[],
  depth: number,
  owner: FunctionInfo | undefined,
): Pending[] {
  return steps.map((step) => {
    if (step.type === "branch") {
      const node: Pending = {
        key: step.key,
        label: step.label,
        kind: "branch",
        loc: pickLoc(step),
        depth,
        steps: step.children,
      };
      if (owner) node.owner = owner;
      return node;
    }
    return pendingCall(
      side,
      step.key,
      depth,
      step.children,
      step,
      undefined,
      owner,
    );
  });
}

/** Definition body this node would expand, if any. */
function expandsBody(node: Pending): FunctionInfo | undefined {
  if (node.kind !== "call" || node.stop) return undefined;
  return node.info && node.info.steps.length > 0 ? node.info : undefined;
}

/** Recursion token pushed while this node's children expand. */
function token(node: Pending): string | undefined {
  if (node.kind !== "call" || !node.info) return undefined;
  if (node.stop === "leaf" || node.stop === "cycle") return undefined;
  return fileScopedKey(node.info.file, node.info.key);
}

function children(side: Side, node: Pending, omitBody: boolean): Pending[] {
  if (node.kind === "branch") {
    return pendingSteps(side, node.steps ?? [], node.depth, node.owner);
  }
  if (node.stop === "leaf") return [];
  const callSite = node.steps
    ? pendingSteps(side, node.steps, node.depth + 1, node.owner)
    : [];
  if (node.stop === "cycle" || node.stop === "unchanged" || omitBody) {
    return callSite;
  }
  const body = node.info
    ? pendingSteps(side, node.info.steps, node.depth + 1, node.info)
    : [];
  return [...body, ...callSite];
}

/** LCS alignment of two child lists by key (same rules as `diffTrees`). */
function align(
  before: Pending[],
  after: Pending[],
): Array<[Pending | null, Pending | null]> {
  const n = before.length;
  const m = after.length;
  const bk = before.map((node) => node.key);
  const ak = after.map((node) => node.key);
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        bk[i] === ak[j]
          ? dp[(i + 1) * width + j + 1]! + 1
          : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
    }
  }

  const pairs: Array<[Pending | null, Pending | null]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (bk[i] === ak[j]) {
      pairs.push([before[i]!, after[j]!]);
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      pairs.push([before[i]!, null]);
      i += 1;
    } else {
      pairs.push([null, after[j]!]);
      j += 1;
    }
  }
  for (; i < n; i++) pairs.push([before[i]!, null]);
  for (; j < m; j++) pairs.push([null, after[j]!]);
  return pairs;
}

type WalkState = {
  before: Side;
  after: Side;
  /** Definition pair → shallowest depth an expansion of it showed a change. */
  expanded: Map<string, number>;
};

/**
 * @param aligned both sides reached this pair through ancestors that entered
 *   the same definitions, so they expand under the same recursion context.
 */
function walk(
  b: Pending | null,
  a: Pending | null,
  state: WalkState,
  aligned: boolean,
): DiffNode {
  const status: DiffStatus = b && a ? "same" : a ? "added" : "removed";
  const head = (a ?? b)!;
  const node: DiffNode = {
    key: head.key,
    label: head.label,
    status,
    children: [],
  };
  const kind = a?.kind ?? b?.kind;
  if (kind) node.kind = kind;
  Object.assign(node, pickLoc(a?.loc.file ? a.loc : (b?.loc ?? a?.loc)));

  if (b && a && (b.stop === "unchanged" || a.stop === "unchanged")) {
    const same =
      aligned &&
      b.stop === "unchanged" &&
      a.stop === "unchanged" &&
      state.before.id(b.info!) === state.after.id(a.info!);
    if (!same) {
      // Expand both, as `--full` would: they may differ.
      if (b.stop === "unchanged") delete b.stop;
      if (a.stop === "unchanged") delete a.stop;
    }
  }
  if (b?.stop === "unchanged" || a?.stop === "unchanged") {
    node.collapsed = "unchanged";
  }

  const bBody = b ? expandsBody(b) : undefined;
  const aBody = a ? expandsBody(a) : undefined;
  let omitBody = false;
  let pair: string | undefined;
  if ((bBody || aBody) && (aligned || status !== "same")) {
    pair = [
      status,
      bBody ? state.before.id(bBody) : "",
      aBody ? state.after.id(aBody) : "",
    ].join("\0");
    const seenAt = state.expanded.get(pair);
    if (seenAt !== undefined && seenAt <= head.depth) {
      omitBody = true;
      node.collapsed = "repeat";
    }
  }

  const bToken = b ? token(b) : undefined;
  const aToken = a ? token(a) : undefined;
  if (bToken) state.before.visiting.add(bToken);
  if (aToken) state.after.visiting.add(aToken);

  const bKids = b ? children(state.before, b, omitBody) : [];
  const aKids = a ? children(state.after, a, omitBody) : [];
  if (b && a) {
    const childAligned = aligned && bToken === aToken;
    node.children = align(bKids, aKids).map(([x, y]) =>
      walk(x, y, state, childAligned),
    );
  } else if (a) {
    node.children = aKids.map((child) => walk(null, child, state, false));
  } else {
    node.children = bKids.map((child) => walk(child, null, state, false));
  }

  if (bToken) state.before.visiting.delete(bToken);
  if (aToken) state.after.visiting.delete(aToken);

  if (pair && !omitBody && treeHasChanges(node)) {
    const seenAt = state.expanded.get(pair);
    if (seenAt === undefined || head.depth < seenAt) {
      state.expanded.set(pair, head.depth);
    }
  }
  return node;
}

export type WalkRoot = {
  key: string;
  /** Pin the root to this definition instead of resolving `key`. */
  info?: FunctionInfo;
};

/**
 * Diff one entry. A missing side (`null`) makes the whole tree added or
 * removed, like `diffTrees` against an empty tree.
 */
export function walkDiff(
  beforeRoot: WalkRoot | null,
  afterRoot: WalkRoot | null,
  before: DiffSide,
  after: DiffSide,
  affected: Set<string>,
  maxDepth: number,
): DiffNode {
  const side = (s: DiffSide): Side => ({
    ...s,
    affected,
    maxDepth,
    visiting: new Set(),
  });
  const state: WalkState = {
    before: side(before),
    after: side(after),
    expanded: new Map(),
  };
  const root = (s: Side, r: WalkRoot | null): Pending | null =>
    r ? pendingCall(s, r.key, 0, undefined, undefined, r.info, undefined) : null;
  return walk(
    root(state.before, beforeRoot),
    root(state.after, afterRoot),
    state,
    true,
  );
}
