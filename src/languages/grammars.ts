import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type GrammarModule = {
  language?: unknown;
  typescript?: GrammarModule;
  tsx?: GrammarModule;
  [key: string]: unknown;
};

/** On-disk cache of npm-installed tree-sitter grammar packages. */
export function grammarCacheDir(): string {
  const override = process.env.CALLDIFF_GRAMMAR_CACHE;
  if (override) return override;
  return join(homedir(), ".cache", "calldiff", "grammars");
}

/** Set by `--offline`; unset falls back to the environment. */
let offlineOverride: boolean | undefined;

/**
 * Decline the on-demand install.
 *
 * `CALLDIFF_GRAMMAR_CACHE` could already move where grammars are written, but
 * nothing could say "do not write them at all" — so a caller that promised its
 * own users offline operation, determinism, or that it installs nothing had no
 * way to adopt calldiff. Pass `undefined` to fall back to `CALLDIFF_OFFLINE`.
 */
export function setGrammarOffline(offline: boolean | undefined): void {
  offlineOverride = offline;
}

export function grammarsOffline(): boolean {
  if (offlineOverride !== undefined) return offlineOverride;
  const value = process.env.CALLDIFF_OFFLINE;
  return value === "1" || value === "true";
}

function packageInstalled(cacheDir: string, npmPackage: string): boolean {
  return existsSync(join(cacheDir, "node_modules", npmPackage));
}

function ensureCachePackageJson(cacheDir: string): void {
  mkdirSync(cacheDir, { recursive: true });
  const pkgPath = join(cacheDir, "package.json");
  if (!existsSync(pkgPath)) {
    writeFileSync(
      pkgPath,
      JSON.stringify({
        name: "calldiff-grammar-cache",
        private: true,
        description: "On-demand tree-sitter grammars for calldiff",
      }),
      "utf8",
    );
  }
}

/**
 * Some grammar packages (e.g. tree-sitter-c-sharp ≥0.23.5) ship ESM bindings
 * with top-level await, which `require()` cannot load. Fall back to the native
 * `.node` addon via node-gyp-build — same payload the JS wrapper would return.
 */
function loadNativeBinding(packageRoot: string): GrammarModule | null {
  try {
    const require = createRequire(join(packageRoot, "package.json"));
    const gypBuild = require("node-gyp-build") as (
      root: string,
    ) => GrammarModule;
    const binding = gypBuild(packageRoot);
    try {
      (binding as { nodeTypeInfo?: unknown }).nodeTypeInfo = require(
        join(packageRoot, "src", "node-types.json"),
      );
    } catch {
      // optional metadata
    }
    return binding;
  } catch {
    return null;
  }
}

function requireGrammar(
  require: NodeRequire,
  npmPackage: string,
  packageRoot: string,
): GrammarModule {
  try {
    return require(npmPackage) as GrammarModule;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (
      code === "ERR_REQUIRE_ASYNC_MODULE" ||
      msg.includes("top-level await")
    ) {
      const binding = loadNativeBinding(packageRoot);
      if (binding) return binding;
    }
    throw err;
  }
}

/** Packages that need a pinned install spec (latest breaks createRequire). */
const INSTALL_SPEC: Record<string, string> = {
  "tree-sitter-c-sharp": "tree-sitter-c-sharp@0.23.1",
  // 0.4+ is ESM-with-TLA; 0.2.0 is CJS and loads via createRequire.
  "@tree-sitter-grammars/tree-sitter-lua":
    "@tree-sitter-grammars/tree-sitter-lua@0.2.0",
};

/** How long to wait for another process's install before giving up. */
const LOCK_TIMEOUT_MS = 15 * 60_000;
/** A lock older than this is assumed to be from a process that died. */
const LOCK_STALE_MS = 15 * 60_000;
const LOCK_POLL_MS = 250;

/** Block this thread without spinning; installs are synchronous already. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockIsStale(lockPath: string, staleMs: number): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > staleMs;
  } catch {
    // Vanished between the EEXIST and the stat: not stale, just gone.
    return false;
  }
}

/**
 * Hold an exclusive lock on the grammar cache for the duration of `install`.
 *
 * npm is not safe to run concurrently against one `--prefix`: two processes
 * writing the same `node_modules` collide with ENOTEMPTY, half-populated
 * package directories, and `Cannot find module` for a package that is mid-copy.
 * A consumer fanning calldiff out across a repository hits this, and so does
 * this project's own test suite under vitest's file parallelism.
 *
 * `mkdir` is atomic and fails with EEXIST when the directory exists, which is
 * the portable way to take a lock without a dependency. A lock left behind by
 * a killed process is reclaimed once it goes stale, so a crash costs a wait,
 * not a permanently wedged cache.
 */
