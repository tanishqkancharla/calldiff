/**
 * Outdent +/- diff strings (file diffs and callstack diffs).
 *
 * Unlike plain outdent, lines that start with `+` / `-` set the indent
 * level — so markers aren't eaten when unchanged lines are indented further.
 */
export function diffOutdent(text: string): string {
  if (text.startsWith("\n")) text = text.slice(1);
  if (text.endsWith("\n")) text = text.slice(0, -1);

  const lines = text.split("\n");
  const indents: number[] = [];

  for (const line of lines) {
    if (line.trim() === "") continue;
    const marker = line.match(/^(\s*)[+-]/);
    if (marker) {
      indents.push(marker[1]!.length);
      continue;
    }
    const leading = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    indents.push(leading);
  }

  // Prefer the column of +/- markers when present; otherwise normal outdent.
  const markerIndents = lines
    .map((line) => line.match(/^(\s*)[+-]/)?.[1]?.length)
    .filter((n): n is number => n !== undefined);

  const indent =
    markerIndents.length > 0
      ? Math.min(...markerIndents)
      : indents.length > 0
        ? Math.min(...indents)
        : 0;

  return lines
    .map((line) => {
      const leading = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      return line.slice(Math.min(indent, leading));
    })
    .join("\n")
    .replace(/\n+$/, "");
}
