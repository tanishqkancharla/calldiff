import type { SourceLoc } from "./types.js";

/** Pick optional loc fields for spreading onto a node/step. */
export function pickLoc(
  loc:
    | { file?: string; line?: number; endLine?: number }
    | null
    | undefined,
): Partial<SourceLoc> {
  if (!loc?.file || loc.line == null) return {};
  if (loc.endLine != null && loc.endLine !== loc.line) {
    return { file: loc.file, line: loc.line, endLine: loc.endLine };
  }
  return { file: loc.file, line: loc.line };
}

/** Format as `file:line` or `file:line-line`. */
export function formatSourceLoc(loc: SourceLoc): string {
  const range =
    loc.endLine != null && loc.endLine !== loc.line
      ? `${loc.line}-${loc.endLine}`
      : String(loc.line);
  return `${loc.file}:${range}`;
}

/**
 * Convert byte offsets in `source` to 1-based line numbers.
 * `end` is exclusive (tree-sitter endIndex).
 */
export function linesFromOffsets(
  source: string,
  start: number,
  end: number,
): { line: number; endLine?: number } {
  let line = 1;
  for (let i = 0; i < start && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  let endLine = line;
  const last = Math.max(start, end - 1);
  for (let i = start; i < last && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) endLine += 1;
  }
  return endLine > line ? { line, endLine } : { line };
}
