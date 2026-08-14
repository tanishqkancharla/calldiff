/**
 * Reconstruct before/after file contents from a unified-style diff.
 *
 * Accepts a full-file diff where every source line is prefixed with
 * ` ` (unchanged), `-` (removed), or `+` (added). Also skips unified
 * headers (`---`, `+++`, `@@`).
 *
 * Used by e2e language tests to seed two git commits from one compact
 * +/- fixture.
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
