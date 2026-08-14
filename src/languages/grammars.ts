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

function sleepMs(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

/**
 * Serialize on-demand `npm install` into the shared grammar cache.
 * Parallel CLI processes (and e2e tests) otherwise race and hit ENOTEMPTY.
 */
function withInstallLock(cacheDir: string, fn: () => void): void {
  const lockDir = join(cacheDir, ".install.lock");
  mkdirSync(cacheDir, { recursive: true });
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      try {
        const ageMs = Date.now() - statSync(lockDir).mtimeMs;
        if (ageMs > 120_000) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        // lock disappeared; retry mkdir
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for grammar install lock at ${lockDir}`,
        );
      }
      sleepMs(50);
    }
  }
  try {
    fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/** On-disk cache of npm-installed tree-sitter grammar packages. */
export function grammarCacheDir(): string {
  const override = process.env.CALLDIFF_GRAMMAR_CACHE;
  if (override) return override;
  return join(homedir(), ".cache", "calldiff", "grammars");
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

/**
 * Install an npm grammar package into the shared cache if missing, then require it.
 * Reuses the cache across CLI invocations.
 */
export function loadGrammarPackage(npmPackage: string): GrammarModule {
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
  if (!packageInstalled(cacheDir, npmPackage)) {
    withInstallLock(cacheDir, () => {
      if (packageInstalled(cacheDir, npmPackage)) return;
      ensureCachePackageJson(cacheDir);
      const installSpec = INSTALL_SPEC[npmPackage] ?? npmPackage;
      execFileSync(
        "npm",
        [
          "install",
          "--prefix",
          cacheDir,
          "--no-save",
          "--no-fund",
          "--no-audit",
          "--legacy-peer-deps",
          installSpec,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        },
      );
    });
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
