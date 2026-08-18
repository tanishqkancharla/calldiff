#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cli, z } from "incur";
import { runDiff, runReach, runTree } from "./run.js";
import type { DiffResult, ReachResult, TreeResult } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const TOKEN_FLAGS = ["--token-count", "--token-limit", "--token-offset"];

/**
 * Whether the user asked incur to count or slice the output by tokens.
 *
 * These globals act on the value a command *returns*, so the ASCII fast path
 * (which writes to stdout itself) has to opt out of them — otherwise the flags
 * silently do nothing. See `emitAsciiOrData`.
 */
export function hasTokenFlag(argv: string[]): boolean {
  return argv.some((token) =>
    TOKEN_FLAGS.some((flag) => token === flag || token.startsWith(`${flag}=`)),
  );
}

/**
 * Set from the argv actually being served. incur does not pass the raw argv to
 * command handlers, and `normalizeArgv` is the one funnel every entry point
 * (the CLI below, and the tests) already runs argv through.
 */
let tokenFlagActive = false;

/** Strip lone `--` so `calldiff a b -- src` still works with incur. */
export function normalizeArgv(argv: string[]): string[] {
  tokenFlagActive = hasTokenFlag(argv);
  return argv.filter((token) => token !== "--");
}

function entriesFromOption(
  entry: string | string[] | undefined,
): string[] | undefined {
  if (entry === undefined) return undefined;
  return Array.isArray(entry) ? entry : [entry];
}

type CtaMeta = {
  cta: {
    commands: Array<{
      command: string;
      description?: string;
      options?: Record<string, unknown>;
    }>;
  };
};

type EmitContext = {
  agent: boolean;
  formatExplicit: boolean;
  ok: (data: unknown, meta?: CtaMeta) => never;
};

/**
 * Default: classic ASCII (TTY + pipes) with optional CTAs.
 * `--format` / `--json`: structured envelope for agents.
 *
 * The ASCII path writes to stdout itself so that piped output stays raw text
 * (incur wraps a scalar payload as `{ data, cta }` once a CTA is attached).
 * `--token-count` / `--token-limit` / `--token-offset` act on what a command
 * *returns*, though, so under those flags we hand the ASCII back to incur and
 * let it do the counting and slicing. The CTA is dropped there on purpose: it
 * keeps the counted output exactly the tree the user asked about.
 */
function emitAsciiOrData(
  c: EmitContext,
  result: DiffResult | TreeResult | ReachResult,
  cta?: CtaMeta,
): unknown {
  if (!c.formatExplicit) {
    if (tokenFlagActive) return result.ascii;
    process.stdout.write(
      result.ascii.endsWith("\n") ? result.ascii : `${result.ascii}\n`,
    );
    if (cta) return c.ok({}, cta);
    return;
  }
  return result;
}

const entryOption = z
  .union([z.string(), z.array(z.string())])
  .describe("Entrypoint symbol(s): functionName or ClassName.method");

const fileOption = z
  .union([z.string(), z.array(z.string())])
  .describe(
    "Entrypoint file(s): indexed source path; expands to that file's exports",
  );

const maxDepthOption = z.coerce
  .number()
  .default(12)
  .describe("Max call-tree depth");

const locsOption = z
  .boolean()
  .default(false)
  .describe("Show call-site source locations (file:line)");

const pathsArg = z
  .array(z.string())
  .optional()
  .describe("Limit to these path prefixes");

