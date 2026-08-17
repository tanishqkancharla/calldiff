import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });
const checkoutDir = join(process.cwd(), "examples/checkout");

function checkoutWorkspace() {
  const files = [
    "checkout.ts",
    "cart.ts",
    "inventory.ts",
    "payments.ts",
    "notify.ts",
  ];
  const seeded: Record<string, string> = {};
  for (const name of files) {
    seeded[`/${name}`] = readFileSync(join(checkoutDir, name), "utf8");
  }
  return workspace(seeded);
}

describe("call-site source locations", () => {
  test("child locs point at the caller file/line, not the callee definition", () => {
    const host = checkoutWorkspace();
    const result = host.run("calldiff tree -e runCheckout --locs");

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^runCheckout\(userId, cartId\) {2}checkout\.ts:12$/m);
    expect(result.stdout).toMatch(/Cart\.load\(cartId\) {2}checkout\.ts:13/);
    expect(result.stdout).toMatch(/readCart\(cartId\) {2}cart\.ts:8/);
    expect(result.stdout).not.toMatch(/readCart\(cartId\) {2}cart\.ts:21/);
  });

  test("ASCII render appends file:line; unresolved calls still show call-site", () => {
    const host = workspace({
      "/app.ts": src`
        export function outer() {
          known();
          mystery();
        }
        function known() {}
      `,
    });

    const result = host.run("calldiff tree -e outer --locs");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(src`
      outer()  app.ts:1
      ├─ known()  app.ts:2
      └─ mystery()  app.ts:3
    `.trimEnd());
  });

  test("branch nodes carry condition locs; children keep call-site locs", () => {
    const host = workspace({
      "/gate.ts": src`
        export function gate(ok: boolean) {
          if (ok) {
            yes();
          } else {
            no();
          }
        }
        function yes() {}
        function no() {}
      `,
    });

    const result = host.run("calldiff tree -e gate --locs");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(src`
      gate(ok)  gate.ts:1
      ├─ if (ok)  gate.ts:2
         └─ yes()  gate.ts:3
      └─ else  gate.ts:4-6
         └─ no()  gate.ts:5
    `.trimEnd());
  });

  test("locs:false omits suffixes from ASCII", () => {
    const host = workspace({
      "/app.ts": src`
        export function outer() {
          known();
        }
        function known() {}
      `,
    });

    const result = host.run("calldiff tree -e outer");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(src`
      outer()
      └─ known()
    `.trimEnd());
    expect(result.stdout).not.toMatch(/app\.ts:\d/);
  });
});
