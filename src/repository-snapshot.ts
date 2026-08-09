import { detectLanguage } from "./languages/registry.js";
import type { LoadedFunctions, ParseDiagnostic } from "./load.js";
import type { CallStep, FunctionInfo } from "./types.js";

export const REPOSITORY_CALL_SNAPSHOT_SCHEMA =
  "calldiff-repository-call-snapshot/1" as const;

export type CallKeyMatch =
  | "unique-key-match"
  | "multiple-key-matches"
  | "no-key-match";

export type RepositoryCallStep =
  | {
      type: "call";
      key: string;
      match: CallKeyMatch;
      matchingDefinitionIds: string[];
    }
  | {
      type: "branch";
      key: string;
      label: string;
      children: RepositoryCallStep[];
    };

export interface RepositoryDefinition {
  id: string;
  key: string;
  label: string;
  file: string;
  language: string;
  exported: boolean;
  span: {
    /** Zero-based UTF-16 code-unit offsets, matching tree-sitter's JS API. */
    startIndex: number;
    endIndex: number;
    startLine: number;
    endLine: number;
  };
  steps: RepositoryCallStep[];
}

export type RepositoryCallSource =
  | {
      kind: "commit";
      requestedRef: string;
      commit: string;
      pathFilters: string[];
    }
  | {
      kind: "frozen-files";
      subjectId: string;
      fileDigests: Array<{ path: string; sha256: string }>;
    };

export interface RepositoryCallSnapshot {
  schema: typeof REPOSITORY_CALL_SNAPSHOT_SCHEMA;
  source: RepositoryCallSource;
  summary: {
    sourceFiles: number;
    definitions: number;
    exportedDefinitions: number;
    collidingDefinitionKeys: number;
    calls: number;
    uniqueKeyMatchCalls: number;
    multipleKeyMatchCalls: number;
    noKeyMatchCalls: number;
    branches: number;
    parseWarnings: number;
  };
  files: string[];
  diagnostics: ParseDiagnostic[];
  definitions: RepositoryDefinition[];
}

function makeLineOf(source: string): (offset: number) => number {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function definitionId(fn: FunctionInfo): string {
  return `definition:${JSON.stringify([fn.file, fn.start, fn.end, fn.key])}`;
}

function countSteps(
  steps: RepositoryCallStep[],
  visit: (step: RepositoryCallStep) => void,
): void {
  for (const step of steps) {
    visit(step);
    if (step.type === "branch") countSteps(step.children, visit);
  }
}

/**
 * Build the canonical machine record for one repository call snapshot.
 * The HTML view is a derived projection of this value.
 */
export function buildRepositoryCallSnapshot(
  loaded: LoadedFunctions,
  source:
    | { requestedRef: string; commit: string; pathFilters: string[] }
    | RepositoryCallSource,
): RepositoryCallSnapshot {
  const functions = [...loaded.functions].sort(
    (left, right) =>
      compareText(left.file, right.file) ||
      left.start - right.start ||
      compareText(left.key, right.key),
  );
  const lineOfByFile = new Map(
    [...loaded.sources].map(([file, text]) => [file, makeLineOf(text)]),
  );

  const definitions: RepositoryDefinition[] = functions.map((fn) => {
    const lineOf = lineOfByFile.get(fn.file) ?? (() => 1);
    return {
      id: definitionId(fn),
      key: fn.key,
      label: fn.label,
      file: fn.file,
      language: detectLanguage(fn.file)?.id ?? "unknown",
      exported: fn.exported,
      span: {
        startIndex: fn.start,
        endIndex: fn.end,
        startLine: lineOf(fn.start),
        endLine: lineOf(fn.end),
      },
      steps: [],
    };
  });

  const uniqueIds = new Set(definitions.map((definition) => definition.id));
  if (uniqueIds.size !== definitions.length) {
    throw new Error("Duplicate repository definition coordinates");
  }

  const definitionsByKey = new Map<string, RepositoryDefinition[]>();
  for (const definition of definitions) {
    definitionsByKey.set(definition.key, [
      ...(definitionsByKey.get(definition.key) ?? []),
      definition,
    ]);
    if (definition.key.endsWith(".constructor")) {
      const className = definition.key.slice(0, -".constructor".length);
      const alias = `new ${className}`;
      definitionsByKey.set(alias, [
        ...(definitionsByKey.get(alias) ?? []),
        definition,
      ]);
    }
  }

  const convertSteps = (steps: CallStep[]): RepositoryCallStep[] =>
    steps.map((step) => {
      if (step.type === "branch") {
        return {
          type: "branch",
          key: step.key,
          label: step.label,
          children: convertSteps(step.children),
        };
      }
      const targets = definitionsByKey.get(step.key) ?? [];
      return {
        type: "call",
        key: step.key,
        match:
          targets.length === 0
            ? "no-key-match"
            : targets.length === 1
              ? "unique-key-match"
              : "multiple-key-matches",
        matchingDefinitionIds: targets.map((target) => target.id),
      };
    });

  for (let index = 0; index < definitions.length; index += 1) {
    definitions[index]!.steps = convertSteps(functions[index]!.steps);
  }

  let calls = 0;
  let uniqueKeyMatchCalls = 0;
  let multipleKeyMatchCalls = 0;
  let noKeyMatchCalls = 0;
  let branches = 0;
  for (const definition of definitions) {
    countSteps(definition.steps, (step) => {
      if (step.type === "branch") {
        branches += 1;
        return;
      }
      calls += 1;
      if (step.match === "unique-key-match") uniqueKeyMatchCalls += 1;
      if (step.match === "multiple-key-matches") multipleKeyMatchCalls += 1;
      if (step.match === "no-key-match") noKeyMatchCalls += 1;
    });
  }

  const collidingDefinitionKeys = [...definitionsByKey.entries()].filter(
    ([key, matches]) => !key.startsWith("new ") && matches.length > 1,
  ).length;

  const normalizedSource: RepositoryCallSource =
    "kind" in source ? source : { kind: "commit", ...source };

  return {
    schema: REPOSITORY_CALL_SNAPSHOT_SCHEMA,
    source: normalizedSource,
    summary: {
      sourceFiles: loaded.files.length,
      definitions: definitions.length,
      exportedDefinitions: definitions.filter((definition) => definition.exported)
        .length,
      collidingDefinitionKeys,
      calls,
      uniqueKeyMatchCalls,
      multipleKeyMatchCalls,
      noKeyMatchCalls,
      branches,
      parseWarnings: loaded.diagnostics.length,
    },
    files: loaded.files,
    diagnostics: loaded.diagnostics,
    definitions,
  };
}
