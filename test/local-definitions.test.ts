import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

/** Keep the trailing newline so expectations match CLI stdout. */
const src = outdent({ trimTrailingNewline: false });

/**
 * Helpers declared inside a function body.
 *
 * They were never extracted, so a call to one resolved through the global
 * bare-key map to whatever top-level function elsewhere in the repo shared the
 * name — grafting an unrelated body into the tree. See #19.
 */
describe("locally declared helpers", () => {
  const tree = src`
    export function buildTree(rows: Row[]): Tree {
      const byId = index(rows);
      const walk = (id: string, depth: number): void => {
        for (const kid of byId[id].children) walk(kid, depth + 1);
      };
      for (const r of roots) walk(r, 0);
      return byId;
    }

    function index(rows: Row[]) {
      return rows;
    }
  `;

  const gate = src`
    import { readdirSync } from "node:fs";

    export function walk(dir: string, rel = ""): void {
      readdirSync(dir);
    }
  `;

  test("expands the caller's own helper, not a same-named function elsewhere", () => {
    const host = workspace({
      "/scripts/gate.ts": gate,
      "/src/tree.ts": tree,
    });

    const result = host.run("calldiff tree --entry buildTree");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(outdent`
      buildTree(rows)
      ├─ index(rows)
      └─ walk(id, depth)
         └─ walk(id, depth) ⇄
    `);
    expect(result.stdout).not.toContain("readdirSync");
  });

  test("does not depend on which file is indexed first", () => {
    // `scripts/` sorts before `src/`; `zz/` sorts after.
    const gateFirst = workspace({
      "/scripts/gate.ts": gate,
      "/src/tree.ts": tree,
    });
    const treeFirst = workspace({
      "/src/tree.ts": tree,
      "/zz/gate.ts": gate,
    });

    const a = gateFirst.run("calldiff tree --entry buildTree");
    const b = treeFirst.run("calldiff tree --entry buildTree");

    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(a.stdout).toBe(b.stdout);
  });

  test("the top-level definition still expands when entered directly", () => {
    const host = workspace({
      "/scripts/gate.ts": gate,
      "/src/tree.ts": tree,
    });

    const result = host.run("calldiff tree --entry walk");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(outdent`
      walk(dir, rel)
      └─ readdirSync()
    `);
  });

  test("reach does not report a path through a grafted body", () => {
    const host = workspace({
      "/src/tree.ts": tree,
      "/scripts/gate.ts": src`
        import { sendEmail } from "../src/mail";

        export function walk(dir: string): void {
          sendEmail(dir);
        }
      `,
      "/src/mail.ts": src`
        export function sendEmail(id: string): void {
          console.log(id);
        }
      `,
    });

    // buildTree imports nothing from mail.ts; the only route to sendEmail was
    // through the impostor `walk` in scripts/gate.ts.
    const result = host.run("calldiff reach -e buildTree --to sendEmail");

    expect(result.stdout).toContain("No paths from buildTree to sendEmail.");
  });

  test("javascript helpers resolve the same way", () => {
    const host = workspace({
      "/scripts/gate.js": src`
        export function walk(dir) {
          readdirSync(dir);
        }
      `,
      "/src/tree.js": src`
        export function buildTree(rows) {
          const walk = (id) => visit(id);
          walk(rows);
        }

        function visit(id) {}
      `,
    });

    const result = host.run("calldiff tree --entry buildTree");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(outdent`
      buildTree(rows)
      └─ walk(id)
         └─ visit(id)
    `);
    expect(result.stdout).not.toContain("readdirSync");
  });
});
