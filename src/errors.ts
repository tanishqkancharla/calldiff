/** Thrown when an --entry / --to symbol cannot be resolved in the index. */
export class SymbolNotFoundError extends Error {
  readonly hint?: string;

  constructor(kind: "entrypoint" | "target", name: string, hint?: string) {
    const label = kind === "entrypoint" ? "Entrypoint" : "Target";
    super(`${label} not found: ${name}`);
    this.name = "SymbolNotFoundError";
    this.hint = hint;
  }
}
