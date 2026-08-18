import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("javascriptreact: tracks JSX components as nested calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/app.jsx": src`
       export function App() {
         setup();
         return (
           <Layout>
             <Header />
           </Layout>
         );
       }
       function setup() {}
       function Layout(props) { return null; }
       function Header() { return null; }
    `,
  });
  const to = host.commit("after", {
    "/app.jsx": src`
       export function App() {
         setup();
         return (
           <Shell>
             <Header />
             <Sidebar />
           </Shell>
         );
       }
       function setup() {}
       function Shell(props) { return null; }
       function Header() { return null; }
       function Sidebar() { return null; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e App`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  const host = workspace();
  const from = host.commit("before", {
    "/page.jsx": src`
       export function Page() {
         return (
           <div>
             <Title />
             <span>ok</span>
           </div>
         );
       }
       function Title() { return null; }
    `,
  });
  const to = host.commit("after", {
    "/page.jsx": src`
       export function Page() {
         return (
           <div>
             <Heading />
             <span>ok</span>
           </div>
         );
       }
       function Heading() { return null; }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Page`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Page()
    - ├─ Title()
    + └─ Heading()
  `));
});
