/**
 * React hook dependency arrays (JS / TS / JSX / TSX).
 *
 * Effects and memoization hooks re-run when their dependency array changes,
 * so the deps are part of the call's identity. Including them in the call key
 * renders them in labels (`useEffect([userId])`) and lets them participate in
 * diff matching, which makes dep-array churn visible in `calldiff diff`.
 */
import {
  childByType,
  collapseWs,
  namedChildren,
  type SyntaxNode,
} from "./types.js";

/** Hook name → position of its dependency-array argument. */
const DEPS_ARG_INDEX: Record<string, number> = {
  useEffect: 1,
  useLayoutEffect: 1,
  useInsertionEffect: 1,
  useMemo: 1,
  useCallback: 1,
  useImperativeHandle: 2,
};

/** Keep labels one-line friendly when a dep list is unusually long. */
const MAX_DEPS_TEXT = 60;

/**
 * Append a React hook's dependency-array literal to its call key:
 * `useEffect` → `useEffect([userId, refresh])`, `useEffect([])` for
 * mount-only. Non-hook calls, hooks called without a deps argument, and
 * non-literal deps (e.g. a spread or identifier) pass through unchanged.
 */
export function withHookDeps(key: string, callNode: SyntaxNode): string {
  const name = key.slice(key.lastIndexOf(".") + 1);
  const depsIndex = DEPS_ARG_INDEX[name];
  if (depsIndex === undefined) return key;

  const args = childByType(callNode, "arguments");
  if (!args) return key;
  const argNodes = namedChildren(args).filter((c) => c.type !== "comment");
  const deps = argNodes[depsIndex];
  if (!deps || deps.type !== "array") return key;

  let text = collapseWs(deps.text);
  if (text.length > MAX_DEPS_TEXT) {
    text = `${text.slice(0, MAX_DEPS_TEXT - 1)}…]`;
  }
  return `${key}(${text})`;
}
