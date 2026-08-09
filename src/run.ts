import { relative, resolve } from "node:path";
import { parseArgs, printHelp } from "./args.js";
import { buildIndex } from "./extract.js";
import {
  describeSnapshot,
  normalizePathFilters,
  repositoryRoot,
  resolveCommit,
  resolveSnapshots,
  verifyCommit,
} from "./git.js";
import { diffEntry, inferEntries } from "./infer.js";
import { loadFunctions } from "./load.js";
import { renderDiff } from "./render.js";
import { buildRepositoryCallSnapshot } from "./repository-snapshot.js";
import { writeRepositoryCallSnapshotBundle } from "./repository-snapshot-output.js";
import type { FunctionIndex } from "./extract.js";
import type { Snapshot, SnapshotCliOptions } from "./types.js";

function loadIndex(
  cwd: string,
  snapshot: Snapshot,
  pathFilters: string[],
): FunctionIndex {
  const loaded = loadFunctions(cwd, snapshot, pathFilters);
  for (const diagnostic of loaded.diagnostics) {
    console.error(
      `warn: failed to parse ${diagnostic.file} @ ${snapshot.ref}: ${diagnostic.message}`,
    );
  }
  return buildIndex(loaded.functions);
}

function runSnapshot(options: SnapshotCliOptions, repoRoot: string): number {
  if (!options.output) {
    console.error("Missing required snapshot option: --output <directory>");
    return 2;
  }

  const commit = resolveCommit(repoRoot, options.ref);
  const pathFilters = normalizePathFilters(options.paths);
  const loaded = loadFunctions(
    repoRoot,
    { kind: "commit", ref: commit },
    pathFilters,
    { failOnReadError: true },
  );
  const snapshot = buildRepositoryCallSnapshot(loaded, {
    requestedRef: options.ref,
    commit,
    pathFilters,
  });
  const outputDirectory = resolve(options.cwd, options.output);
  const written = writeRepositoryCallSnapshotBundle(snapshot, outputDirectory);
  const summary = snapshot.summary;

  console.log(
    `calldiff snapshot ${commit.slice(0, 12)}: ${summary.definitions} definitions, ${summary.calls} calls, ${summary.branches} branches`,
  );
  console.log(`machine: ${relative(options.cwd, written.jsonPath)}`);
  console.log(`human:   ${relative(options.cwd, written.htmlPath)}`);
  if (summary.parseWarnings > 0) {
    console.error(
      `warn: ${summary.parseWarnings} files failed to parse; inspect diagnostics in the JSON snapshot`,
    );
  }
  return 0;
}

export async function run(
  argv: string[],
  invocationCwd = process.cwd(),
): Promise<number> {
  let options;
  try {
    options = parseArgs(argv, invocationCwd);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    printHelp();
    return 2;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  const cwd = repositoryRoot(options.cwd);

  if (options.command === "snapshot") {
    try {
      return runSnapshot(options, cwd);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return 1;
    }
  }

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
