import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

/** Keep the trailing newline so expectations match CLI stdout. */
const src = outdent({ trimTrailingNewline: false });

const webCheckout = src`
  import { sendEmail } from "../mail/send";

  export async function runCheckout(id: string): Promise<void> {
    await sendEmail(id);
  }
`;

const jobsCheckout = src`
  import { sendEmail } from "../mail/send";

  export async function runCheckout(
    id: string,
    retry: boolean,
  ): Promise<void> {
    if (retry) {
      await sendEmail(id);
    }
  }
`;

const sendEmail = src`
  export async function sendEmail(id: string): Promise<void> {
    console.log(id);
  }
`;

/**
 * Repro for https://github.com/tanishqkancharla/calldiff/issues/20
 *
 * Two files export `runCheckout`; both reach `sendEmail`. `reach` is
 * documented as returning *all* paths, but bare-name indexing + single
 * `resolveEntry` picks one definition and silently drops the other.
 */
describe("issue #20: reach with duplicate entrypoint names", () => {
  // Expected to fail until reach walks every matching entry definition.
  test.fails("reports paths from every matching runCheckout definition", () => {
    const host = workspace({
      "/src/web/checkout.ts": webCheckout,
      "/src/jobs/checkout.ts": jobsCheckout,
      "/src/mail/send.ts": sendEmail,
    });

    const result = host.run(
      "calldiff reach -e runCheckout --to sendEmail -- src",
    );

    expect(result.code).toBe(0);

    // Unconditional path from src/web/checkout.ts
    expect(result.stdout).toContain(outdent`
      runCheckout(id)
      └─ sendEmail(id)
    `);

    // Conditional path from src/jobs/checkout.ts
    expect(result.stdout).toContain(outdent`
      runCheckout(id, retry)
      └─ if (retry)
         └─ sendEmail(id)
    `);
  });

  test.fails("answer does not depend on which directory name sorts first", () => {
    const withJobs = workspace({
      "/src/web/checkout.ts": webCheckout,
      "/src/jobs/checkout.ts": jobsCheckout,
      "/src/mail/send.ts": sendEmail,
    });
    const withZjobs = workspace({
      "/src/web/checkout.ts": webCheckout,
      "/src/zjobs/checkout.ts": jobsCheckout,
      "/src/mail/send.ts": sendEmail,
    });

    const a = withJobs.run(
      "calldiff reach -e runCheckout --to sendEmail -- src",
    );
    const b = withZjobs.run(
      "calldiff reach -e runCheckout --to sendEmail -- src",
    );

    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    // Same question → same complete answer, regardless of path sort order.
    expect(a.stdout).toBe(b.stdout);
  });
});
