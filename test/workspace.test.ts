import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

describe("workspace fixture smoke", () => {
  test("calldiff reach finds paths in a temp repo", () => {
    const host = workspace({
      "/src/checkout.ts": `
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
    expect(result.stdout).toEqual(
      [
        "calldiff reach working tree: runCheckout → sendEmail",
        "",
        "# path 1",
        "runCheckout()",
        "└─ if (!reserved)",
        "   └─ notifyCustomer()",
        "      └─ sendEmail()",
        "",
        "# path 2",
        "runCheckout()",
        "└─ notifyCustomer()",
        "   └─ sendEmail()",
        "",
      ].join("\n"),
    );
  });

  test("calldiff tree prints a call tree for an entrypoint", () => {
    const host = workspace({
      "/src/app.ts": `
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
    expect(result.stdout).toEqual(
      [
        "calldiff tree working tree",
        "",
        "boot()",
        "├─ init()",
        "└─ run()",
        "   └─ work()",
        "",
      ].join("\n"),
    );
  });

  test("calldiff diff compares two commits", () => {
    const host = workspace();
    host.write({
      "/src/app.ts": "export function root() { beforeCall(); }\n",
    });
    const before = host.commit("before");
    host.write({
      "/src/app.ts": "export function root() { afterCall(); }\n",
    });
    const after = host.commit("after");

    const result = host.run(`calldiff diff ${before} ${after} -e root`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("- ├─ beforeCall()");
    expect(result.stdout).toContain("+ └─ afterCall()");
  });
});
