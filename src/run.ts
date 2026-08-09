import { parseArgs, printHelp } from "./args.js";
import { buildCallTree, resolveEntry } from "./calltree.js";
import { buildIndex, extractFunctions } from "./extract.js";
import {
  assertGitRepo,
  describeSnapshot,
  listTsFiles,
  readSnapshotFile,
  resolveSnapshot,
  resolveSnapshots,
  verifyCommit,
} from "./git.js";
import { diffEntry, inferEntries } from "./infer.js";
import { renderDiff, renderTree } from "./render.js";
import type { Snapshot } from "./types.js";
import type { FunctionIndex } from "./extract.js";

function loadIndex(
  cwd: string,
  snapshot: Snapshot,
  pathFilters: string[],
): FunctionIndex {
  const files = listTsFiles(cwd, snapshot, pathFilters);
  const all = [];
  for (const file of files) {
    const source = readSnapshotFile(cwd, snapshot, file);
    if (source === null) continue;
    try {
      all.push(...extractFunctions(file, source));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`warn: failed to parse ${file} @ ${snapshot.ref}: ${message}`);
    }
  }
  return buildIndex(all);
}

function resolveShowEntries(index: FunctionIndex, explicit: string[]): string[] {
  const resolved: string[] = [];
  for (const entry of explicit) {
    const key = resolveEntry(entry, index);
    if (!key) {
      throw new Error(`Entrypoint not found: ${entry}`);
    }
    if (!resolved.includes(key)) resolved.push(key);
  }
  return resolved;
}

async function runShow(
  cwd: string,
  options: ReturnType<typeof parseArgs>,
): Promise<number> {
  const snapshot = resolveSnapshot(options.from);
  if (snapshot.kind === "commit") verifyCommit(cwd, snapshot.ref);

  const index = loadIndex(cwd, snapshot, options.paths);

  let entries: string[];
  try {
    entries = resolveShowEntries(index, options.entries);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }

  console.log(`calldiff show ${describeSnapshot(snapshot)}\n`);

  let printed = 0;
  for (const entry of entries) {
    const tree = buildCallTree(entry, index, options.maxDepth);
    if (printed > 0) console.log("");
    console.log(renderTree(tree));
    printed += 1;
  }

  return 0;
}

async function runDiff(
  cwd: string,
  options: ReturnType<typeof parseArgs>,
): Promise<number> {
  const { from, to } = resolveSnapshots(options.from, options.to);
  if (from.kind === "commit") verifyCommit(cwd, from.ref);
  if (to.kind === "commit") verifyCommit(cwd, to.ref);

  const before = loadIndex(cwd, from, options.paths);
  const after = loadIndex(cwd, to, options.paths);

  let entries: string[];
  try {
    entries = inferEntries(before, after, options.entries, options.maxDepth);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }

  if (entries.length === 0) {
    console.log(
      `No callstack changes between ${describeSnapshot(from)} and ${describeSnapshot(to)}.`,
    );
    return 0;
  }

  console.log(
    `calldiff ${describeSnapshot(from)} → ${describeSnapshot(to)}\n`,
  );

  let printed = 0;
  for (const entry of entries) {
    const diff = diffEntry(entry, before, after, options.maxDepth);
    if (!diff) continue;
    if (printed > 0) console.log("");
    console.log(renderDiff(diff));
    printed += 1;
  }

  if (printed === 0) {
    console.log("No callstack changes for inferred entrypoints.");
  }

  return 0;
}

export async function run(argv: string[]): Promise<number> {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    printHelp();
    return 2;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  const cwd = options.cwd;
  assertGitRepo(cwd);

  if (options.mode === "show") {
    return runShow(cwd, options);
  }

  return runDiff(cwd, options);
}
