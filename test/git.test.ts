import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  listSourceFiles,
  normalizePathFilters,
  readSnapshotFile,
  repositoryRoot,
  resolveCommit,
} from "../src/git.js";

test("path filters use repository-relative boundaries", () => {
  const directory = mkdtempSync(join(tmpdir(), "calldiff-paths-"));
  try {
    mkdirSync(join(directory, "nested"));
    writeFileSync(join(directory, "foo.ts"), "function root() {}\n");
    writeFileSync(join(directory, "nested", "foo.ts"), "function nested() {}\n");
    writeFileSync(
      join(directory, "nested", "otherfoo.ts"),
      "function other() {}\n",
    );
    const worktree = { kind: "worktree", ref: "WORKTREE" } as const;

    expect(listSourceFiles(directory, worktree, ["foo.ts"])).toEqual([
      "foo.ts",
    ]);
    expect(listSourceFiles(directory, worktree, ["nested"])).toEqual([
      "nested/foo.ts",
      "nested/otherfoo.ts",
    ]);
    expect(listSourceFiles(directory, worktree, ["."])).toEqual([
      "foo.ts",
      "nested/foo.ts",
      "nested/otherfoo.ts",
    ]);
    expect(listSourceFiles(directory, worktree, ["nested\\foo.ts"])).toEqual([
      "nested/foo.ts",
    ]);
    expect(normalizePathFilters(["src/", "./src", "test", "src"])).toEqual([
      "src",
      "test",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("commit snapshots keep root paths and ignore replacement refs", () => {
  const directory = mkdtempSync(join(tmpdir(), "calldiff-git-root-"));
  const fixtureEmail = "calldiff-test" + "@" + "example.invalid";
  try {
    execFileSync("git", ["init", "-q"], { cwd: directory });
    mkdirSync(join(directory, "src"));
    writeFileSync(join(directory, "src", "app.ts"), "function app() {}\n");
    writeFileSync(join(directory, "src", "é.ts"), "function unicode() {}\n");
    writeFileSync(
      join(directory, "src", "line\nbreak.ts"),
      "function newline() {}\n",
    );
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=calldiff-test",
        "-c",
        `user.email=${fixtureEmail}`,
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: directory },
    );
    const originalCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
    writeFileSync(
      join(directory, "src", "app.ts"),
      "function replacement() {}\n",
    );
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=calldiff-test",
        "-c",
        `user.email=${fixtureEmail}`,
        "commit",
        "-qm",
        "replacement fixture",
      ],
      { cwd: directory },
    );
    const replacementCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["replace", originalCommit, replacementCommit], {
      cwd: directory,
    });

    const subdirectory = join(directory, "src");
    const commit = resolveCommit(subdirectory, originalCommit);
    const snapshot = { kind: "commit", ref: commit } as const;

    expect(commit).toBe(originalCommit);
    expect(repositoryRoot(subdirectory)).toBe(realpathSync(directory));
    expect(listSourceFiles(subdirectory, snapshot)).toEqual([
      "src/app.ts",
      "src/line\nbreak.ts",
      "src/é.ts",
    ]);
    expect(readSnapshotFile(subdirectory, snapshot, "src/app.ts")).toBe(
      "function app() {}\n",
    );
    expect(readSnapshotFile(subdirectory, snapshot, "src/é.ts")).toBe(
      "function unicode() {}\n",
    );
    expect(
      readSnapshotFile(subdirectory, snapshot, "src/line\nbreak.ts"),
    ).toBe("function newline() {}\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
