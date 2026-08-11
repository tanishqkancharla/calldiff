import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

/** Keep the trailing newline so expectations match CLI stdout. */
const src = outdent({ trimTrailingNewline: false });

describe("workspace fixture smoke", () => {
  test("calldiff reach finds paths in a temp repo", () => {
    const host = workspace({
      "/src/checkout.ts": src`
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
      `,
    });

    const result = host.run(
      "calldiff reach -e runCheckout --to sendEmail",
    );

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

  test("calldiff tree prints a call tree for an entrypoint", () => {
    const host = workspace({
      "/src/app.ts": src`
        export function boot() {
          init();
          run();
        }
        function init() {}
        function run() {
          work();
        }
        function work() {}
      `,
    });

    const result = host.run("calldiff tree --entry boot");

    expect(result.code).toBe(0);
    expect(result.stdout).toEqual(src`
      calldiff tree working tree

      boot()
      ├─ init()
      └─ run()
         └─ work()
    `);
  });

  test("calldiff diff compares two commits", () => {
    const host = workspace();
    const before = host.commit("before", {
      "/src/app.ts": src`
        export function root() {
          beforeCall();
        }
      `,
    });
    const after = host.commit("after", {
      "/src/app.ts": src`
        export function root() {
          afterCall();
        }
      `,
    });

    const result = host.run(`calldiff diff ${before} ${after} -e root`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("- ├─ beforeCall()");
    expect(result.stdout).toContain("+ └─ afterCall()");
  });
});
