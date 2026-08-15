import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { buildCallTree } from "../src/calltree.js";
import { buildIndex, extractFunctions } from "../src/extract.js";
import { findReachPaths } from "../src/reach.js";
import { renderTree } from "../src/render.js";
import type { CallNode } from "../src/types.js";
import { workspace } from "./workspace.js";

/**
 * Three different facts used to serialize identically, so a consumer could not
 * filter a tree to "calls into code in this repository": an unresolved callee,
 * a resolved definition cut off by `--max-depth`, and a resolved definition
 * that makes no calls. All three are childless leaves; only the resolver knew
 * them apart, and it dropped what it knew.
 */
const source = `
  export function entry(): void {
    external();
    empty();
    hasBody();
    recurse();
  }

  export function empty(): void {}

  export function hasBody(): void {
    empty();
  }

  export function recurse(): void {
    entry();
  }
`;

const index = buildIndex(extractFunctions("app.ts", source));

function childOf(tree: CallNode, label: string): CallNode {
  const found = tree.children.find((c) => c.label.startsWith(label));
  if (!found) throw new Error(`no child ${label} in ${tree.label}`);
  return found;
}

describe("resolution state on CallNode", () => {
  test("an unresolved callee is marked, with no declaration", () => {
    const node = childOf(buildCallTree("entry", index, 12), "external");
    expect(node.resolved).toBe(false);
    expect(node.declaredIn).toBeUndefined();
    expect(node.truncated).toBeUndefined();
    expect(node.children).toEqual([]);
  });

  test("a resolved definition carries where it is declared", () => {
    const node = childOf(buildCallTree("entry", index, 12), "empty");
    expect(node.resolved).toBe(true);
    expect(node.declaredIn).toEqual({ file: "app.ts", line: 9 });
  });

  test("an empty body is not marked truncated", () => {
    const node = childOf(buildCallTree("entry", index, 12), "empty");
    expect(node.children).toEqual([]);
    expect(node.truncated).toBeUndefined();
  });

  test("a body cut off by --max-depth is marked truncated", () => {
    const node = childOf(buildCallTree("entry", index, 1), "hasBody");
    expect(node.resolved).toBe(true);
    expect(node.truncated).toBe(true);
    expect(node.children).toEqual([]);
  });

  test("the depth cap does not mark an unresolved callee truncated", () => {
    const node = childOf(buildCallTree("entry", index, 1), "external");
    expect(node.resolved).toBe(false);
    expect(node.truncated).toBeUndefined();
  });

  test("a cycle is a flag, not just a unicode suffix in the label", () => {
    const node = childOf(
      childOf(buildCallTree("entry", index, 12), "recurse"),
      "entry",
    );
    expect(node.recursive).toBe(true);
    // The suffix stays for ASCII readers.
    expect(node.label).toBe("entry() ⇄");
  });

  test("branches carry no resolution state; they are not calls", () => {
    const branchIndex = buildIndex(
      extractFunctions(
        "b.ts",
        `
          export function run(x: number): void {
            if (x > 0) { work(); }
          }
          export function work(): void {}
        `,
      ),
    );
    const branch = buildCallTree("run", branchIndex, 12).children[0]!;
    expect(branch.kind).toBe("branch");
    expect(branch.resolved).toBeUndefined();
    expect(branch.declaredIn).toBeUndefined();
  });

  test("reach paths keep the state through pathToTree", () => {
    const [path] = findReachPaths("entry", "empty", index, 12);
    expect(path).toBeDefined();
    expect(path!.resolved).toBe(true);
    expect(path!.declaredIn).toEqual({ file: "app.ts", line: 2 });
    expect(path!.children[0]!.declaredIn).toEqual({ file: "app.ts", line: 9 });
  });

  test("ASCII rendering is untouched by the new fields", () => {
    expect(renderTree(buildCallTree("entry", index, 12), { color: false })).toBe(
      outdent`
        entry()
        ├─ external()
        ├─ empty()
        ├─ hasBody()
        │  └─ empty()
        └─ recurse()
           └─ entry() ⇄
      `,
    );
  });
});

describe("resolution state in --format json", () => {
  test("survives serialization, and only on the nodes that have it", () => {
    const host = workspace({
      "/src/app.ts": outdent`
        export function entry(): void {
          external();
          hasBody();
        }
        export function hasBody(): void {
          leaf();
        }
        export function leaf(): void {}
      `,
    });

    const result = host.run(
      "calldiff tree -e entry --max-depth 1 --format json --full-output -- src",
    );

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { trees: Array<{ tree: CallNode }> };
    };
    const tree = parsed.data.trees[0]!.tree;

    expect(tree.resolved).toBe(true);
    expect(tree.declaredIn).toEqual({ file: "src/app.ts", line: 1 });

    const external = tree.children.find((c) => c.key === "external")!;
    expect(external.resolved).toBe(false);
    expect(external).not.toHaveProperty("declaredIn");
    expect(external).not.toHaveProperty("truncated");

    const hasBody = tree.children.find((c) => c.key === "hasBody")!;
    expect(hasBody.resolved).toBe(true);
    expect(hasBody.declaredIn).toEqual({ file: "src/app.ts", line: 5 });
    expect(hasBody.truncated).toBe(true);
  });
});
