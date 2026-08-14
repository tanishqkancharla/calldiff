import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { sourcesFromFileDiff } from "./file-diff.js";
import { cliBody, workspace } from "./workspace.js";

test("javascriptreact: tracks JSX components as nested calls", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function App() {
        setup();
        return (
    -     <Layout>
    -       <Header />
    -     </Layout>
    +     <Shell>
    +       <Header />
    +       <Sidebar />
    +     </Shell>
        );
      }
      function setup() {}
    - function Layout(props) { return null; }
    + function Shell(props) { return null; }
      function Header() { return null; }
    + function Sidebar() { return null; }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/app.jsx": before });
  const to = host.commit("after", { "/app.jsx": after });

  const result = host.run(`calldiff diff ${from} ${to} -e App`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      App()
      ├─ setup()
    - ├─ Layout(props)
    - │  └─ Header()
    + └─ Shell(props)
    +    ├─ Header()
    +    └─ Sidebar()
  `));
});

test("javascriptreact: skips lowercase HTML tags, nests components", () => {
  const { before, after } = sourcesFromFileDiff(
    diffOutdent(`
      export function Page() {
        return (
          <div>
    -       <Title />
    +       <Heading />
            <span>ok</span>
          </div>
        );
      }
    - function Title() { return null; }
    + function Heading() { return null; }
    `),
  );

  const host = workspace();
  const from = host.commit("before", { "/page.jsx": before });
  const to = host.commit("after", { "/page.jsx": after });

  const result = host.run(`calldiff diff ${from} ${to} -e Page`);

  expect(result.code).toBe(0);
  expect(cliBody(result.stdout)).toBe(diffOutdent(`
      Page()
    - ├─ Title()
    + └─ Heading()
  `));
});
