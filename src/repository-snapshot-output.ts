import {
  lstatSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { RepositoryCallSnapshot } from "./repository-snapshot.js";
import { renderRepositoryCallSnapshotHtml } from "./repository-snapshot-html.js";

export const REPOSITORY_SNAPSHOT_JSON = "calldiff-call-snapshot.json";
export const REPOSITORY_SNAPSHOT_HTML = "calldiff-call-snapshot.html";

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Create one immutable bundle containing canonical JSON and derived HTML.
 * Directory creation is the exclusive claim, so an old snapshot cannot be
 * replaced. A failed synchronous write removes the incomplete new directory.
 */
export function writeRepositoryCallSnapshotBundle(
  snapshot: RepositoryCallSnapshot,
  outputDirectory: string,
): { jsonPath: string; htmlPath: string } {
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  const html = renderRepositoryCallSnapshotHtml(
    snapshot,
    REPOSITORY_SNAPSHOT_JSON,
  );
  mkdirSync(dirname(outputDirectory), { recursive: true });
  if (pathExists(outputDirectory)) {
    throw new Error(`Snapshot output already exists: ${outputDirectory}`);
  }

  try {
    mkdirSync(outputDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Snapshot output already exists: ${outputDirectory}`);
    }
    throw error;
  }

  try {
    writeFileSync(join(outputDirectory, REPOSITORY_SNAPSHOT_JSON), json, {
      flag: "wx",
    });
    writeFileSync(join(outputDirectory, REPOSITORY_SNAPSHOT_HTML), html, {
      flag: "wx",
    });
  } catch (error) {
    rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    jsonPath: join(outputDirectory, REPOSITORY_SNAPSHOT_JSON),
    htmlPath: join(outputDirectory, REPOSITORY_SNAPSHOT_HTML),
  };
}
