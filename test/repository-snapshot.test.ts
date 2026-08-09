import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { extractFunctions } from "../src/extract.js";
import type { LoadedFunctions } from "../src/load.js";
import {
  analyzeRepositoryFiles,
  diffRepositoryCallSnapshots,
  projectRepositoryCallSnapshot,
  REPOSITORY_CALL_DELTA_SCHEMA,
  REPOSITORY_CALL_PROJECTION_SCHEMA,
} from "../src/repository-analysis.js";
import {
  buildRepositoryCallSnapshot,
  REPOSITORY_CALL_SNAPSHOT_SCHEMA,
} from "../src/repository-snapshot.js";
import { renderRepositoryCallSnapshotHtml } from "../src/repository-snapshot-html.js";
import {
  REPOSITORY_SNAPSHOT_HTML,
  REPOSITORY_SNAPSHOT_JSON,
  writeRepositoryCallSnapshotBundle,
} from "../src/repository-snapshot-output.js";

const firstSource = `export function start(flag: boolean) {
  helper();
  shared();
  missing();
  if (flag) {
    work();
  }
}
function helper() {}
function shared() {}
`;

const secondSource = `function shared() {}
function work() {}
`;

function fixture(): LoadedFunctions {
  return {
    files: ["src/first.ts", "src/second.ts"],
    functions: [
      ...extractFunctions("src/first.ts", firstSource),
      ...extractFunctions("src/second.ts", secondSource),
    ],
    sources: new Map([
      ["src/first.ts", firstSource],
      ["src/second.ts", secondSource],
    ]),
    diagnostics: [],
  };
}

