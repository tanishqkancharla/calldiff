import { test } from "./expectCallstack.js";

test("javascriptreact: tracks JSX components as nested calls", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "App",
    { file: "app.jsx" },
  ).toEqual(`
      App()
      ├─ setup()
    - ├─ Layout(props)
    - │  └─ Header()
    + └─ Shell(props)
    +    ├─ Header()
    +    └─ Sidebar()
  `);
});

test("javascriptreact: labels hook dependency arrays", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export function Ticker({ speed }) {
    -   useEffect(() => {
    -     start(speed);
    -   }, []);
    +   useEffect(() => {
    +     start(speed);
    +   }, [speed]);
        return <Display />;
      }
      function start(_s) {}
      function Display() { return null; }
    `,
    "Ticker",
    { file: "ticker.jsx" },
  ).toEqual(`
      Ticker({})
    - ├─ useEffect([])
    + ├─ useEffect([speed])
      └─ Display()
  `);
});

test("javascriptreact: skips lowercase HTML tags, nests components", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
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
    `,
    "Page",
    { file: "page.jsx" },
  ).toEqual(`
      Page()
    - ├─ Title()
    + └─ Heading()
  `);
});
