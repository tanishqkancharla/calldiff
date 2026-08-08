/**
 * Side-by-side oxc vs tree-sitter extractor parity probes.
 * These go beyond the main suite to surface real behavioral gaps.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIndex as buildIndexOxc,
  extractFunctions as extractOxc,
} from "../src/extract-oxc.js";
import {
  buildIndex as buildIndexTs,
  extractFunctions as extractTs,
} from "../src/extract.js";
import { buildCallTree } from "../src/calltree.js";
import { renderDiff } from "../src/render.js";
import { diffTrees } from "../src/diff.js";
import type { FunctionInfo } from "../src/types.js";

function summarize(fns: FunctionInfo[]) {
  return fns
    .map((fn) => ({
      key: fn.key,
      label: fn.label,
      exported: fn.exported,
      steps: JSON.stringify(fn.steps),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function assertSameExtraction(source: string, file = "sample.ts") {
  const oxc = summarize(extractOxc(file, source));
  const ts = summarize(extractTs(file, source));
  assert.deepEqual(ts, oxc);
}

function treeLabel(source: string, entry: string, which: "oxc" | "ts") {
  const extract = which === "oxc" ? extractOxc : extractTs;
  const buildIndex = which === "oxc" ? buildIndexOxc : buildIndexTs;
  const index = buildIndex(extract("sample.ts", source));
  return buildCallTree(entry, index, 12);
}

function assertSameTree(source: string, entry: string) {
  const oxc = treeLabel(source, entry, "oxc");
  const ts = treeLabel(source, entry, "ts");
  assert.deepEqual(ts, oxc);
}

test("parity: basic class + if/else (existing suite shape)", () => {
  assertSameExtraction(`
export class PiService {
  static createAgentSession(options: { sessionId?: string }) {
    AuthStorage.create();
    new ModelRegistry();
    if (!options.sessionId) {
      SessionManager.create();
    } else {
      SessionManager.open(options.sessionId);
    }
  }
}
class AuthStorage { static create() {} }
class ModelRegistry { constructor() {} }
class SessionManager {
  static create() {}
  static open(_id: string) {}
}
`);
});

test("parity: this.method resolution", () => {
  assertSameTree(
    `
export class Runner {
  start() {
    this.prepare();
    this.run();
  }
  prepare() {}
  run() {}
}
`,
    "Runner.start",
  );
});

test("parity: optional chaining calls", () => {
  assertSameTree(
    `
export function boot(svc?: { start(): void }) {
  svc?.start();
  foo?.bar();
}
`,
    "boot",
  );
});

test("parity: private methods and private field calls", () => {
  assertSameTree(
    `
export class Vault {
  open() {
    this.#unlock();
    this.read();
  }
  #unlock() {}
  read() {}
}
`,
    "Vault.open",
  );
});

test("parity: class field arrow functions", () => {
  assertSameTree(
    `
export class Runner {
  start() {
    this.helper();
  }
  helper = () => {
    work();
  };
}
function work() {}
`,
    "Runner.start",
  );
});

test("parity: constructor param properties + new alias", () => {
  assertSameExtraction(`
export class ModelRegistry {
  constructor(private name: string, public ready = false, ...rest: string[]) {
    init(this.name);
  }
}
function init(_n: string) {}
`);
});

test("parity: nested functions are not inlined into caller", () => {
  assertSameTree(
    `
export function outer() {
  function inner() {
    hidden();
  }
  const f = () => { alsoHidden(); };
  visible();
}
function hidden() {}
function alsoHidden() {}
function visible() {}
`,
    "outer",
  );
});

test("parity: destructuring and rest params labels", () => {
  assertSameExtraction(`
export function pack({ a }: { a: number }, [b]: number[], ...rest: string[]) {
  use(a, b, rest);
}
function use(..._args: unknown[]) {}
`);
});

test("parity: export default anonymous function", () => {
  assertSameExtraction(`
export default function () {
  boot();
}
function boot() {}
`);
});

test("parity: export default arrow", () => {
  assertSameExtraction(`
export default () => {
  boot();
};
function boot() {}
`);
});

test("parity: new on member expression", () => {
  assertSameTree(
    `
export function make() {
  new pkg.Thing();
  new Thing();
}
class Thing { constructor() {} }
`,
    "make",
  );
});

test("parity: else-if chain labels", () => {
  assertSameTree(
    `
export function handle(status: string) {
  if (status === "a") {
    doA();
  } else if (status === "b") {
    doB();
  } else {
    doOther();
  }
}
function doA() {}
function doB() {}
function doOther() {}
`,
    "handle",
  );
});

test("parity: non-exported class with public method", () => {
  assertSameExtraction(`
class Hidden {
  public visible() { a(); }
  private secret() { b(); }
  plain() { c(); }
}
function a() {}
function b() {}
function c() {}
`);
});

test("parity: computed member calls are ignored", () => {
  assertSameTree(
    `
export function run(obj: Record<string, Function>, key: string) {
  obj[key]();
  obj.known();
}
`,
    "run",
  );
});

test("diff output parity for a refactor fixture", () => {
  const before = `
export class PiService {
  static createAgentSession(options: { sessionId?: string }) {
    AuthStorage.create();
    new ModelRegistry();
    createCodingTools();
    if (!options.sessionId) {
      SessionManager.create();
    } else {
      SessionManager.open(options.sessionId);
    }
  }
}
class AuthStorage { static create() {} }
class ModelRegistry { constructor() {} }
class SessionManager {
  static create() {}
  static open(_id: string) {}
}
function createCodingTools() {}
`;
  const after = `
export class PiService {
  static createAgentSession(options: { sessionId?: string }) {
    const services = PiService.getServices();
    services.boot();
    if (!options.sessionId) {
      SessionManager.create();
    } else {
      SessionManager.open(options.sessionId);
    }
  }
  static getServices() {
    SettingsManager.create();
    AuthStorage.create();
    new ModelRegistry();
    createCodingTools();
    return { boot() {} };
  }
}
class AuthStorage { static create() {} }
class ModelRegistry { constructor() {} }
class SessionManager {
  static create() {}
  static open(_id: string) {}
}
class SettingsManager { static create() {} }
function createCodingTools() {}
`;

  const oxcDiff = renderDiff(
    diffTrees(
      buildCallTree(
        "PiService.createAgentSession",
        buildIndexOxc(extractOxc("b.ts", before)),
        12,
      ),
      buildCallTree(
        "PiService.createAgentSession",
        buildIndexOxc(extractOxc("a.ts", after)),
        12,
      ),
    ),
    { color: false },
  );
  const tsDiff = renderDiff(
    diffTrees(
      buildCallTree(
        "PiService.createAgentSession",
        buildIndexTs(extractTs("b.ts", before)),
        12,
      ),
      buildCallTree(
        "PiService.createAgentSession",
        buildIndexTs(extractTs("a.ts", after)),
        12,
      ),
    ),
    { color: false },
  );
  assert.equal(tsDiff, oxcDiff);
});
