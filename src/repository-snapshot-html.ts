import type {
  RepositoryCallSnapshot,
  RepositoryCallStep,
  RepositoryDefinition,
} from "./repository-snapshot.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function walkSteps(
  steps: RepositoryCallStep[],
  visit: (step: RepositoryCallStep) => void,
): void {
  for (const step of steps) {
    visit(step);
    if (step.type === "branch") walkSteps(step.children, visit);
  }
}

/** Render the human projection of a canonical repository call snapshot. */
export function renderRepositoryCallSnapshotHtml(
  snapshot: RepositoryCallSnapshot,
  jsonFilename: string,
): string {
  const byId = new Map(
    snapshot.definitions.map((definition) => [definition.id, definition]),
  );
  const anchorById = new Map(
    snapshot.definitions.map((definition, index) => [
      definition.id,
      `definition-${String(index + 1).padStart(4, "0")}`,
    ]),
  );
  const definitionsByKey = new Map<string, RepositoryDefinition[]>();
  for (const definition of snapshot.definitions) {
    definitionsByKey.set(definition.key, [
      ...(definitionsByKey.get(definition.key) ?? []),
      definition,
    ]);
  }

  const renderCall = (
    step: Extract<RepositoryCallStep, { type: "call" }>,
  ): string => {
    const targets = step.matchingDefinitionIds
      .map((id) => byId.get(id))
      .filter((target): target is RepositoryDefinition => target !== undefined);
    const label = `${step.key}${step.key.includes("(") ? "" : "()"}`;
    let renderedLabel = `<span class="call-label">${escapeHtml(label)}</span>`;
    if (targets.length === 1) {
      renderedLabel = `<a class="call-label" href="#${anchorById.get(targets[0]!.id)}">${escapeHtml(label)}</a>`;
    }
    const targetLinks =
      targets.length > 1
        ? `<span class="targets">${targets
            .map(
              (target) =>
                `<a href="#${anchorById.get(target.id)}">${escapeHtml(`${target.file}:${target.span.startLine}`)}</a>`,
            )
            .join(" · ")}</span>`
        : "";
    return `<li class="step call-step ${step.match}"><div class="step-row">${renderedLabel}<span class="badge ${step.match}">${escapeHtml(step.match)}</span>${targetLinks}</div></li>`;
  };

  const renderSteps = (steps: RepositoryCallStep[]): string => {
    if (steps.length === 0) {
      return '<div class="empty">No extracted calls or branches.</div>';
    }
    return `<ul class="steps">${steps
      .map((step) => {
        if (step.type === "call") return renderCall(step);
        return `<li class="step branch-step"><details open><summary class="step-row"><span class="branch-label">${escapeHtml(step.label)}</span><span class="badge branch">branch</span><span class="count">${step.children.length}</span></summary>${renderSteps(step.children)}</details></li>`;
      })
      .join("")}</ul>`;
  };

  const searchableText = (definition: RepositoryDefinition): string => {
    const parts = [
      definition.file,
      definition.language,
      definition.key,
      definition.label,
    ];
    walkSteps(definition.steps, (step) => {
      parts.push(step.key);
      if (step.type === "branch") parts.push(step.label);
    });
    return parts.join(" ").toLowerCase();
  };

  const renderDefinition = (definition: RepositoryDefinition): string => {
    let calls = 0;
    walkSteps(definition.steps, (step) => {
      if (step.type === "call") calls += 1;
    });
    const collisionCount = definitionsByKey.get(definition.key)?.length ?? 1;
    const collision =
      collisionCount > 1
        ? `<span class="badge ambiguous">${collisionCount} definitions share this key</span>`
        : "";
    const anchor = anchorById.get(definition.id);
    return `<article class="definition" id="${anchor}" data-search="${escapeHtml(searchableText(definition))}"><details><summary class="definition-row"><span class="definition-label">${escapeHtml(definition.label)}</span>${definition.exported ? '<span class="badge exported">exported</span>' : ""}${collision}<span class="language">${escapeHtml(definition.language)}</span><span class="count">${calls} calls</span><span class="source">${escapeHtml(`${definition.file}:L${definition.span.startLine}–L${definition.span.endLine}`)}</span></summary><div class="definition-body">${renderSteps(definition.steps)}</div></details></article>`;
  };

  const recordsByFile = new Map<string, RepositoryDefinition[]>();
  for (const definition of snapshot.definitions) {
    recordsByFile.set(definition.file, [
      ...(recordsByFile.get(definition.file) ?? []),
      definition,
    ]);
  }
  const fileSections = [...recordsByFile.entries()]
    .map(
      ([file, definitions]) =>
        `<section class="file" data-file="${escapeHtml(file.toLowerCase())}"><details><summary class="file-row"><span>${escapeHtml(file)}</span><span class="count">${definitions.length} definitions</span></summary><div class="file-body">${definitions.map(renderDefinition).join("")}</div></details></section>`,
    )
    .join("");
  const diagnostics =
    snapshot.diagnostics.length === 0
      ? ""
      : `<details class="diagnostics"><summary>${snapshot.diagnostics.length} parse warnings</summary><ul>${snapshot.diagnostics.map((item) => `<li>${escapeHtml(item.file)}: ${escapeHtml(item.message)}</li>`).join("")}</ul></details>`;
  const summary = snapshot.summary;
  const sourceLabel =
    snapshot.source.kind === "commit"
      ? `commit ${snapshot.source.commit.slice(0, 12)}`
      : `subject ${snapshot.source.subjectId}`;
  const sourceDetails =
    snapshot.source.kind === "commit"
      ? [
          `requested ${snapshot.source.requestedRef}`,
          `scope ${snapshot.source.pathFilters.length > 0 ? snapshot.source.pathFilters.join(", ") : "all supported files"}`,
        ]
      : [`${snapshot.source.fileDigests.length} frozen files`];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>calldiff repository call snapshot</title>
<style>
:root { color-scheme:dark; --bg:#0d1117; --panel:#161b22; --panel2:#21262d; --text:#c9d1d9; --muted:#8b949e; --line:#30363d; --call:#79c0ff; --branch:#d2a8ff; --internal:#3fb950; --ambiguous:#d29922; --external:#8b949e; --exported:#56d4dd; }
* { box-sizing:border-box; }
html { scroll-padding-top:150px; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
a { color:inherit; }
header { position:sticky; top:0; z-index:3; padding:16px 24px; background:rgba(13,17,23,.96); border-bottom:1px solid var(--line); backdrop-filter:blur(8px); }
h1 { margin:0 0 7px; color:#f0f6fc; font-size:18px; }
.meta,.controls,.legend { display:flex; flex-wrap:wrap; gap:8px 16px; color:var(--muted); }
.controls { margin-top:11px; gap:8px; }
input { width:min(680px,100%); padding:8px 10px; color:var(--text); background:var(--panel); border:1px solid var(--line); border-radius:6px; font:inherit; }
button { padding:8px 10px; color:var(--text); background:var(--panel2); border:1px solid var(--line); border-radius:6px; font:inherit; cursor:pointer; }
main { max-width:1500px; padding:18px 24px 80px; }
.notice,.diagnostics { margin-bottom:14px; padding:10px 12px; color:var(--muted); background:var(--panel); border-left:3px solid var(--ambiguous); }
.legend { margin-bottom:14px; }
.file { margin:8px 0; border:1px solid var(--line); border-radius:7px; overflow:hidden; }
.file-row { padding:9px 12px; color:#f0f6fc; background:var(--panel); cursor:pointer; }
.file-body { padding:6px 10px 10px; }
.definition { margin:4px 0; border-left:2px solid var(--line); }
.definition:target { border-left-color:var(--call); background:rgba(121,192,255,.06); }
.definition-row { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; min-height:28px; padding:4px 8px; cursor:pointer; }
.definition-row:hover,.step-row:hover { background:var(--panel); }
.definition-label { color:#f0f6fc; }
.definition-body { padding:3px 0 8px 22px; }
.steps { list-style:none; margin:0; padding-left:18px; border-left:1px solid var(--line); }
.step { margin:2px 0; }
.step-row { display:flex; flex-wrap:wrap; align-items:baseline; gap:7px; min-height:24px; padding:2px 5px; border-radius:4px; }
.call-label { color:var(--call); text-decoration:none; }
a.call-label:hover,.machine-link:hover,.targets a:hover { text-decoration:underline; }
.branch-label { color:var(--branch); font-style:italic; }
.badge { padding:0 5px; border:1px solid currentColor; border-radius:999px; font-size:10px; opacity:.88; }
.badge.unique-key-match { color:var(--internal); }
.badge.multiple-key-matches,.badge.ambiguous { color:var(--ambiguous); }
.badge.no-key-match { color:var(--external); }
.badge.branch { color:var(--branch); }
.badge.exported { color:var(--exported); }
.count,.source,.targets,.empty,.language { color:var(--muted); font-size:12px; }
.targets { display:flex; flex-wrap:wrap; gap:5px; }
.hidden { display:none !important; }
summary::marker { color:var(--muted); }
@media (max-width:700px) { header,main { padding-left:12px; padding-right:12px; } .source { display:none; } }
</style>
</head>
<body>
<header>
  <h1>calldiff · repository call snapshot</h1>
  <div class="meta"><span>${escapeHtml(sourceLabel)}</span>${sourceDetails.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}<span>${summary.sourceFiles} files</span><span>${summary.definitions} definitions</span><span>${summary.calls} calls</span><span>${summary.branches} branches</span></div>
  <div class="controls"><input id="search" type="search" placeholder="Filter files, definitions, calls, or branches…"><button id="expand-files">Expand files</button><button id="expand-all">Expand all</button><button id="collapse-all">Collapse all</button></div>
</header>
<main>
  <div class="notice">This HTML file is a human projection. The adjacent <a class="machine-link" href="${escapeHtml(jsonFilename)}">JSON snapshot</a> is the canonical machine record. Key matching is syntactic and limited to selected files that parsed successfully. A no-key-match result does not prove that a call is external.</div>
  ${diagnostics}
  <div class="legend"><span style="color:var(--call)">call</span><span style="color:var(--branch)">branch</span><span style="color:var(--internal)">unique key match</span><span style="color:var(--ambiguous)">multiple key matches</span><span style="color:var(--external)">no key match</span></div>
  <div id="files">${fileSections}</div>
</main>
<script>
const search = document.querySelector('#search');
const files = [...document.querySelectorAll('.file')];
const definitions = [...document.querySelectorAll('.definition')];
search.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  if (!query) {
    files.forEach(file => file.classList.remove('hidden'));
    definitions.forEach(definition => definition.classList.remove('hidden'));
    return;
  }
  for (const file of files) {
    let matches = 0;
    for (const definition of file.querySelectorAll('.definition')) {
      const match = definition.dataset.search.includes(query);
      definition.classList.toggle('hidden', !match);
      if (match) matches += 1;
    }
    const fileMatch = file.dataset.file.includes(query);
    file.classList.toggle('hidden', matches === 0 && !fileMatch);
    if (matches > 0 || fileMatch) file.querySelector(':scope > details').open = true;
    if (fileMatch) file.querySelectorAll('.definition').forEach(definition => definition.classList.remove('hidden'));
  }
});
document.querySelector('#expand-files').addEventListener('click', () => files.forEach(file => file.querySelector(':scope > details').open = true));
document.querySelector('#expand-all').addEventListener('click', () => document.querySelectorAll('details').forEach(detail => detail.open = true));
document.querySelector('#collapse-all').addEventListener('click', () => document.querySelectorAll('details').forEach(detail => detail.open = false));
</script>
</body>
</html>`;
}
