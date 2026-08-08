import { test as base, expect } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { callstackDiff } from "./helpers.js";

type CallstackAssertion = {
  toEqual: (expected: string) => void;
};

/**
 * Vitest fixtures for the callstack-diff test format:
 * a +/- TypeScript file diff in, ASCII callstack diff out.
 */
export const test = base.extend<{
  /**
   * `expectCallstack(diff, symbol).toEqual(callstackDiff)` —
   * both strings are automatically outdented for +/- markers.
   */
  expectCallstack: (diff: string, symbol: string) => CallstackAssertion;
}>({
  expectCallstack: async ({}, use) => {
    await use((diff, symbol) => {
      const actual = callstackDiff(diffOutdent(diff), symbol);
      return {
        toEqual(expected: string) {
          expect(actual).toBe(diffOutdent(expected));
        },
      };
    });
  },
});

export { expect };
