export { cli, normalizeArgv } from "./cli.js";
export { buildCallTree, resolveEntry } from "./calltree.js";
export { diffTrees, treeHasChanges } from "./diff.js";
export { buildIndex, extractFunctions } from "./extract.js";
export { renderDiff, renderTree } from "./render.js";
export { runDiff, runShow } from "./run.js";
export type * from "./types.js";
