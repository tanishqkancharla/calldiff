import type { CliOptions } from "./types.js";

function takeValue(argv: string[], i: number, flag: string): [string, number] {
  const next = argv[i + 1];
  if (!next || next.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return [next, i + 1];
}

/**
 * Git-diff-shaped args:
 *   calldiff
 *   calldiff <from>
 *   calldiff <from> <to>
 *   calldiff --from <ref> --to <ref>
 *   calldiff ... --entry Name [--entry Class.method] -- [paths...]
 *
 * View mode:
 *   calldiff show
 *   calldiff show <ref>
 *   calldiff show [<ref>] --entry Name ...
 */
export function parseArgs(argv: string[], cwd = process.cwd()): CliOptions {
  const options: CliOptions = {
    mode: "diff",
    entries: [],
    paths: [],
    cwd,
    maxDepth: 12,
    help: false,
  };

  const positionals: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === "--") {
      options.paths.push(...argv.slice(i + 1));
      break;
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      i += 1;
      continue;
    }

    if (arg === "--from") {
      const [value, next] = takeValue(argv, i, "--from");
      options.from = value;
      i = next + 1;
      continue;
    }

    if (arg === "--to") {
      const [value, next] = takeValue(argv, i, "--to");
      options.to = value;
      i = next + 1;
      continue;
    }

    if (arg === "--entry" || arg === "-e") {
      const [value, next] = takeValue(argv, i, arg);
      options.entries.push(value);
      i = next + 1;
      continue;
    }

    if (arg === "--max-depth") {
      const [value, next] = takeValue(argv, i, "--max-depth");
      const depth = Number(value);
      if (!Number.isFinite(depth) || depth < 1) {
        throw new Error(`Invalid --max-depth: ${value}`);
      }
      options.maxDepth = depth;
      i = next + 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
    i += 1;
  }

  if (positionals[0] === "show") {
    options.mode = "show";
    positionals.shift();

    if (options.from !== undefined || options.to !== undefined) {
      throw new Error("calldiff show does not accept --from / --to");
    }

    if (positionals.length > 1) {
      throw new Error(
        `Too many arguments for show: expected at most one ref, got ${positionals.length}`,
      );
    }

    if (positionals[0]) {
      options.from = positionals[0];
    }

    if (!options.help && options.entries.length === 0) {
      throw new Error("calldiff show requires --entry / -e");
    }

    return options;
  }

  // Positional refs fill in from/to when flags weren't set (git-diff style).
  if (positionals.length > 2) {
    throw new Error(
      `Too many arguments: expected at most two refs (from to), got ${positionals.length}`,
    );
  }

  if (positionals[0] && options.from === undefined) {
    options.from = positionals[0];
  } else if (positionals[0] && options.from !== undefined) {
    // Extra positional after --from: treat remaining as paths if no --to positional conflict
    options.paths.unshift(...positionals);
    return options;
  }

  if (positionals[1] && options.to === undefined) {
    options.to = positionals[1];
  }

  return options;
}

export function printHelp(): void {
  console.log(`calldiff — diff call stacks across git commits for agentic review (22 languages)

Usage:
  calldiff
  calldiff <from>
  calldiff <from> <to>
  calldiff --from <ref> --to <ref>
  calldiff [refs] --entry <name> [--entry <Class.method>] [-- paths...]
  calldiff show [<ref>] --entry <name> [--entry <Class.method>] [-- paths...]

Semantics (like git diff):
  (no refs)     from=HEAD, to=working tree
  <from>        from=<from>, to=working tree
  <from> <to>   compare those two trees

View (no diff):
  show          call tree(s) from working tree
  show <ref>    call tree(s) from that commit/ref
                requires -e/--entry

Options:
  --from <ref>       Left / "before" tree (diff mode)
  --to <ref>         Right / "after" tree (diff mode)
  -e, --entry <name> Entrypoint(s): functionName or ClassName.method
                     Diff: if omitted, infer exported functions whose call trees changed
                     Show: required
  --max-depth <n>    Max call-tree depth (default: 12)
  -h, --help         Show help

Labels:
  functionName
  ClassName.method
  new ClassName

Languages:
  TypeScript, TSX, JavaScript, Python, Go, Rust, Java, Ruby, C, C++, C#,
  PHP, Kotlin, Swift, Scala, Lua, Elixir, Bash, Haskell, Zig, Solidity, OCaml
`);
}
