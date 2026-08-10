import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildCallTree } from "../src/calltree.js";
import { buildIndex, extractFunctions } from "../src/extract.js";
import { renderTree } from "../src/render.js";

const checkoutDir = join(process.cwd(), "examples/checkout");

function loadCheckoutIndex() {
  const files = [
    "checkout.ts",
    "cart.ts",
    "inventory.ts",
    "payments.ts",
    "notify.ts",
  ];
  const all = files.flatMap((name) => {
    const file = `examples/checkout/${name}`;
    const source = readFileSync(join(checkoutDir, name), "utf8");
    return extractFunctions(file, source);
  });
  return buildIndex(all);
}

describe("call-site source locations", () => {
  test("child locs point at the caller file/line, not the callee definition", () => {
    const index = loadCheckoutIndex();
    const tree = buildCallTree("runCheckout", index, 12);

    // Root = definition of runCheckout in checkout.ts
    expect(tree.file).toBe("examples/checkout/checkout.ts");
    expect(tree.line).toBe(12);

    const cartLoad = tree.children.find((c) => c.key === "Cart.load");
    expect(cartLoad).toBeTruthy();
    // Call site is inside runCheckout, not Cart.load's definition in cart.ts
    expect(cartLoad!.file).toBe("examples/checkout/checkout.ts");
    expect(cartLoad!.line).toBe(13);

    const readCart = cartLoad!.children.find((c) => c.key === "readCart");
    expect(readCart).toBeTruthy();
    // Call site is inside Cart.load in cart.ts (not readCart's own definition)
    expect(readCart!.file).toBe("examples/checkout/cart.ts");
    expect(readCart!.line).toBe(8);
    // Definition of readCart is later in the same file — must not use that line
    expect(readCart!.line).not.toBe(21);
  });

  test("ASCII render appends file:line; unresolved calls still show call-site", () => {
    const source = `
export function outer() {
  known();
  mystery();
}
function known() {}
`;
    const index = buildIndex(extractFunctions("app.ts", source));
    const tree = buildCallTree("outer", index, 12);
    const ascii = renderTree(tree, { color: false, locs: true });

    expect(ascii).toBe(
      [
        "outer()  app.ts:2",
        "├─ known()  app.ts:3",
        "└─ mystery()  app.ts:4",
      ].join("\n"),
    );

    const mystery = tree.children.find((c) => c.key === "mystery");
    expect(mystery).toMatchObject({
      file: "app.ts",
      line: 4,
    });
  });

  test("branch nodes carry condition locs; children keep call-site locs", () => {
    const source = `
export function gate(ok: boolean) {
  if (ok) {
    yes();
  } else {
    no();
  }
}
function yes() {}
function no() {}
`;
    const index = buildIndex(extractFunctions("gate.ts", source));
    const tree = buildCallTree("gate", index, 12);
    const ifArm = tree.children.find((c) => c.key.startsWith("if:"));
    const elseArm = tree.children.find((c) => c.key === "else");
    expect(ifArm?.file).toBe("gate.ts");
    expect(ifArm?.line).toBe(3);
    expect(elseArm?.file).toBe("gate.ts");

    expect(ifArm!.children[0]).toMatchObject({
      key: "yes",
      file: "gate.ts",
      line: 4,
    });
    expect(elseArm!.children[0]).toMatchObject({
      key: "no",
      file: "gate.ts",
      line: 6,
    });
  });

  test("locs:false omits suffixes from ASCII", () => {
    const source = `
export function outer() {
  known();
}
function known() {}
`;
    const index = buildIndex(extractFunctions("app.ts", source));
    const tree = buildCallTree("outer", index, 12);
    expect(renderTree(tree, { color: false, locs: false })).toBe(
      ["outer()", "└─ known()"].join("\n"),
    );
  });
});
