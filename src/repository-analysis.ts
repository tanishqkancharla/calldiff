import { createHash } from "node:crypto";
import { extractFunctions } from "./extract.js";
import { detectLanguage } from "./languages/registry.js";
import type { LoadedFunctions, ParseDiagnostic } from "./load.js";
import type { FunctionInfo } from "./types.js";
import {
  buildRepositoryCallSnapshot,
  type RepositoryCallSnapshot,
  type RepositoryCallSource,
  type RepositoryDefinition,
} from "./repository-snapshot.js";

export interface FrozenRepositoryFile {
  path: string;
  content: string;
}

export const REPOSITORY_CALL_DELTA_SCHEMA =
  "calldiff-repository-call-delta/1" as const;
export const REPOSITORY_CALL_PROJECTION_SCHEMA =
  "calldiff-repository-call-projection/1" as const;

export interface RepositoryDefinitionChange {
  matchId: string;
  change: "added" | "removed" | "changed";
  before?: RepositoryDefinition;
  after?: RepositoryDefinition;
}

export interface RepositoryCallDelta {
  schema: typeof REPOSITORY_CALL_DELTA_SCHEMA;
  before: RepositoryCallSource;
  after: RepositoryCallSource;
  summary: {
    addedDefinitions: number;
    removedDefinitions: number;
    changedDefinitions: number;
    unchangedDefinitions: number;
  };
  changes: RepositoryDefinitionChange[];
}

export interface RepositoryCallProjection {
  schema: typeof REPOSITORY_CALL_PROJECTION_SCHEMA;
  source: RepositoryCallSource;
  selectedFiles: string[];
  includedFiles: string[];
  omittedDefinitions: number;
  definitions: RepositoryDefinition[];
  diagnostics: ParseDiagnostic[];
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Analyze exact frozen file contents without reading a repository or worktree. */
export function analyzeRepositoryFiles(
  files: readonly FrozenRepositoryFile[],
  subjectId: string,
): RepositoryCallSnapshot {
  const ordered = [...files]
    .map((file) => ({ path: file.path.replaceAll("\\", "/"), content: file.content }))
    .sort((left, right) => compareText(left.path, right.path));
  const duplicate = ordered.find(
    (file, index) => index > 0 && ordered[index - 1]!.path === file.path,
  );
  if (duplicate) throw new Error(`Duplicate frozen file path: ${duplicate.path}`);

  const supported = ordered.filter((file) => detectLanguage(file.path));
  const functions: FunctionInfo[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  for (const file of supported) {
    try {
      functions.push(...extractFunctions(file.path, file.content));
    } catch (error) {
      diagnostics.push({
        file: file.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const loaded: LoadedFunctions = {
    files: supported.map((file) => file.path),
    functions,
    sources: new Map(supported.map((file) => [file.path, file.content])),
    diagnostics,
  };
  return buildRepositoryCallSnapshot(loaded, {
    kind: "frozen-files",
    subjectId,
    fileDigests: supported.map((file) => ({
      path: file.path,
      sha256: sha256(file.content),
    })),
  });
}

function matchedDefinitions(
  definitions: readonly RepositoryDefinition[],
): Map<string, RepositoryDefinition> {
  const counts = new Map<string, number>();
  const matched = new Map<string, RepositoryDefinition>();
  for (const definition of definitions) {
    const base = `${definition.file}:${definition.key}`;
    const ordinal = (counts.get(base) ?? 0) + 1;
    counts.set(base, ordinal);
    matched.set(`${base}#${ordinal}`, definition);
  }
  return matched;
}

function structure(definition: RepositoryDefinition): string {
  return JSON.stringify({ exported: definition.exported, steps: definition.steps });
}

/** Compare two retained call snapshots without parsing source again. */
export function diffRepositoryCallSnapshots(
  before: RepositoryCallSnapshot,
  after: RepositoryCallSnapshot,
): RepositoryCallDelta {
  const beforeById = matchedDefinitions(before.definitions);
  const afterById = matchedDefinitions(after.definitions);
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort(
    compareText,
  );
  const changes: RepositoryDefinitionChange[] = [];
  let unchangedDefinitions = 0;

  for (const matchId of ids) {
    const previous = beforeById.get(matchId);
    const next = afterById.get(matchId);
    if (!previous) {
      changes.push({ matchId, change: "added", after: next });
    } else if (!next) {
      changes.push({ matchId, change: "removed", before: previous });
    } else if (structure(previous) !== structure(next)) {
      changes.push({ matchId, change: "changed", before: previous, after: next });
    } else {
      unchangedDefinitions += 1;
    }
  }

  return {
    schema: REPOSITORY_CALL_DELTA_SCHEMA,
    before: before.source,
    after: after.source,
    summary: {
      addedDefinitions: changes.filter((change) => change.change === "added").length,
      removedDefinitions: changes.filter((change) => change.change === "removed").length,
      changedDefinitions: changes.filter((change) => change.change === "changed").length,
      unchangedDefinitions,
    },
    changes,
  };
}

function visitsTarget(
  definition: RepositoryDefinition,
  matchingDefinitionIds: ReadonlySet<string>,
): boolean {
  const pending = [...definition.steps];
  while (pending.length) {
    const step = pending.pop()!;
    if (step.type === "branch") pending.push(...step.children);
    else if (
      step.matchingDefinitionIds.some((id) => matchingDefinitionIds.has(id))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Select definitions from named files plus direct key matches and callers.
 * The canonical snapshot remains authoritative and records omitted counts.
 */
export function projectRepositoryCallSnapshot(
  snapshot: RepositoryCallSnapshot,
  selectedFiles: readonly string[],
): RepositoryCallProjection {
  const selected = new Set(selectedFiles.map((path) => path.replaceAll("\\", "/")));
  const seeds = snapshot.definitions.filter((definition) => selected.has(definition.file));
  const seedIds = new Set(seeds.map((definition) => definition.id));
  const includedIds = new Set(seedIds);
  const pending = [...seeds];
  while (pending.length) {
    const definition = pending.pop()!;
    const steps = [...definition.steps];
    while (steps.length) {
      const step = steps.pop()!;
      if (step.type === "branch") steps.push(...step.children);
      else for (const id of step.matchingDefinitionIds) includedIds.add(id);
    }
  }
  for (const definition of snapshot.definitions) {
    if (visitsTarget(definition, seedIds)) includedIds.add(definition.id);
  }
  const definitions = snapshot.definitions.filter((definition) =>
    includedIds.has(definition.id),
  );
  return {
    schema: REPOSITORY_CALL_PROJECTION_SCHEMA,
    source: snapshot.source,
    selectedFiles: [...selected].sort(compareText),
    includedFiles: [...new Set(definitions.map((definition) => definition.file))].sort(
      compareText,
    ),
    omittedDefinitions: snapshot.definitions.length - definitions.length,
    definitions,
    diagnostics: snapshot.diagnostics,
  };
}
