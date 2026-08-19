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

/**
 * Loaded tree-sitter grammar package surface.
 * Named exports (`typescript`, `tsx`, …) are looked up by `resolveLanguage`.
 */
export type GrammarModule = {
  language?: GrammarModule;
  typescript?: GrammarModule;
  tsx?: GrammarModule;
  [exportName: string]: GrammarModule | undefined;
};

/** Runtime grammar handle passed to `parser.setLanguage`. */
export type GrammarLanguage = GrammarModule;

type NativeBinding = GrammarModule & {
  nodeTypeInfo?: object;
};

type NodeGypBuild = (root: string) => GrammarModule;

type PackageJson = {
  version?: string;
};

function errnoCode(err: Error): string | undefined {
  // SAFETY: Node require/fs failures are ErrnoException with optional string code.
  return (err as NodeJS.ErrnoException).code;
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
    // SAFETY: node-gyp-build's default export is (root) => native binding.
    const gypBuild = require("node-gyp-build") as NodeGypBuild;
    const binding: NativeBinding = gypBuild(packageRoot);
    try {
      binding.nodeTypeInfo = require(
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
    // SAFETY: grammar packages export a module compatible with GrammarModule.
    return require(npmPackage) as GrammarModule;
  } catch (err) {
    const code = err instanceof Error ? errnoCode(err) : undefined;
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

function installSpecFor(npmPackage: string): string {
  switch (npmPackage) {
    case "tree-sitter-c-sharp":
      return "tree-sitter-c-sharp@0.23.1";
    case "@tree-sitter-grammars/tree-sitter-lua":
      // 0.4+ is ESM-with-TLA; 0.2.0 is CJS and loads via createRequire.
      return "@tree-sitter-grammars/tree-sitter-lua@0.2.0";
    default:
      return npmPackage;
  }
}

/**
 * Install an npm grammar package into the shared cache if missing, then require it.
 * Reuses the cache across CLI invocations.
 */
export function loadGrammarPackage(npmPackage: string): GrammarModule {
  // Prefer the app's own dependency when present (e.g. tree-sitter-typescript).
  try {
    const localRequire = createRequire(import.meta.url);
    try {
      // SAFETY: local dependency resolves to a tree-sitter grammar module.
      return localRequire(npmPackage) as GrammarModule;
    } catch (err) {
      const code = err instanceof Error ? errnoCode(err) : undefined;
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
        installSpecFor(npmPackage),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      },
    );
  }

  const require = createRequire(join(cacheDir, "package.json"));
  const packageRoot = join(cacheDir, "node_modules", npmPackage);
  return requireGrammar(require, npmPackage, packageRoot);
}

/** Resolve the value to pass to parser.setLanguage. */
export function resolveLanguage(
  mod: GrammarModule,
  exportName?: string,
): GrammarLanguage {
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
    const raw: unknown = JSON.parse(readFileSync(pkgJson, "utf8"));
    // SAFETY: npm package.json is JSON with an optional string version field.
    const pkg = raw as PackageJson;
    return pkg.version ?? null;
  } catch {
    return null;
  }
}
