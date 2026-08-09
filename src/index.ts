export { parseArgs, printHelp } from "./args.js";
export { buildCallTree, resolveEntry } from "./calltree.js";
export { diffTrees, treeHasChanges } from "./diff.js";
export { buildIndex, extractFunctions } from "./extract.js";
export { renderDiff } from "./render.js";
export {
  analyzeRepositoryFiles,
  diffRepositoryCallSnapshots,
  projectRepositoryCallSnapshot,
  REPOSITORY_CALL_DELTA_SCHEMA,
  REPOSITORY_CALL_PROJECTION_SCHEMA,
} from "./repository-analysis.js";
export {
  buildRepositoryCallSnapshot,
  REPOSITORY_CALL_SNAPSHOT_SCHEMA,
} from "./repository-snapshot.js";
export { listSupportedExtensions, listSupportedLanguages } from "./languages/registry.js";
export { run } from "./run.js";
export type * from "./repository-analysis.js";
export type * from "./repository-snapshot.js";
export type * from "./types.js";
