import type {
  CliOptions,
  DiffCliOptions,
  SnapshotCliOptions,
} from "./types.js";

function takeValue(argv: string[], i: number, flag: string): [string, number] {
  const next = argv[i + 1];
  if (!next || next.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return [next, i + 1];
}

function optionArguments(argv: string[]): string[] {
  const pathSeparator = argv.indexOf("--");
  return pathSeparator < 0 ? argv : argv.slice(0, pathSeparator);
}

function hasSnapshotFlag(argv: string[]): boolean {
  return optionArguments(argv).includes("--snapshot");
}

function parseSnapshotArgs(argv: string[], cwd: string): SnapshotCliOptions {
  const options: SnapshotCliOptions = {
    command: "snapshot",
    ref: "HEAD",
    paths: [],
    cwd,
    help:
      optionArguments(argv).includes("-h") ||
      optionArguments(argv).includes("--help"),
  };
  if (options.help) return options;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") {
      options.paths.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--snapshot") {
      const [value, next] = takeValue(argv, i, arg);
      options.ref = value;
      i = next + 1;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      const [value, next] = takeValue(argv, i, arg);
      options.output = value;
      i = next + 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown snapshot option: ${arg}`);
    }
    throw new Error(`Unexpected snapshot argument: ${arg}`);
  }
  return options;
}

/** Parse snapshot flags or the default git-diff-shaped command. */
export function parseArgs(argv: string[], cwd = process.cwd()): CliOptions {
  if (hasSnapshotFlag(argv)) {
    return parseSnapshotArgs(argv, cwd);
  }

  const options: DiffCliOptions = {
    command: "diff",
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
  calldiff --snapshot <ref> --output <directory> [-- paths...]

Semantics (like git diff):
  (no refs)     from=HEAD, to=working tree
  <from>        from=<from>, to=working tree
  <from> <to>   compare those two trees

Options:
  --from <ref>       Left / "before" tree
  --to <ref>         Right / "after" tree
  -e, --entry <name> Entrypoint(s): functionName or ClassName.method
                     If omitted, infer exported functions whose call trees changed
  --max-depth <n>    Max call-tree depth (default: 12)
  --snapshot <ref>   Write one repository call snapshot instead of a diff
  -o, --output <dir> New snapshot output directory (with --snapshot)
  -h, --help         Show help

Snapshot output:
  calldiff-call-snapshot.json   Canonical machine record
  calldiff-call-snapshot.html   Searchable human projection

Labels:
  functionName
  ClassName.method
  new ClassName

Languages:
  TypeScript, TSX, JavaScript, Python, Go, Rust, Java, Ruby, C, C++, C#,
  PHP, Kotlin, Swift, Scala, Lua, Elixir, Bash, Haskell, Zig, Solidity, OCaml
`);
}
