import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
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
