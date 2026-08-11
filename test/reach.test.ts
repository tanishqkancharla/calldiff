import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { buildCallTree } from "../src/calltree.js";
import { buildIndex, extractFunctions } from "../src/extract.js";
import { findReachPaths } from "../src/reach.js";
import { renderTree } from "../src/render.js";
import { workspace } from "./workspace.js";

/** Keep the trailing newline so expectations match CLI stdout. */
const src = outdent({ trimTrailingNewline: false });

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

/**
 * Multi-file entry resolution via the CLI.
 *
 * When several files export the same entry name, reach reports paths from
 * every definition (its contract is completeness). See #20.
 */
describe("reach across duplicate entry names", () => {
  const direct = src`
    import { notify } from "../notify";

    export async function start(id: string): Promise<void> {
      await notify(id);
    }
  `;

  const gated = src`
    import { notify } from "../notify";

    export async function start(
      id: string,
      retry: boolean,
    ): Promise<void> {
      if (retry) {
        await notify(id);
      }
    }
  `;

  const notify = src`
    export async function notify(id: string): Promise<void> {
      console.log(id);
    }
  `;

  test("includes a path from each file that defines the entry", () => {
    const host = workspace({
      "/src/a/flow.ts": direct,
      "/src/b/flow.ts": gated,
      "/src/notify.ts": notify,
    });

    const result = host.run("calldiff reach -e start --to notify -- src");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(outdent`
      start(id)
      └─ notify(id)
    `);
    expect(result.stdout).toContain(outdent`
      start(id, retry)
      └─ if (retry)
         └─ notify(id)
    `);
  });

  test("does not change which paths are reported when files reorder", () => {
    // `a/` sorts before `b/` → gated definition is indexed first.
    const gatedFirst = workspace({
      "/src/a/flow.ts": gated,
      "/src/b/flow.ts": direct,
      "/src/notify.ts": notify,
    });
    // `z/` sorts after `a/` → direct definition is indexed first.
    const directFirst = workspace({
      "/src/a/flow.ts": direct,
      "/src/z/flow.ts": gated,
      "/src/notify.ts": notify,
    });

    const a = gatedFirst.run("calldiff reach -e start --to notify -- src");
    const b = directFirst.run("calldiff reach -e start --to notify -- src");

    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(a.stdout).toBe(b.stdout);
  });
});
