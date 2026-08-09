import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { REPOSITORY_SNAPSHOT_JSON } from "../src/repository-snapshot-output.js";
import { run } from "../src/run.js";

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

test("snapshot CLI freezes a root-scoped commit from a subdirectory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "calldiff-cli-"));
  const fixtureEmail = "calldiff-test" + "@" + "example.invalid";
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    git(directory, ["init", "-q"]);
    mkdirSync(join(directory, "src"));
    writeFileSync(
      join(directory, "src", "é.ts"),
      "export function entry() { helper(); }\nfunction helper() {}\n",
    );
    git(directory, ["add", "."]);
    git(directory, [
      "-c",
      "user.name=calldiff-test",
      "-c",
      `user.email=${fixtureEmail}`,
      "commit",
      "-qm",
      "fixture",
    ]);
    const commit = git(directory, ["rev-parse", "HEAD"]);
    git(directory, ["branch", "snapshot"]);
    const subdirectory = join(directory, "src");

    expect(
      await run(
        ["--snapshot", "HEAD", "--output", "evidence", "--", "."],
        subdirectory,
      ),
    ).toBe(0);
    const jsonPath = join(subdirectory, "evidence", REPOSITORY_SNAPSHOT_JSON);
    const artifact = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(artifact.source).toEqual({
      kind: "commit",
      requestedRef: "HEAD",
      commit,
      pathFilters: [],
    });
    expect(artifact.files).toEqual(["src/é.ts"]);
    expect(artifact.definitions.map((definition: { key: string }) => definition.key))
      .toEqual(["entry", "helper"]);

    expect(await run(["snapshot"], directory)).toBe(0);
    expect(await run(["HEAD", "snapshot"], directory)).toBe(0);
    expect(
      await run(
        ["--snapshot", "HEAD", "--output", "evidence", "--", "."],
        subdirectory,
      ),
    ).toBe(1);
    expect(JSON.parse(readFileSync(jsonPath, "utf8")).source.commit).toBe(
      commit,
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Snapshot output already exists"),
    );
  } finally {
    log.mockRestore();
    error.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  }
});
