import { describe, expect, test } from "vitest";
import { buildCallTree } from "../src/calltree.js";
import { buildIndex, extractFunctions } from "../src/extract.js";
import { findReachPaths } from "../src/reach.js";
import { renderTree } from "../src/render.js";

const source = `
  export function runCheckout() {
    Cart.validate();
    const reserved = Inventory.reserve();
    if (!reserved) {
      notifyCustomer();
      return;
    }
    PaymentGateway.charge();
    notifyCustomer();
  }

  class Cart {
    static validate() {
      assertNonEmpty();
    }
  }

  class Inventory {
    static reserve() {
      lockSku();
      return true;
    }
  }

  class PaymentGateway {
    static charge() {
      capture();
    }
  }

  function assertNonEmpty() {}
  function lockSku() {}
  function capture() {}
  function notifyCustomer() {
    sendEmail();
  }
  function sendEmail() {}
`;

function indexOf(src: string) {
  return buildIndex(extractFunctions("checkout.ts", src));
}

describe("reach paths", () => {
  test("finds every path from entry to target across branches", () => {
    const index = indexOf(source);
    const paths = findReachPaths("runCheckout", "sendEmail", index, 12);
    const ascii = paths.map((p) =>
      renderTree(p, { color: false, locs: false }),
    );

    expect(ascii).toEqual([
      [
        "runCheckout()",
        "└─ if (!reserved)",
        "   └─ notifyCustomer()",
        "      └─ sendEmail()",
      ].join("\n"),
      [
        "runCheckout()",
        "└─ notifyCustomer()",
        "   └─ sendEmail()",
      ].join("\n"),
    ]);
  });

  test("finds a single deep path to a leaf helper", () => {
    const index = indexOf(source);
    const paths = findReachPaths("runCheckout", "capture", index, 12);
    expect(paths).toHaveLength(1);
    expect(renderTree(paths[0]!, { color: false, locs: false })).toBe(
      [
        "runCheckout()",
        "└─ PaymentGateway.charge()",
        "   └─ capture()",
      ].join("\n"),
    );
  });

  test("returns empty when target is unreachable", () => {
    const index = indexOf(source);
    expect(findReachPaths("runCheckout", "missing", index, 12)).toEqual([]);
  });

  test("matches the full expanded tree when target is the entry", () => {
    const index = indexOf(source);
    const paths = findReachPaths("runCheckout", "runCheckout", index, 12);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.children).toEqual([]);
    expect(buildCallTree("runCheckout", index, 12).key).toBe("runCheckout");
  });
});
