/**
 * Detect JS/TS re-exports so missing-entry errors can hint at barrel files.
 *
 * Uses source text (not a second tree-sitter parse) so indexing stays cheap and
 * does not contend with the main extractor parser.
 */
import { dirname, join, normalize } from "node:path";
import type { SnapshotFile } from "./git.js";
import { readSnapshotFiles } from "./git.js";
import { detectLanguage } from "./languages/registry.js";
import type { FunctionInfo, Snapshot } from "./types.js";

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
  const namedRe =
    /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
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
  extract: (file: string, source: string) => FunctionInfo[],
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
    const exported = extract(path, source).filter((fn) => fn.exported);
    for (const barrel of barrels) {
      for (const fn of exported) {
        const bare = fn.key.includes(".")
          ? (fn.key.split(".").pop() ?? fn.key)
          : fn.key;
        named.push({
          name: bare,
          file: barrel.file,
          fromModule: barrel.fromModule,
        });
        if (bare !== fn.key) {
          named.push({
            name: fn.key,
            file: barrel.file,
            fromModule: barrel.fromModule,
          });
        }
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
