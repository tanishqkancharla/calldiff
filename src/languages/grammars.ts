import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

/** Per-package prefix so concurrent installs do not share a node_modules. */
function isolatedPrefix(cacheDir: string, npmPackage: string): string {
  return join(cacheDir, "packages", ...npmPackage.split("/"));
}

function packageRoot(prefix: string, npmPackage: string): string {
  return join(prefix, "node_modules", npmPackage);
}

function isInstalled(prefix: string, npmPackage: string): boolean {
  return existsSync(packageRoot(prefix, npmPackage));
}

function writeStubPackageJson(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "calldiff-grammar-cache",
      private: true,
      description: "On-demand tree-sitter grammars for calldiff",
    }),
    "utf8",
  );
}

/**
 * Install one grammar into its own prefix via a unique staging dir, then
 * rename into place. Different packages never share a node_modules; two
 * processes installing the same package race on rename, not on npm extract.
 */
function installIsolated(cacheDir: string, npmPackage: string): void {
  const dest = isolatedPrefix(cacheDir, npmPackage);
  if (isInstalled(dest, npmPackage)) return;

  const staging = join(
    cacheDir,
    ".staging",
    `${npmPackage.replace(/\//g, "__")}-${process.pid}-${randomBytes(4).toString("hex")}`,
  );
  writeStubPackageJson(staging);
  const installSpec = INSTALL_SPEC[npmPackage] ?? npmPackage;
  try {
    execFileSync(
      "npm",
      [
        "install",
        "--prefix",
        staging,
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
    mkdirSync(dirname(dest), { recursive: true });
    try {
      renameSync(staging, dest);
    } catch (err) {
      rmSync(staging, { recursive: true, force: true });
      if (isInstalled(dest, npmPackage)) return;
      throw err;
    }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

function resolvePrefix(cacheDir: string, npmPackage: string): string {
  const isolated = isolatedPrefix(cacheDir, npmPackage);
  if (isInstalled(isolated, npmPackage)) return isolated;
  // Pre-isolation caches lived in a single shared node_modules.
  if (isInstalled(cacheDir, npmPackage)) return cacheDir;
  return isolated;
}

/**
 * Some grammar packages (e.g. tree-sitter-c-sharp ≥0.23.5) ship ESM bindings
 * with top-level await, which `require()` cannot load. Fall back to the native
 * `.node` addon via node-gyp-build — same payload the JS wrapper would return.
 */
function loadNativeBinding(packageRootDir: string): GrammarModule | null {
  try {
    const require = createRequire(join(packageRootDir, "package.json"));
    const gypBuild = require("node-gyp-build") as (
      root: string,
    ) => GrammarModule;
    const binding = gypBuild(packageRootDir);
    try {
      (binding as { nodeTypeInfo?: unknown }).nodeTypeInfo = require(
        join(packageRootDir, "src", "node-types.json"),
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
  packageRootDir: string,
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
      const binding = loadNativeBinding(packageRootDir);
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
        const packageRootDir = join(entry, "..", "..");
        const binding = loadNativeBinding(packageRootDir);
        if (binding) return binding;
      }
      throw err;
    }
  } catch {
    // fall through to cache
  }

  const cacheDir = grammarCacheDir();
  const prefix = resolvePrefix(cacheDir, npmPackage);
  if (!isInstalled(prefix, npmPackage)) {
    installIsolated(cacheDir, npmPackage);
  }

  const installed = resolvePrefix(cacheDir, npmPackage);
  const require = createRequire(join(installed, "package.json"));
  return requireGrammar(
    require,
    npmPackage,
    packageRoot(installed, npmPackage),
  );
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
  const pkgJson = join(
    packageRoot(resolvePrefix(cacheDir, npmPackage), npmPackage),
    "package.json",
  );
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
