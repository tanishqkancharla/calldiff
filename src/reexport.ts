/**
 * Detect JS/TS re-exports so missing-entry errors can hint at barrel files.
 *
 * Uses source text (not tree-sitter) so indexing stays cheap and does not
 * contend with the main extractor parser under parallel CLI tests.
 */
import { dirname, join, normalize } from "node:path";
import type { SnapshotFile } from "./git.js";
import { readSnapshotFiles } from "./git.js";
import { detectLanguage } from "./languages/registry.js";
import type { Snapshot } from "./types.js";

export type ReexportInfo = {
  /** Exported binding name, or `"*"` for `export * from`. */
  name: string;
  /** File that contains the re-export. */
  file: string;
  /** Module specifier in the `from` clause. */
  fromModule: string;
};

function isJsTs(file: string): boolean {
  const lang = detectLanguage(file)?.id;
  return (
    lang === "typescript" ||
    lang === "typescriptreact" ||
    lang === "javascript" ||
    lang === "javascriptreact"
  );
}

/** Collect named / star re-exports from a JS or TS source file. */
export function collectReexports(file: string, source: string): ReexportInfo[] {
  if (!isJsTs(file)) return [];
  const out: ReexportInfo[] = [];

  // export { a, b as c, default as d } from "...";
  const namedRe = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(namedRe)) {
    const fromModule = match[2]!;
    for (const part of match[1]!.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const bits = trimmed.split(/\s+as\s+/i);
      const exportedName = (bits[bits.length - 1] ?? "").trim();
      if (exportedName) out.push({ name: exportedName, file, fromModule });
    }
  }

  // export * from "..."  (not export * as ns from)
  const starRe = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(starRe)) {
    out.push({ name: "*", file, fromModule: match[1]! });
  }

  return out;
}

/** Binding names a module defines and exports (not re-exports). */
export function exportedBindingNames(source: string): string[] {
  const names = new Set<string>();

  const declRe =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declRe)) {
    names.add(match[1]!);
  }

  // export default function () {} / export default class {} — treat as "default"
  if (
    /export\s+default\s+(?:async\s+)?(?:function\*?|class)\b/.test(source) ||
    /export\s+default\s+/.test(source)
  ) {
    // only add default when it's an anonymous default export form
    if (/export\s+default\s+(?:async\s+)?(?:function\*?|class)\s*[\(<]/.test(source)) {
      names.add("default");
    }
  }

  // Local `export { foo, bar as baz }` (no from)
  const localClauseRe = /export\s*\{([^}]*)\}(?!\s*from)/g;
  for (const match of source.matchAll(localClauseRe)) {
    for (const part of match[1]!.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const bits = trimmed.split(/\s+as\s+/i);
      const exportedName = (bits[bits.length - 1] ?? "").trim();
      if (exportedName) names.add(exportedName);
    }
  }

  return [...names];
}

function moduleCandidates(fromFile: string, specifier: string): string[] {
  if (!specifier.startsWith(".")) return [];
  const base = normalize(join(dirname(fromFile), specifier));
  const stripped = base.replace(/\.(?:[cm]?[jt]sx?)$/i, "");
  return [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${stripped}.mts`,
    `${stripped}.cts`,
    `${stripped}.js`,
    `${stripped}.jsx`,
    `${stripped}.mjs`,
    `${stripped}.cjs`,
    join(stripped, "index.ts"),
    join(stripped, "index.tsx"),
    join(stripped, "index.js"),
    join(stripped, "index.jsx"),
  ];
}

function resolveModulePath(
  fromFile: string,
  specifier: string,
  available: Map<string, SnapshotFile>,
): SnapshotFile | null {
  for (const candidate of moduleCandidates(fromFile, specifier)) {
    const hit = available.get(candidate) ?? available.get(normalize(candidate));
    if (hit) return hit;
  }
  return null;
}

/**
 * Expand `export * from` into concrete names by reading the target module
 * (even when it sits outside the caller's path filter).
 */
export function expandReexports(
  cwd: string,
  snapshot: Snapshot,
  records: ReexportInfo[],
  availableFiles: SnapshotFile[],
): ReexportInfo[] {
  const available = new Map(availableFiles.map((f) => [f.path, f]));
  const named: ReexportInfo[] = [];
  const starTargets = new Map<string, ReexportInfo>();

  for (const rec of records) {
    if (rec.name === "*") {
      starTargets.set(`${rec.file}\0${rec.fromModule}`, rec);
    } else {
      named.push(rec);
    }
  }

  if (starTargets.size === 0) return named;

  const toRead: SnapshotFile[] = [];
  const starByTarget = new Map<string, ReexportInfo[]>();
  for (const rec of starTargets.values()) {
    const target = resolveModulePath(rec.file, rec.fromModule, available);
    if (!target) continue;
    toRead.push(target);
    const list = starByTarget.get(target.path) ?? [];
    list.push(rec);
    starByTarget.set(target.path, list);
  }

  if (toRead.length === 0) return named;

  const sources = readSnapshotFiles(cwd, snapshot, toRead);
  for (const [path, source] of sources) {
    const barrels = starByTarget.get(path) ?? [];
    for (const name of exportedBindingNames(source)) {
      for (const barrel of barrels) {
        named.push({
          name,
          file: barrel.file,
          fromModule: barrel.fromModule,
        });
      }
    }
  }

  return named;
}

/** Hint when a missing symbol exists only as a re-export in the indexed paths. */
export function reexportHint(
  entry: string,
  reexports: ReexportInfo[],
): string | undefined {
  const stripped = entry.replace(/\(\)$/, "");
  const files = [
    ...new Set(
      reexports
        .filter(
          (r) =>
            r.name === entry ||
            r.name === stripped ||
            r.name.endsWith(`.${stripped}`),
        )
        .map((r) => r.file),
    ),
  ].sort();
  if (files.length === 0) return undefined;
  if (files.length === 1) {
    return `Symbol found only as a re-export in ${files[0]}`;
  }
  return `Symbol found only as a re-export in ${files.join(", ")}`;
}
