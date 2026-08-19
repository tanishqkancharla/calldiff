import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { outdent } from "outdent";
import { expect, test } from "vitest";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("runs a commit-to-commit diff end to end", () => {
  const host = workspace();
  const before = host.commit("before", {
    "/app.ts": src`
      export function root() {
        beforeCall();
      }
    `,
  });
  host.commit("after", {
    "/app.ts": src`
      export function root() {
        afterCall();
      }
    `,
  });

  const result = host.run(`calldiff diff ${before} HEAD -e root`);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("- ├─ beforeCall()");
  expect(result.stdout).toContain("+ └─ afterCall()");
});

test("lists tracked and non-ignored worktree sources", () => {
  const host = workspace();
  host.commit("tracked", {
    "/.gitignore": "ignored/\n",
    "/.config/tracked.ts": src`
      export function tracked() {
        hit();
      }
      function hit() {}
    `,
    "/deleted.ts": src`
      export function deleted() {
        gone();
      }
      function gone() {}
    `,
  });

  host.remove("/deleted.ts");
  host.write({
    "/ignored/skip.ts": src`
      export function skip() {
        hidden();
      }
      function hidden() {}
    `,
    "/untracked.ts": src`
      export function extra() {
        more();
      }
      function more() {}
    `,
  });

  const worktreeTracked = host.run("calldiff tree -e tracked");
  expect(worktreeTracked.code).toBe(0);
  expect(worktreeTracked.stdout).toContain("hit()");

  const worktreeUntracked = host.run("calldiff tree -e extra");
  expect(worktreeUntracked.code).toBe(0);
  expect(worktreeUntracked.stdout).toContain("more()");

  const ignored = host.run("calldiff tree -e skip");
  expect(ignored.code).not.toBe(0);
  expect(`${ignored.stdout}\n${ignored.stderr}`).toMatch(/Entrypoint not found/);

  const deletedWorktree = host.run("calldiff tree -e deleted");
  expect(deletedWorktree.code).not.toBe(0);

  const deletedCommit = host.run("calldiff tree HEAD -e deleted");
  expect(deletedCommit.code).toBe(0);
  expect(deletedCommit.stdout).toContain("gone()");

  const untrackedCommit = host.run("calldiff tree HEAD -e extra");
  expect(untrackedCommit.code).not.toBe(0);
});

test.skipIf(process.platform === "win32")(
  "skips source-shaped symlinks in commits and the worktree",
  () => {
    const host = workspace();
    host.write({
      "/source.txt": "export function linked() { work(); }\nfunction work() {}\n",
    });
    symlinkSync(join(host.root, "source.txt"), join(host.root, "linked.ts"));
    host.commit("symlink");

    const commit = host.run("calldiff tree HEAD -e linked");
    expect(commit.code).not.toBe(0);
    expect(`${commit.stdout}\n${commit.stderr}`).toMatch(/Entrypoint not found/);

    const worktree = host.run("calldiff tree -e linked");
    expect(worktree.code).not.toBe(0);
    expect(`${worktree.stdout}\n${worktree.stderr}`).toMatch(
      /Entrypoint not found/,
    );
  },
);

test("reads commit source blobs including unicode names", () => {
  const host = workspace({
    "/src/main.ts": src`
      export function café() {
        sip();
      }
      function sip() {}
    `,
    "/src/odd.ts": src`
      export function odd() {
        weird();
      }
      function weird() {}
    `,
    "/src/types.d.ts": "declare const ignored: string;\n",
    "/README.md": "not source\n",
  });

  const cafe = host.run("calldiff tree HEAD -e café");
  expect(cafe.code).toBe(0);
  expect(cafe.stdout).toContain("sip()");

  const odd = host.run("calldiff tree HEAD -e odd");
  expect(odd.code).toBe(0);
  expect(odd.stdout).toContain("weird()");

  const ignoredDecl = host.run("calldiff tree HEAD -e ignored");
  expect(ignoredDecl.code).not.toBe(0);
});
