import { test as base, expect } from "vitest";
import { fixture as fixtureTag } from "./fixture.js";
import { callstackDiff } from "./helpers.js";

/**
 * Vitest fixtures for the callstack-diff test format:
 * a +/- TypeScript file diff in, ASCII callstack diff out.
 */
export const test = base.extend<{
  /** Outdenting +/- template tag used for file and callstack fixtures. */
  fixture: typeof fixtureTag;
  /**
   * Assert that `fileDiff` at `entry` renders as `expected` (also typically a
   * `fixture` template).
   */
  expectCallstack: (
    fileDiff: string,
    entry: string,
    expected: string,
  ) => void;
}>({
  fixture: async ({}, use) => {
    await use(fixtureTag);
  },
  expectCallstack: async ({}, use) => {
    await use((fileDiff, entry, expected) => {
      expect(callstackDiff(fileDiff, entry)).toBe(expected);
    });
  },
});

export { expect };