export function withInstallLock(
  cacheDir: string,
  install: () => void,
  options: { timeoutMs?: number; staleMs?: number; pollMs?: number } = {},
): void {
  const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const lockPath = join(cacheDir, ".install-lock");
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (lockIsStale(lockPath, staleMs)) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `timed out waiting for another calldiff process to finish installing grammars into ${cacheDir}. Remove ${lockPath} if no such process is running.`,
        );
      }
      sleepSync(pollMs);
    }
  }

  try {
    install();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

/**
 * npm argv for installing one grammar into the cache.
 *
 * The install must be *recorded* in the cache's package.json. npm reconciles
 * the installed tree against that file every time, so under the previous
 * `--no-save` — against a package.json that listed no dependencies — each
 * grammar pruned the one installed before it ("added 1 package, and removed 1
 * package"). The cache only ever held the most recently used language, so a
 * polyglot repository re-downloaded and natively rebuilt a grammar on every
 * run. Exact versions, so installing one grammar cannot drift another.
 */
export function grammarInstallArgs(
  cacheDir: string,
  installSpec: string,
): string[] {
  return [
    "install",
    "--prefix",
    cacheDir,
    "--save-exact",
    "--no-fund",
    "--no-audit",
    "--legacy-peer-deps",
    installSpec,
  ];
}

/**
 * Install an npm grammar package into the shared cache if missing, then require it.
 * Reuses the cache across CLI invocations.
 */
export function loadGrammarPackage(
  npmPackage: string,
  /** Language id, for error messages: "no grammar for python" beats the package. */
  languageId?: string,
): GrammarModule {
  // Prefer the app's own dependency when present (e.g. tree-sitter-typescript).
  try {
    const localRequire = createRequire(import.meta.url);
    try {
      return localRequire(npmPackage) as GrammarModule;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        code === "ERR_REQUIRE_ASYNC_MODULE" ||
        msg.includes("top-level await")
      ) {
        const entry = localRequire.resolve(npmPackage);
        const packageRoot = join(entry, "..", "..");
        const binding = loadNativeBinding(packageRoot);
        if (binding) return binding;
      }
      throw err;
    }
  } catch {
    // fall through to cache
  }

  const cacheDir = grammarCacheDir();
  const name = languageId ?? npmPackage;
  if (!packageInstalled(cacheDir, npmPackage)) {
    if (grammarsOffline()) {
      throw new Error(
        `no grammar for ${name} available offline: ${npmPackage} is not bundled and not in ${cacheDir}. Install it there, or drop --offline / CALLDIFF_OFFLINE to fetch it on demand.`,
      );
    }
    const installSpec = INSTALL_SPEC[npmPackage] ?? npmPackage;
    try {
      // Inside the try: creating the cache directory is the step that fails
      // when the cache path is not writable, and its bare `mkdir` errno was
      // the least informative thing a caller could be handed.
      ensureCachePackageJson(cacheDir);
      withInstallLock(cacheDir, () => {
        // Re-check under the lock: whoever held it may have been installing
        // this very grammar, in which case there is nothing left to do.
        if (packageInstalled(cacheDir, npmPackage)) return;
        execFileSync("npm", grammarInstallArgs(cacheDir, installSpec), {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });
      });
    } catch (err) {
      // Without this the caller sees the raw errno — `mkdir '/nonexistent'` —
      // and has to guess which grammar was being fetched, or that one was.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `failed to install grammar for ${name} (${installSpec}) into ${cacheDir}: ${message}`,
      );
    }
  }

  const require = createRequire(join(cacheDir, "package.json"));
  const packageRoot = join(cacheDir, "node_modules", npmPackage);
  return requireGrammar(require, npmPackage, packageRoot);
}

/** Resolve the value to pass to parser.setLanguage. */
export function resolveLanguage(
  mod: GrammarModule,
  exportName?: string,
): unknown {
  if (exportName) {
    const named = mod[exportName];
    if (named != null) return named;
  }
  // Native grammar packages export { language, nodeTypeInfo, ... } — pass the module.
  return mod;
}

export function readCachedPackageVersion(
  npmPackage: string,
): string | null {
  const cacheDir = grammarCacheDir();
  const pkgJson = join(cacheDir, "node_modules", npmPackage, "package.json");
  if (!existsSync(pkgJson)) return null;
  try {
    const raw = JSON.parse(readFileSync(pkgJson, "utf8")) as {
      version?: string;
    };
    return raw.version ?? null;
  } catch {
    return null;
  }
}