describe("repository call snapshot", () => {
  test("keeps all definitions and reports syntactic key matches", () => {
    const snapshot = buildRepositoryCallSnapshot(fixture(), {
      requestedRef: "HEAD",
      commit: "a".repeat(40),
      pathFilters: ["src"],
    });

    expect(snapshot.schema).toBe(REPOSITORY_CALL_SNAPSHOT_SCHEMA);
    expect(new Set(snapshot.definitions.map((definition) => definition.id)).size)
      .toBe(snapshot.definitions.length);
    expect(snapshot.definitions[0]!.id).toMatch(/^definition:\[/);
    expect(snapshot.summary).toMatchObject({
      sourceFiles: 2,
      definitions: 5,
      collidingDefinitionKeys: 1,
      calls: 4,
      uniqueKeyMatchCalls: 2,
      multipleKeyMatchCalls: 1,
      noKeyMatchCalls: 1,
      branches: 1,
      parseWarnings: 0,
    });

    const start = snapshot.definitions.find(
      (definition) => definition.key === "start",
    );
    expect(start).toBeDefined();
    expect(start).toMatchObject({
      file: "src/first.ts",
      language: "typescript",
      exported: true,
      span: { startLine: 1, endLine: 8 },
    });

    const calls = start!.steps.flatMap((step) =>
      step.type === "call"
        ? [step]
        : step.children.filter((child) => child.type === "call"),
    );
    expect(calls.map(({ key, match, matchingDefinitionIds }) => ({
      key,
      match,
      targets: matchingDefinitionIds.length,
    }))).toEqual([
      { key: "helper", match: "unique-key-match", targets: 1 },
      { key: "shared", match: "multiple-key-matches", targets: 2 },
      { key: "missing", match: "no-key-match", targets: 0 },
      { key: "work", match: "unique-key-match", targets: 1 },
    ]);
  });

  test("uses deterministic ordering and UTF-16 source coordinates", () => {
    const unicodeSource = '// 😀\nfunction unicodeName() { "😀"; }\n';
    const sources = new Map([
      ["src/é.ts", unicodeSource],
      ["src/z.ts", "function zed() {}\n"],
      ["src/A.ts", "function alpha() {}\n"],
    ]);
    const snapshot = buildRepositoryCallSnapshot(
      {
        files: [...sources.keys()],
        functions: [...sources].flatMap(([file, source]) =>
          extractFunctions(file, source),
        ),
        sources,
        diagnostics: [],
      },
      {
        requestedRef: "HEAD",
        commit: "d".repeat(40),
        pathFilters: ["src"],
      },
    );

    expect(snapshot.definitions.map((definition) => definition.file)).toEqual([
      "src/A.ts",
      "src/z.ts",
      "src/é.ts",
    ]);
    const unicode = snapshot.definitions.find(
      (definition) => definition.key === "unicodeName",
    );
    expect(unicode?.span).toMatchObject({
      startIndex: unicodeSource.indexOf("function"),
      endIndex: unicodeSource.indexOf("\n", unicodeSource.indexOf("function")),
      startLine: 2,
      endLine: 2,
    });
  });

  test("analyzes frozen files, projects neighborhoods, and diffs snapshots", () => {
    const before = analyzeRepositoryFiles(
      [
        { path: "src/entry.ts", content: "export function entry() { helper(); }\n" },
        { path: "src/helper.ts", content: "function helper() {}\n" },
        { path: "src/unrelated.ts", content: "function unrelated() {}\n" },
        { path: "README.md", content: "not parsed\n" },
      ],
      "subject/before",
    );
    const after = analyzeRepositoryFiles(
      [
        { path: "src/entry.ts", content: "export function entry() { replacement(); }\n" },
        { path: "src/replacement.ts", content: "function replacement() {}\n" },
      ],
      "subject/after",
    );

    expect(before.source).toMatchObject({
      kind: "frozen-files",
      subjectId: "subject/before",
    });
    expect(before.files).toEqual([
      "src/entry.ts",
      "src/helper.ts",
      "src/unrelated.ts",
    ]);

    const projection = projectRepositoryCallSnapshot(before, ["src/entry.ts"]);
    expect(projection.schema).toBe(REPOSITORY_CALL_PROJECTION_SCHEMA);
    expect(projection.includedFiles).toEqual(["src/entry.ts", "src/helper.ts"]);
    expect(projection.omittedDefinitions).toBe(1);

    const delta = diffRepositoryCallSnapshots(before, after);
    expect(delta.schema).toBe(REPOSITORY_CALL_DELTA_SCHEMA);
    expect(delta.summary).toEqual({
      addedDefinitions: 1,
      removedDefinitions: 2,
      changedDefinitions: 1,
      unchangedDefinitions: 0,
    });
    expect(delta.changes.find((change) => change.matchId === "src/entry.ts:entry#1"))
      .toMatchObject({ change: "changed" });
  });

  test("renders a concise human projection linked to canonical JSON", () => {
    const snapshot = buildRepositoryCallSnapshot(fixture(), {
      requestedRef: "main",
      commit: "b".repeat(40),
      pathFilters: [],
    });
    snapshot.definitions[0]!.label = '<script>alert("x")</script>';

    const html = renderRepositoryCallSnapshotHtml(
      snapshot,
      "calldiff-call-snapshot.json",
    );

    expect(html).toContain("repository call snapshot");
    expect(html).toContain('href="calldiff-call-snapshot.json"');
    expect(html).toContain("unique key match");
    expect(html).toContain("multiple key matches");
    expect(html).toContain("no key match");
    expect(html).toContain("requested main");
    expect(html).toContain("scope all supported files");
    expect(html).toContain("does not prove that a call is external");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
  });

  test("writes the canonical record and derived projection together", () => {
    const snapshot = buildRepositoryCallSnapshot(fixture(), {
      requestedRef: "HEAD",
      commit: "c".repeat(40),
      pathFilters: ["src"],
    });
    const parent = mkdtempSync(join(tmpdir(), "calldiff-snapshot-test-"));
    const directory = join(parent, "snapshot");

    try {
      const written = writeRepositoryCallSnapshotBundle(snapshot, directory);
      expect(JSON.parse(readFileSync(written.jsonPath, "utf8"))).toEqual(
        snapshot,
      );
      expect(readFileSync(written.htmlPath, "utf8")).toContain(
        `href="${REPOSITORY_SNAPSHOT_JSON}"`,
      );
      expect(written.jsonPath).toBe(join(directory, REPOSITORY_SNAPSHOT_JSON));
      expect(written.htmlPath).toBe(join(directory, REPOSITORY_SNAPSHOT_HTML));
      expect(() =>
        writeRepositoryCallSnapshotBundle(snapshot, directory),
      ).toThrow("Snapshot output already exists");
      const emptyDirectory = join(parent, "empty");
      mkdirSync(emptyDirectory);
      expect(() =>
        writeRepositoryCallSnapshotBundle(snapshot, emptyDirectory),
      ).toThrow("Snapshot output already exists");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
