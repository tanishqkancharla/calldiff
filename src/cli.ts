#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cli, z } from "incur";
import { runDiff, runShow } from "./run.js";
import type { DiffResult, ShowResult } from "./types.js";

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

/** Strip lone `--` so `calldiff a b -- src` still works with incur. */
export function normalizeArgv(argv: string[]): string[] {
  return argv.filter((token) => token !== "--");
}

function entriesFromOption(
  entry: string | string[] | undefined,
): string[] | undefined {
  if (entry === undefined) return undefined;
  return Array.isArray(entry) ? entry : [entry];
}

const sharedOptions = z.object({
  entry: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Entrypoint(s): functionName or ClassName.method"),
  maxDepth: z.coerce
    .number()
    .default(12)
    .describe("Max call-tree depth"),
  from: z.string().optional().describe('Left / "before" tree'),
  to: z.string().optional().describe('Right / "after" tree'),
});

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
 */
function emitAsciiOrData(
  c: EmitContext,
  result: DiffResult | ShowResult,
  cta?: CtaMeta,
): unknown {
  if (!c.formatExplicit) {
    process.stdout.write(
      result.ascii.endsWith("\n") ? result.ascii : `${result.ascii}\n`,
    );
    if (cta) return c.ok({}, cta);
    return;
  }
  return result;
}

export const cli = Cli.create("calldiff", {
  description:
    "Diff call stacks across git commits for agentic code review (22 languages)",
  version: readVersion(),
  args: z.object({
    from: z.string().optional().describe("Before ref (default: HEAD)"),
    to: z.string().optional().describe("After ref (default: working tree)"),
    paths: z
      .array(z.string())
      .optional()
      .describe("Limit to these path prefixes"),
  }),
  options: sharedOptions,
  alias: { entry: "e" },
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
  hint: "Semantics match git diff: no refs → HEAD vs worktree; one ref → that vs worktree; two refs → compare those trees. Path filters are trailing positionals (a leading -- is also accepted). Use --format json for structured agent output.",
  sync: {
    // One skill file covering root + show (default incur depth is 1 = per-command).
    depth: 0,
    suggestions: [
      "Diff HEAD against my working tree with calldiff",
      "Show the call tree for createAgentSession with calldiff show",
      "Compare main and my feature branch with calldiff",
    ],
  },
  run(c) {
    const entries = entriesFromOption(c.options.entry);
    let result: DiffResult;
    try {
      result = runDiff({
        from: c.options.from ?? c.args.from,
        to: c.options.to ?? c.args.to,
        entries,
        paths: c.args.paths,
        maxDepth: c.options.maxDepth,
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
                command: "show",
                options: { entry: t.entry },
                description: `View full call tree for ${t.entry}`,
              })),
            },
          }
        : undefined;

    return emitAsciiOrData(c, result, cta);
  },
}).command("show", {
  description: "View a call tree (no diff) for one or more entrypoints",
  args: z.object({
    ref: z
      .string()
      .optional()
      .describe("Git ref (default: working tree)"),
    paths: z
      .array(z.string())
      .optional()
      .describe("Limit to these path prefixes"),
  }),
  options: z.object({
    entry: z
      .union([z.string(), z.array(z.string())])
      .describe("Entrypoint(s): functionName or ClassName.method"),
    maxDepth: z.coerce
      .number()
      .default(12)
      .describe("Max call-tree depth"),
  }),
  alias: { entry: "e" },
  examples: [
    {
      description: "Show tree from working tree",
      options: { entry: "createAgentSession" },
    },
    {
      description: "Show tree from a commit",
      args: { ref: "HEAD" },
      options: { entry: "PiService.createAgentSession" },
    },
  ],
  run(c) {
    const entries = entriesFromOption(c.options.entry) ?? [];
    if (entries.length === 0) {
      return c.error({
        code: "MISSING_ENTRY",
        message: "calldiff show requires --entry / -e",
        exitCode: 2,
      });
    }

    try {
      const result = runShow({
        ref: c.args.ref,
        entries,
        paths: c.args.paths,
        maxDepth: c.options.maxDepth,
        color: !c.formatExplicit && !c.agent,
      });
      return emitAsciiOrData(c, result);
    } catch (error) {
      return c.error({
        code: "SHOW_FAILED",
        message: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      });
    }
  },
});

export default cli;

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("\\cli.ts") ||
    process.argv[1].endsWith("\\cli.js"));

if (isMain) {
  cli.serve(normalizeArgv(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
