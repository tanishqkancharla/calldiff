import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listSupportedExtensions } from "./languages/registry.js";
import type {
  Snapshot,
  SnapshotPair,
  SnapshotPairWithPaths,
  SnapshotWithPaths,
} from "./types.js";

function gitBuffer(
  cwd: string,
  args: string[],
  input?: Buffer,
  maxBuffer = 64 * 1024 * 1024,
): Buffer {
  return execFileSync("git", args, {
    cwd,
    input,
    maxBuffer,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function git(cwd: string, args: string[]): string {
  return gitBuffer(cwd, args).toString("utf8");
}

export function assertGitRepo(cwd: string): void {
  try {
    git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

export function resolveSnapshots(
  from: string | undefined,
  to: string | undefined,
): SnapshotPair {
  // git-diff defaults: no args → HEAD vs worktree; one arg → that vs worktree
  const left: Snapshot = {
    kind: "commit",
    ref: from ?? "HEAD",
  };
  const right: Snapshot =
    to === undefined
      ? { kind: "worktree", ref: "WORKTREE" }
      : { kind: "commit", ref: to };
  return { from: left, to: right };
}

function isCommitRef(cwd: string, ref: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function isPathOnDisk(cwd: string, value: string): boolean {
  return existsSync(resolve(cwd, value));
}

/**
 * Resolve diff from/to/paths with git-diff defaults, treating on-disk path
 * positionals as path filters when they are not valid git refs.
 *
 * Examples:
 * - `diff main src` → main vs worktree, paths=[src]
 * - `diff main feature src` → main vs feature, paths=[src]
 * - `diff src` → HEAD vs worktree, paths=[src]
 */
export function resolveDiffSnapshotsAndPaths(
  cwd: string,
  from: string | undefined,
  to: string | undefined,
  paths: string[],
): SnapshotPairWithPaths {
  if (from === undefined && to === undefined) {
    return { ...resolveSnapshots(undefined, undefined), paths };
  }

  if (from !== undefined && to === undefined) {
    if (isCommitRef(cwd, from)) {
      return { ...resolveSnapshots(from, undefined), paths };
    }
    if (isPathOnDisk(cwd, from)) {
      return { ...resolveSnapshots(undefined, undefined), paths: [from, ...paths] };
    }
    throw new Error(`Unknown git ref: ${from}`);
  }

  if (from !== undefined && to !== undefined) {
    if (!isCommitRef(cwd, from)) {
      throw new Error(`Unknown git ref: ${from}`);
    }
    if (isCommitRef(cwd, to)) {
      return { ...resolveSnapshots(from, to), paths };
    }
    if (isPathOnDisk(cwd, to)) {
      return {
        ...resolveSnapshots(from, undefined),
        paths: [to, ...paths],
      };
    }
    throw new Error(`Unknown git ref: ${to}`);
  }

  // to without from shouldn't happen via CLI positionals, but honor options.
  return { ...resolveSnapshots(from, to), paths };
}

/** Single snapshot for `calldiff tree` / `reach` — no ref → working tree. */
export function resolveSnapshot(ref: string | undefined): Snapshot {
  if (ref === undefined) {
    return { kind: "worktree", ref: "WORKTREE" };
  }
  return { kind: "commit", ref };
}

/**
 * Resolve optional ref + path filters for tree/reach.
 * A lone positional that isn't a git ref but exists on disk is treated as a
 * path filter on the working tree (`calldiff tree -e foo src/lib`).
 */
export function resolveSnapshotAndPaths(
  cwd: string,
  ref: string | undefined,
  paths: string[],
): SnapshotWithPaths {
  if (ref === undefined) {
    return { snapshot: resolveSnapshot(undefined), paths };
  }

  try {
    git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
    return { snapshot: resolveSnapshot(ref), paths };
  } catch {
    const abs = resolve(cwd, ref);
    if (existsSync(abs)) {
      return {
        snapshot: resolveSnapshot(undefined),
        paths: [ref, ...paths],
      };
    }
    throw new Error(`Unknown git ref: ${ref}`);
  }
}

export function verifyCommit(cwd: string, ref: string): void {
  try {
    git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    throw new Error(`Unknown git ref: ${ref}`);
  }
}

const SOURCE_EXT = new Set(listSupportedExtensions());

function isSourceFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".d.ts")) return false;
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return SOURCE_EXT.has(lower.slice(dot));
}

export interface SnapshotFile {
  path: string;
  /** Git blob metadata. Worktree files do not have it. */
  oid?: string;
  size?: number;
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function listWorktreeFiles(cwd: string): SnapshotFile[] {
  const output = git(cwd, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);

  return output
    .split("\0")
    .filter(
      (path) =>
        path && isSourceFile(path) && isRegularFile(resolve(cwd, path)),
    )
    .map((path) => ({ path }));
}

function listCommitFiles(cwd: string, ref: string): SnapshotFile[] {
  const output = git(cwd, ["ls-tree", "-r", "-z", "-l", ref]);
  const files: SnapshotFile[] = [];

  for (const record of output.split("\0")) {
    if (!record) continue;

    const tab = record.indexOf("\t");
    if (tab < 0) continue;

    const [mode, type, oid, sizeText] = record
      .slice(0, tab)
      .trim()
      .split(/\s+/);
    const path = record.slice(tab + 1);
    const regular = mode === "100644" || mode === "100755";
    const size = Number(sizeText);
    if (
      regular &&
      type === "blob" &&
      oid &&
      Number.isInteger(size) &&
      isSourceFile(path)
    ) {
      files.push({ path, oid, size });
    }
  }

  return files;
}

function pathAllowed(file: string, pathFilters: string[]): boolean {
  if (pathFilters.length === 0) return true;
  return pathFilters.some((filter) => {
    const normalized = filter.replace(/^\.\//, "").replace(/\/$/, "");
    return (
      file === normalized ||
      file.startsWith(`${normalized}/`) ||
      file.endsWith(normalized)
    );
  });
}

export function listSnapshotFiles(
  cwd: string,
  snapshot: Snapshot,
  pathFilters: string[] = [],
): SnapshotFile[] {
  const files =
    snapshot.kind === "worktree"
      ? listWorktreeFiles(cwd)
      : listCommitFiles(cwd, snapshot.ref);

  return files
    .filter((file) => pathAllowed(file.path, pathFilters))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** @deprecated Use listSourceFiles */
export function listTsFiles(
  cwd: string,
  snapshot: Snapshot,
  pathFilters: string[] = [],
): string[] {
  return listSourceFiles(cwd, snapshot, pathFilters);
}

export function listSourceFiles(
  cwd: string,
  snapshot: Snapshot,
  pathFilters: string[] = [],
): string[] {
  return listSnapshotFiles(cwd, snapshot, pathFilters).map((file) => file.path);
}

const BATCH_BYTES = 32 * 1024 * 1024;

type Blob = { oid: string; size: number };

function chunkBlobs(files: SnapshotFile[]): Blob[][] {
  const unique = new Map<string, number>();
  for (const file of files) {
    if (file.oid && file.size !== undefined && !unique.has(file.oid)) {
      unique.set(file.oid, file.size);
    }
  }

  const chunks: Blob[][] = [];
  let chunk: Blob[] = [];
  let bytes = 0;
  for (const [oid, size] of unique) {
    if (chunk.length > 0 && bytes + size > BATCH_BYTES) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push({ oid, size });
    bytes += size;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function readBlobBatch(cwd: string, batch: Blob[]): Map<string, string> {
  const input = Buffer.from(`${batch.map((blob) => blob.oid).join("\n")}\n`);
  const bytes = batch.reduce((total, blob) => total + blob.size, 0);
  const maxBuffer = bytes + batch.length * 128 + 1024;
  const output = gitBuffer(cwd, ["cat-file", "--batch"], input, maxBuffer);
  const blobs = new Map<string, string>();
  let offset = 0;

  while (offset < output.length) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error("Invalid git cat-file response");

    const header = output.subarray(offset, headerEnd).toString("ascii");
    const [oid, type, sizeText] = header.split(" ");
    const size = Number(sizeText);
    if (!oid || type !== "blob" || !Number.isInteger(size)) {
      throw new Error(`Invalid git cat-file header: ${header}`);
    }

    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length) {
      throw new Error(`Truncated git blob: ${oid}`);
    }

    blobs.set(oid, output.subarray(contentStart, contentEnd).toString("utf8"));
    offset = contentEnd + 1;
  }

  return blobs;
}

export function visitCommitBlobs(
  cwd: string,
  files: SnapshotFile[],
  visit: (oid: string, source: string) => void,
): void {
  for (const batch of chunkBlobs(files)) {
    for (const [oid, source] of readBlobBatch(cwd, batch)) {
      visit(oid, source);
    }
  }
}

export function visitWorktreeFiles(
  cwd: string,
  files: SnapshotFile[],
  visit: (file: SnapshotFile, source: string) => void,
): void {
  for (const file of files) {
    const full = resolve(cwd, file.path);
    if (!isRegularFile(full)) continue;
    visit(file, readFileSync(full, "utf8"));
  }
}

export function readSnapshotFiles(
  cwd: string,
  snapshot: Snapshot,
  files: SnapshotFile[],
): Map<string, string> {
  const sources = new Map<string, string>();

  if (snapshot.kind === "worktree") {
    visitWorktreeFiles(cwd, files, (file, source) => {
      sources.set(file.path, source);
    });
    return sources;
  }

  const pathsByOid = new Map<string, string[]>();
  for (const file of files) {
    if (!file.oid) continue;
    const paths = pathsByOid.get(file.oid) ?? [];
    paths.push(file.path);
    pathsByOid.set(file.oid, paths);
  }
  visitCommitBlobs(cwd, files, (oid, source) => {
    for (const path of pathsByOid.get(oid) ?? []) {
      sources.set(path, source);
    }
  });
  return sources;
}

export function describeSnapshot(snapshot: Snapshot): string {
  return snapshot.kind === "worktree" ? "working tree" : snapshot.ref;
}
