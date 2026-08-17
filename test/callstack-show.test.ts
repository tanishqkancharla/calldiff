import { outdent } from "outdent";
import { describe, expect, test } from "vitest";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

describe("callstack tree", () => {
  test("renders a plain call tree without +/- markers", () => {
    const host = workspace({
      "/file.ts": src`
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

        class AuthStorage {
          static create() {}
        }

        class ModelRegistry {
          constructor() {}
        }

        class SessionManager {
          static create() {}
          static open(_id: string) {}
        }

        class SettingsManager {
          static create() {}
        }

        function createCodingTools() {}
      `,
    });

    const result = host.run("calldiff tree -e PiService.createAgentSession");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(src`
      PiService.createAgentSession(options)
      ├─ PiService.getServices()
      │  ├─ SettingsManager.create()
      │  ├─ AuthStorage.create()
      │  ├─ new ModelRegistry()
      │  └─ createCodingTools()
      ├─ services.boot()
      ├─ if (!options.sessionId)
         └─ SessionManager.create()
      └─ else
         └─ SessionManager.open(_id)
    `.trimEnd());
  });

  test("respects maxDepth", () => {
    const host = workspace({
      "/file.ts": src`
        export function outer() {
          mid();
        }
        function mid() {
          inner();
        }
        function inner() {
          leaf();
        }
        function leaf() {}
      `,
    });

    const result = host.run("calldiff tree -e outer --max-depth 1");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(src`
      outer()
      └─ mid()
    `.trimEnd());
  });
});
