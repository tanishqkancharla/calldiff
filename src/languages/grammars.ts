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
 * Install an npm grammar package into the shared cache if missing, then require it.
 * Reuses the cache across CLI invocations.
 */
export function loadGrammarPackage(npmPackage: string): GrammarModule {
  // Prefer the app's own dependency when present (e.g. tree-sitter-typescript).
  try {
    const local = createRequire(import.meta.url)(npmPackage);
    if (local) return local as GrammarModule;
  } catch {
    // fall through to cache
  }

  const cacheDir = grammarCacheDir();
  if (!packageInstalled(cacheDir, npmPackage)) {
    ensureCachePackageJson(cacheDir);
    execFileSync(
      "npm",
      ["install", "--prefix", cacheDir, "--no-save", "--no-fund", "--no-audit", npmPackage],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      },
    );
  }

  const require = createRequire(join(cacheDir, "package.json"));
  return require(npmPackage) as GrammarModule;
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
    const raw = JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: string };
    return raw.version ?? null;
  } catch {
    return null;
  }
}
