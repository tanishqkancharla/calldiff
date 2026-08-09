import pc from "picocolors";
import type { CallNode, DiffNode, DiffStatus } from "./types.js";

function paint(status: DiffStatus, text: string): string {
  switch (status) {
    case "added":
      return pc.blue(text);
    case "removed":
      return pc.magenta(text);
    default:
      return text;
  }
}

function prefix(status: DiffStatus): string {
  switch (status) {
    case "added":
      return pc.blue("+");
    case "removed":
      return pc.magenta("-");
    default:
      return " ";
  }
}

export interface RenderOptions {
  /** When false, skip ANSI colors (useful for tests). Default: true */
  color?: boolean;
}

type TreeLike = {
  label: string;
  kind?: CallNode["kind"];
  children: TreeLike[];
  status?: DiffStatus;
};

function renderAsciiTree(
  root: TreeLike,
  options: RenderOptions,
  withStatus: boolean,
): string {
  const useColor = options.color !== false;

  const paintStatus = (status: DiffStatus, text: string): string =>
    useColor ? paint(status, text) : text;

  const statusPrefix = (status: DiffStatus): string => {
    if (!useColor) {
      switch (status) {
        case "added":
          return "+";
        case "removed":
          return "-";
        default:
          return " ";
      }
    }
    return prefix(status);
  };

  const lines: string[] = [];

  const walk = (
    node: TreeLike,
    indent: string,
    isLast: boolean,
    isRoot: boolean,
  ) => {
    const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
    const label = withStatus
      ? paintStatus(node.status ?? "same", node.label)
      : node.label;
    const line = withStatus
      ? `${statusPrefix(node.status ?? "same")} ${indent}${branch}${label}`
      : `${indent}${branch}${label}`;
    lines.push(line);

    // Conditional arms omit the continuing │ rail — they are alternate paths,
    // not a nested stack that continues past the branch.
    const rail =
      node.kind === "branch" ? "   " : isLast || isRoot ? "   " : "│  ";
    const childIndent = isRoot ? "" : `${indent}${rail}`;

    node.children.forEach((child, index) => {
      walk(
        child,
        childIndent,
        index === node.children.length - 1,
        false,
      );
    });
  };

  walk(root, "", true, true);
  return lines.join("\n");
}

/**
 * Render a callstack diff as an ASCII tree with +/- markers.
 */
export function renderDiff(
  root: DiffNode,
  options: RenderOptions = {},
): string {
  return renderAsciiTree(root, options, true);
}

/**
 * Render a single call tree as an ASCII tree (no +/- markers).
 */
export function renderTree(
  root: CallNode,
  options: RenderOptions = {},
): string {
  return renderAsciiTree(root, options, false);
}