export const cli = Cli.create("calldiff", {
  description:
    "Diff call stacks across git commits for agentic code review (23 languages)",
  version: readVersion(),
  hint: "Commands: diff (compare two trees), tree (view one tree), reach (paths between symbols). Path filters are trailing positionals (a leading -- is also accepted). Use --format json for structured agent output.",
  sync: {
    // One skill file covering all commands (default incur depth is 1 = per-command).
    depth: 0,
    suggestions: [
      "Diff HEAD against my working tree with calldiff diff",
      "View the call tree for createAgentSession with calldiff tree",
      "Find call paths from runCheckout to sendEmail with calldiff reach",
    ],
  },
})
  .command("diff", {
    description: "Diff call stacks between two git trees",
    args: z.object({
      from: z.string().optional().describe("Before ref (default: HEAD)"),
      to: z.string().optional().describe("After ref (default: working tree)"),
      paths: pathsArg,
    }),
    options: z.object({
      entry: entryOption.optional(),
      file: fileOption.optional(),
      maxDepth: maxDepthOption,
      locs: locsOption,
      from: z.string().optional().describe('Left / "before" tree'),
      to: z.string().optional().describe('Right / "after" tree'),
    }),
    alias: { entry: "e", file: "F" },
    examples: [
      { description: "HEAD vs working tree" },
      {
        description: "One ref vs working tree",
        args: { from: "main" },
      },
      {
        description: "Two commits / branches",
        args: { from: "abc123", to: "def456" },
      },
      {
        description: "Force entrypoints",
        args: { from: "main", to: "feature" },
        options: { entry: "createAgentSession" },
      },
      {
        description: "File as entrypoint (all exports in that file)",
        args: { from: "main", to: "feature" },
        options: { file: "src/routes.ts" },
      },
    ],
    usage: [
      {},
      { args: { from: true } },
      { args: { from: true, to: true } },
      {
        args: { from: true, to: true, paths: true },
        options: { entry: true },
      },
    ],
    hint: "Semantics match git diff: no refs → HEAD vs worktree; one ref → that vs worktree; two refs → compare those trees.",
    run(c) {
      const entries = entriesFromOption(c.options.entry);
      const files = entriesFromOption(c.options.file);
      let result: DiffResult;
      try {
        result = runDiff({
          from: c.options.from ?? c.args.from,
          to: c.options.to ?? c.args.to,
          entries,
          files,
          paths: c.args.paths,
          maxDepth: c.options.maxDepth,
          locs: c.options.locs,
          color: !c.formatExplicit && !c.agent,
        });
      } catch (error) {
        return c.error({
          code: "DIFF_FAILED",
          message: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        });
      }

      const cta =
        result.trees.length > 0
          ? {
              cta: {
                commands: result.trees.slice(0, 3).map((t) => ({
                  command: "tree",
                  options: { entry: t.entry },
                  description: `View full call tree for ${t.entry}`,
                })),
              },
            }
          : undefined;

      return emitAsciiOrData(c, result, cta);
    },
  })
  .command("tree", {
    description: "View a call tree (no diff) for one or more entrypoints",
    args: z.object({
      ref: z
        .string()
        .optional()
        .describe("Git ref (default: working tree)"),
      paths: pathsArg,
    }),
    options: z.object({
      entry: entryOption.optional(),
      file: fileOption.optional(),
      maxDepth: maxDepthOption,
      locs: locsOption,
    }),
    alias: { entry: "e", file: "F" },
    examples: [
      {
        description: "Tree from working tree",
        options: { entry: "createAgentSession" },
      },
      {
        description: "Tree from a commit",
        args: { ref: "HEAD" },
        options: { entry: "PiService.createAgentSession" },
      },
      {
        description: "Tree for every export in a file",
        options: { file: "packages/api/src/routes.ts" },
      },
    ],
    run(c) {
      const entries = entriesFromOption(c.options.entry) ?? [];
      const files = entriesFromOption(c.options.file) ?? [];
      if (entries.length === 0 && files.length === 0) {
        return c.error({
          code: "MISSING_ENTRY",
          message: "calldiff tree requires --entry / -e or --file / -F",
          exitCode: 2,
        });
      }

      try {
        const result = runTree({
          ref: c.args.ref,
          entries,
          files,
          paths: c.args.paths,
          maxDepth: c.options.maxDepth,
          locs: c.options.locs,
          color: !c.formatExplicit && !c.agent,
        });
        return emitAsciiOrData(c, result);
      } catch (error) {
        return c.error({
          code: "TREE_FAILED",
          message: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        });
      }
    },
  })
  .command("reach", {
    description: "Find all call paths from an entrypoint to a target symbol",
    args: z.object({
      ref: z
        .string()
        .optional()
        .describe("Git ref (default: working tree)"),
      paths: pathsArg,
    }),
    options: z.object({
      entry: entryOption.optional(),
      file: fileOption.optional(),
      to: z
        .string()
        .describe("Target symbol to reach (functionName or ClassName.method)"),
      maxDepth: maxDepthOption,
      locs: locsOption,
    }),
    alias: { entry: "e", file: "F" },
    examples: [
      {
        description: "Paths in the working tree",
        options: { entry: "runCheckout", to: "sendEmail" },
      },
      {
        description: "Paths at a commit, limited to a directory",
        args: { ref: "HEAD", paths: ["examples/checkout"] },
        options: { entry: "runCheckout", to: "sendEmail" },
      },
      {
        description: "Paths from every export in a file",
        options: { file: "packages/api/src/flow.ts", to: "notify" },
      },
    ],
    run(c) {
      const entries = entriesFromOption(c.options.entry) ?? [];
      const files = entriesFromOption(c.options.file) ?? [];
      if (entries.length === 0 && files.length === 0) {
        return c.error({
          code: "MISSING_ENTRY",
          message: "calldiff reach requires --entry / -e or --file / -F",
          exitCode: 2,
        });
      }
      if (!c.options.to) {
        return c.error({
          code: "MISSING_TARGET",
          message: "calldiff reach requires --to <symbol>",
          exitCode: 2,
        });
      }

      try {
        const result = runReach({
          ref: c.args.ref,
          entries,
          files,
          to: c.options.to,
          paths: c.args.paths,
          maxDepth: c.options.maxDepth,
          locs: c.options.locs,
          color: !c.formatExplicit && !c.agent,
        });
        return emitAsciiOrData(c, result);
      } catch (error) {
        return c.error({
          code: "REACH_FAILED",
          message: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        });
      }
    },
  });

export default cli;

/** True when this file is the process entry (including npm `.bin` symlinks). */
function executedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return (
      entry.endsWith("/cli.ts") ||
      entry.endsWith("/cli.js") ||
      entry.endsWith("\\cli.ts") ||
      entry.endsWith("\\cli.js")
    );
  }
}

if (executedAsCli()) {
  cli.serve(normalizeArgv(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
