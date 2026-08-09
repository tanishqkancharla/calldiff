import { describe, expect, test } from "vitest";
import { callstackShow } from "./helpers.js";

describe("callstack show", () => {
  test("renders a plain call tree without +/- markers", () => {
    const actual = callstackShow(
      `
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
      "PiService.createAgentSession",
    );

    expect(actual).toBe(
      [
        "PiService.createAgentSession(options)",
        "├─ PiService.getServices()",
        "│  ├─ SettingsManager.create()",
        "│  ├─ AuthStorage.create()",
        "│  ├─ new ModelRegistry()",
        "│  └─ createCodingTools()",
        "├─ services.boot()",
        "├─ if (!options.sessionId)",
        "   └─ SessionManager.create()",
        "└─ else",
        "   └─ SessionManager.open(_id)",
      ].join("\n"),
    );
  });

  test("respects maxDepth", () => {
    const actual = callstackShow(
      `
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
      "outer",
      { maxDepth: 1 },
    );

    expect(actual).toBe(["outer()", "└─ mid()"].join("\n"));
  });
});
