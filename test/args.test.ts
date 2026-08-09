import { describe, expect, test } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  test("keeps the default diff command", () => {
    expect(parseArgs(["main", "feature"], "/repo")).toMatchObject({
      command: "diff",
      from: "main",
      to: "feature",
      cwd: "/repo",
    });
  });

  test("parses a repository snapshot bundle", () => {
    expect(
      parseArgs(
        ["--snapshot", "main", "--output", ".calldiff", "--", "src", "lib"],
        "/repo",
      ),
    ).toEqual({
      command: "snapshot",
      ref: "main",
      output: ".calldiff",
      paths: ["src", "lib"],
      cwd: "/repo",
      help: false,
    });
  });

  test("keeps snapshot as a valid legacy diff ref", () => {
    expect(parseArgs(["snapshot"], "/repo")).toMatchObject({
      command: "diff",
      from: "snapshot",
    });
  });

  test("allows snapshot-specific help without a ref", () => {
    expect(parseArgs(["--snapshot", "--help"], "/repo")).toMatchObject({
      command: "snapshot",
      ref: "HEAD",
      help: true,
    });
  });

  test("rejects positional arguments in snapshot mode", () => {
    expect(() =>
      parseArgs(["--snapshot", "main", "feature", "-o", "out"], "/repo"),
    ).toThrow("Unexpected snapshot argument: feature");
  });
});
