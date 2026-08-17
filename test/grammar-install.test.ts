import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished, expect, test } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxCli = join(projectRoot, "node_modules/tsx/dist/cli.mjs");
const grammarsSrc = join(projectRoot, "src/languages/grammars.ts");

function loadInChild(npmPackage: string, cacheDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        tsxCli,
        "-e",
        `import { loadGrammarPackage } from ${JSON.stringify(grammarsSrc)};
loadGrammarPackage(${JSON.stringify(npmPackage)});
console.log("ok");`,
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, CALLDIFF_GRAMMAR_CACHE: cacheDir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && stdout.includes("ok")) {
        resolve();
        return;
      }
      reject(
        new Error(
          `loadGrammarPackage(${npmPackage}) exited ${code}: ${stderr || stdout}`,
        ),
      );
    });
  });
}

test("parallel processes install distinct grammars without a shared lock", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "calldiff-grammar-iso-"));
  onTestFinished(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  await Promise.all([
    loadInChild("tree-sitter-python", cacheDir),
    loadInChild("tree-sitter-ruby", cacheDir),
  ]);

  expect(
    existsSync(
      join(
        cacheDir,
        "packages",
        "tree-sitter-python",
        "node_modules",
        "tree-sitter-python",
      ),
    ),
  ).toBe(true);
  expect(
    existsSync(
      join(
        cacheDir,
        "packages",
        "tree-sitter-ruby",
        "node_modules",
        "tree-sitter-ruby",
      ),
    ),
  ).toBe(true);
}, 120_000);
