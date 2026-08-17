import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

/** Keep the trailing newline so expectations match CLI stdout. */
const src = outdent({ trimTrailingNewline: false });

const checkout = src`
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
  function orphan() {}
`;

describe("reach paths", () => {
  test("finds every path from entry to target across branches", () => {
    const host = workspace({ "/checkout.ts": checkout });
    const result = host.run("calldiff reach -e runCheckout --to sendEmail");

    expect(result.code).toBe(0);
    expect(result.stdout).toEqual(src`
      calldiff reach working tree: runCheckout → sendEmail

      # path 1
      runCheckout()
      └─ if (!reserved)
         └─ notifyCustomer()
            └─ sendEmail()

      # path 2
      runCheckout()
      └─ notifyCustomer()
         └─ sendEmail()
    `);
  });

  test("finds a single deep path to a leaf helper", () => {
    const host = workspace({ "/checkout.ts": checkout });
    const result = host.run("calldiff reach -e runCheckout --to capture");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(src`
      runCheckout()
      └─ PaymentGateway.charge()
         └─ capture()
    `.trimEnd());
  });

  test("returns empty when target is unreachable", () => {
    const host = workspace({ "/checkout.ts": checkout });
    const result = host.run("calldiff reach -e runCheckout --to orphan");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No paths from runCheckout to orphan.");
  });

  test("matches the entry itself when target is the entry", () => {
    const host = workspace({ "/checkout.ts": checkout });
    const result = host.run("calldiff reach -e runCheckout --to runCheckout");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("runCheckout()");
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
