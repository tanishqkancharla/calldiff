import { extractFunctions } from "./extract.js";
import { listSourceFiles, readSnapshotFile } from "./git.js";
import type { FunctionInfo, Snapshot } from "./types.js";

export interface ParseDiagnostic {
  file: string;
  message: string;
}

export interface LoadFunctionsOptions {
  failOnReadError?: boolean;
}

export interface LoadedFunctions {
  files: string[];
  functions: FunctionInfo[];
  sources: Map<string, string>;
  diagnostics: ParseDiagnostic[];
}

/** Load every supported source file from one repository snapshot. */
export function loadFunctions(
  cwd: string,
  snapshot: Snapshot,
  pathFilters: string[],
  options: LoadFunctionsOptions = {},
): LoadedFunctions {
  const files = listSourceFiles(cwd, snapshot, pathFilters);
  const functions: FunctionInfo[] = [];
  const sources = new Map<string, string>();
  const diagnostics: ParseDiagnostic[] = [];

  for (const file of files) {
    const source = readSnapshotFile(cwd, snapshot, file);
    if (source === null) {
      const message = "source file could not be read";
      if (options.failOnReadError) {
        throw new Error(`${message}: ${file} @ ${snapshot.ref}`);
      }
      diagnostics.push({ file, message });
      continue;
    }
    sources.set(file, source);
    try {
      functions.push(...extractFunctions(file, source));
    } catch (error) {
      diagnostics.push({
        file,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { files, functions, sources, diagnostics };
}
