export { cli, normalizeArgv } from "./cli.js";
export { buildCallTree, resolveAllEntries, resolveEntry } from "./calltree.js";
export { diffTrees, treeHasChanges } from "./diff.js";
export { allFunctions, buildIndex, extractFunctions } from "./extract.js";
export { formatSourceLoc, pickLoc } from "./loc.js";
export { collectPathsTo, findReachPaths, pathToTree } from "./reach.js";
export { renderDiff, renderTree } from "./render.js";
export { runDiff, runReach, runTree } from "./run.js";
export type * from "./types.js";
