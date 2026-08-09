import { buildCallTree } from "../src/calltree.js";
import { diffTrees } from "../src/diff.js";
import { buildIndex, extractFunctions } from "../src/extract.js";
import { renderDiff, renderTree } from "../src/render.js";

export type CallstackDiffOptions = {
  maxDepth?: number;
  /** Filename used for language detection (e.g. `file.tsx`). */
  file?: string;
};

/**
 * Reconstruct before/after file contents from a unified-style diff.
 *
 * Accepts a full-file diff where every source line is prefixed with
 * ` ` (unchanged), `-` (removed), or `+` (added). Also skips unified
 * headers (`---`, `+++`, `@@`).
 */
export function sourcesFromFileDiff(fileDiff: string): {
  before: string;
  after: string;
} {
  const before: string[] = [];
  const after: string[] = [];

  for (const raw of fileDiff.split("\n")) {
    if (
      raw.startsWith("---") ||
      raw.startsWith("+++") ||
      raw.startsWith("@@") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ")
    ) {
      continue;
    }

    // "\ No newline at end of file"
    if (raw.startsWith("\\")) continue;

    const marker = raw[0];
    const content = raw.length > 0 ? raw.slice(1) : "";

    if (marker === "-") {
      before.push(content);
    } else if (marker === "+") {
      after.push(content);
    } else if (marker === " " || raw === "") {
      // Context line (leading space) or blank line treated as context
      const line = marker === " " ? content : raw;
      before.push(line);
      after.push(line);
    } else {
      // No prefix — treat the whole line as unchanged context
      before.push(raw);
      after.push(raw);
    }
  }

  return {
    before: before.join("\n"),
    after: after.join("\n"),
  };
}

function snapshotNames(file: string): { before: string; after: string } {
  const match = file.match(/(\.[^.]+)$/);
  const ext = match?.[1] ?? ".ts";
  const base = match ? file.slice(0, -ext.length) : file;
  const stem = base || "file";
  return { before: `${stem}.before${ext}`, after: `${stem}.after${ext}` };
}

/**
 * Diff callstacks for an entrypoint given a source file diff.
 * Returns colorless ASCII output suitable for assertions.
 */
export function callstackDiff(
  fileDiff: string,
  entry: string,
  options: CallstackDiffOptions = {},
): string {
  const maxDepth = options.maxDepth ?? 12;
  const { before: beforeName, after: afterName } = snapshotNames(
    options.file ?? "file.ts",
  );
  const { before: beforeSource, after: afterSource } =
    sourcesFromFileDiff(fileDiff);

  const before = buildIndex(extractFunctions(beforeName, beforeSource));
  const after = buildIndex(extractFunctions(afterName, afterSource));

  const beforeTree = buildCallTree(entry, before, maxDepth);
  const afterTree = buildCallTree(entry, after, maxDepth);
  const diff = diffTrees(beforeTree, afterTree);
  return renderDiff(diff, { color: false });
}

/**
 * Expand a call tree for an entrypoint from a single source file.
 * Returns colorless ASCII output (no +/- markers).
 */
export function callstackShow(
  source: string,
  entry: string,
  options: CallstackDiffOptions = {},
): string {
  const maxDepth = options.maxDepth ?? 12;
  const file = options.file ?? "file.ts";
  const index = buildIndex(extractFunctions(file, source));
  const tree = buildCallTree(entry, index, maxDepth);
  return renderTree(tree, { color: false });
}
