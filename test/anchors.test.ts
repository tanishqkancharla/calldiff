import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCallTree } from "../src/calltree.js";
import { diffTrees } from "../src/diff.js";
import { buildIndex, extractFunctions } from "../src/extract.js";
import type { DiffNode } from "../src/types.js";

const beforeSource = [
  "export function boot() {", // line 1
  "  AuthStorage.create();", // line 2
  "}",
  "class AuthStorage {",
  "  static create() {}",
  "}",
].join("\n");

const afterSource = [
  "export function boot() {", // line 1
  "  if (ready) {", // line 2
  "    getServices();", // line 3
  "  }",
  "}",
  "function getServices() {",
  "  AuthStorage.create();", // line 7
  "}",
  "class AuthStorage {",
  "  static create() {}",
  "}",
].join("\n");

function findByKey(node: DiffNode, key: string): DiffNode | null {
  if (node.key === key) return node;
  for (const child of node.children) {
    const hit = findByKey(child, key);
    if (hit) return hit;
  }
  return null;
}

test("nodes carry source anchors: sites for calls/branches, definition for roots", () => {
  const before = buildIndex(extractFunctions("before.ts", beforeSource));
  const after = buildIndex(extractFunctions("after.ts", afterSource));

  const diff = diffTrees(
    buildCallTree("boot", before, 12),
    buildCallTree("boot", after, 12),
  );

  // Root anchors at its definition in the "to" snapshot.
  assert.deepEqual(diff.site, { file: "after.ts", line: 1 });

  // A removed call anchors at its site in the "from" snapshot.
  const removed = findByKey(diff, "AuthStorage.create");
  assert.equal(removed?.status, "removed");
  assert.deepEqual(removed?.site, { file: "before.ts", line: 2 });

  // An added branch anchors at the if-statement in the "to" snapshot.
  const branch = findByKey(diff, "if:ready");
  assert.equal(branch?.status, "added");
  assert.deepEqual(branch?.site, { file: "after.ts", line: 2 });

  // The call inside the added helper anchors where it is written — the
  // helper's own body in the "to" snapshot.
  const added = findByKey(diff, "getServices");
  assert.equal(added?.status, "added");
  assert.deepEqual(added?.site, { file: "after.ts", line: 3 });
  const nested = findByKey(added!, "AuthStorage.create");
  assert.deepEqual(nested?.site, { file: "after.ts", line: 7 });
});
