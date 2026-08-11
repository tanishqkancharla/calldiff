import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxCli = join(projectRoot, "node_modules/tsx/dist/cli.mjs");
const calldiffCli = join(projectRoot, "src/cli.ts");

export type RunResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export type WorkspaceHost = {
  /** Absolute path to the temp git repo. */
  root: string;
  /**
   * Run a calldiff command in this workspace.
   *
   * Accepts either a full command string (`"calldiff reach -e foo --to bar"`)
   * or argv without the binary (`"reach -e foo --to bar"` / `["reach", ...]`).
   */
  run: (command: string | string[]) => RunResult;
  /** Write (or overwrite) files relative to the workspace root. */
  write: (files: Record<string, string>) => void;
  /**
   * Stage and commit. Optional `files` are written first (same as `write`).
   * Returns the new HEAD sha.
   */
  commit: (name: string, files?: Record<string, string>) => string;
};

/**
 * Create an isolated git workspace for end-to-end CLI tests.
 *
 * ```ts
 * import { outdent } from "outdent";
 *
 * const host = workspace({
 *   "/src/app.ts": outdent`
 *     export function boot() {
 *       run();
 *     }
 *     function run() {}
 *   `,
 * });
 * const result = host.run("calldiff reach -e boot --to run");
 * expect(result.stdout).toContain("boot()");
 *
 * // Multi-commit history for `diff`:
 * const before = host.commit("before", { "/src/app.ts": beforeSrc });
 * const after = host.commit("after", { "/src/app.ts": afterSrc });
 * host.run(`calldiff diff ${before} ${after} -e root`);
 * ```
 *
 * File paths are rooted at the temp directory (a leading `/` is optional).
 * The workspace is removed when the current Vitest test finishes.
 */
export function workspace(files: Record<string, string> = {}): WorkspaceHost {
  const root = mkdtempSync(join(tmpdir(), "calldiff-ws-"));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);

  const host: WorkspaceHost = {
    root,
    write(next) {
      writeFiles(root, next);
    },
    commit(name, files) {
      if (files) writeFiles(root, files);
      git(root, ["add", "-A"]);
      git(root, ["commit", "-qm", name]);
      return git(root, ["rev-parse", "HEAD"]).trim();
    },
    run(command) {
      const args = normalizeArgv(command);
      const result = spawnSync(
        process.execPath,
        [tsxCli, calldiffCli, ...args],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            // Keep grammar cache shared with the vitest env.
            FORCE_COLOR: "0",
          },
        },
      );
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        code: result.status ?? 1,
      };
    },
  };

  if (Object.keys(files).length > 0) host.commit("initial", files);
  return host;
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rawPath, content] of Object.entries(files)) {
    const rel = normalizeWorkspacePath(rawPath);
    const abs = resolve(root, rel);
    if (!abs.startsWith(root + sep) && abs !== root) {
      throw new Error(`Refusing to write outside workspace: ${rawPath}`);
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** Map virtual paths (`/src/a.ts`, `src/a.ts`) onto the temp root. */
function normalizeWorkspacePath(path: string): string {
  const trimmed = path.replace(/^\/+/, "");
  if (!trimmed || trimmed === "." || trimmed.includes("..")) {
    throw new Error(`Invalid workspace path: ${path}`);
  }
  return trimmed;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout ?? "";
}

/**
 * Split a shell-ish command string into argv, then drop a leading `calldiff`.
 * Supports simple single/double quotes; no escapes or interpolation.
 */
function normalizeArgv(command: string | string[]): string[] {
  const tokens = Array.isArray(command) ? [...command] : tokenize(command);
  if (tokens[0] === "calldiff") tokens.shift();
  return tokens;
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]!);
  }
  return tokens;
}
