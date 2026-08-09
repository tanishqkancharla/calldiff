import { describe, expect, test } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs show mode", () => {
  test("show with entry defaults to working tree", () => {
    const opts = parseArgs(["show", "-e", "boot"], "/repo");
    expect(opts.mode).toBe("show");
    expect(opts.from).toBeUndefined();
    expect(opts.to).toBeUndefined();
    expect(opts.entries).toEqual(["boot"]);
    expect(opts.cwd).toBe("/repo");
    expect(opts.maxDepth).toBe(12);
  });

  test("show with ref and multiple entries", () => {
    const opts = parseArgs(
      ["show", "abc123", "-e", "Foo.bar", "--entry", "baz"],
      "/repo",
    );
    expect(opts.mode).toBe("show");
    expect(opts.from).toBe("abc123");
    expect(opts.entries).toEqual(["Foo.bar", "baz"]);
  });

  test("show accepts --max-depth and path filters", () => {
    const opts = parseArgs(
      ["show", "HEAD", "-e", "main", "--max-depth", "4", "--", "src"],
      "/repo",
    );
    expect(opts.mode).toBe("show");
    expect(opts.from).toBe("HEAD");
    expect(opts.maxDepth).toBe(4);
    expect(opts.paths).toEqual(["src"]);
  });

  test("show requires --entry", () => {
    expect(() => parseArgs(["show"], "/repo")).toThrow(
      /show requires --entry/,
    );
  });

  test("show rejects --from / --to", () => {
    expect(() =>
      parseArgs(["show", "--from", "a", "-e", "x"], "/repo"),
    ).toThrow(/does not accept --from \/ --to/);
  });

  test("show rejects too many refs", () => {
    expect(() =>
      parseArgs(["show", "a", "b", "-e", "x"], "/repo"),
    ).toThrow(/at most one ref/);
  });

  test("diff mode is unchanged for positionals", () => {
    const opts = parseArgs(["main", "feature"], "/repo");
    expect(opts.mode).toBe("diff");
    expect(opts.from).toBe("main");
    expect(opts.to).toBe("feature");
  });

  test("show --help does not require entry", () => {
    const opts = parseArgs(["show", "--help"], "/repo");
    expect(opts.mode).toBe("show");
    expect(opts.help).toBe(true);
  });
});
