import { test } from "./expectCallstack.js";

test("typescriptreact: tracks JSX components as calls", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export function App() {
        setup();
    +   track();
        return <Button onClick={handle} />;
      }
      function setup() {}
    + function track() {}
      function handle() {
        click();
      }
      function click() {}
      function Button(_props: { onClick(): void }) {
        return null;
      }
    `,
    "App",
    { file: "app.tsx" },
  ).toEqual(`
      App()
      ├─ setup()
    + ├─ track()
      └─ Button(_props)
  `);
});

test("typescriptreact: diffs React component trees", ({ expectCallstack }) => {
  expectCallstack(
    `
      export function UserProfile({ userId }: { userId: string }) {
        const user = useUser(userId);
        if (!user) {
    -     return <Spinner />;
    +     return <Skeleton />;
        }
        return (
    -     <Card>
    -       <Avatar src={user.avatar} />
    -       <FollowButton userId={userId} />
    -     </Card>
    +     <ProfileLayout>
    +       <Avatar src={user.avatar} />
    +       <UserMeta user={user} />
    +       <FollowButton userId={userId} />
    +     </ProfileLayout>
        );
      }

      function useUser(_id: string) {
        return null as null | { avatar: string; name: string };
      }
    - function Spinner() {
    -   return null;
    - }
    + function Skeleton() {
    +   return null;
    + }
    - function Card(_props: { children?: unknown }) {
    -   return null;
    - }
    + function ProfileLayout(_props: { children?: unknown }) {
    +   return null;
    + }
      function Avatar(_props: { src: string }) {
        return null;
      }
    + function UserMeta(_props: { user: { name: string } }) {
    +   return null;
    + }
      function FollowButton(_props: { userId: string }) {
        trackFollow();
        return null;
      }
      function trackFollow() {}
    `,
    "UserProfile",
    { file: "UserProfile.tsx" },
  ).toEqual(`
      UserProfile({})
      ├─ useUser(_id)
      ├─ if (!user)
    -    ├─ Spinner()
    +    └─ Skeleton()
    - ├─ Card(_props)
    - │  ├─ Avatar(_props)
    - │  └─ FollowButton(_props)
    - │     └─ trackFollow()
    + └─ ProfileLayout(_props)
    +    ├─ Avatar(_props)
    +    ├─ UserMeta(_props)
    +    └─ FollowButton(_props)
    +       └─ trackFollow()
  `);
});

test("typescriptreact: labels hook dependency arrays", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export function Profile({ userId }: { userId: string }) {
        const [user, setUser] = useState(null);
        useEffect(() => {
          setUser(userId);
        }, [userId]);
        const label = useMemo(() => String(user), [user]);
    +   const onSelect = useCallback(() => select(userId), [userId, select]);
        useEffect(() => {
          log(label);
        });
        return <Badge title={label} />;
      }
      function Badge(_props: { title: string }) {
        return null;
      }
    `,
    "Profile",
    { file: "Profile.tsx" },
  ).toEqual(`
      Profile({})
      ├─ useState()
      ├─ useEffect([userId])
      ├─ useMemo([user])
    + ├─ useCallback([userId, select])
      ├─ useEffect()
      └─ Badge(_props)
  `);
});

test("typescriptreact: dep-array changes surface in the diff", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export function Search({ query, page }: { query: string; page: number }) {
    -   useEffect(() => {
    -     fetchResults(query);
    -   }, [query]);
    +   useEffect(() => {
    +     fetchResults(query, page);
    +   }, [query, page]);
        return <Results />;
      }
      function fetchResults(_q: string, _p?: number) {}
      function Results() {
        return null;
      }
    `,
    "Search",
    { file: "Search.tsx" },
  ).toEqual(`
      Search({})
    - ├─ useEffect([query])
    + ├─ useEffect([query, page])
      └─ Results()
  `);
});

test("typescript: labels hook deps in custom hook files", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export function useThing(id: string) {
        const value = useMemo(() => compute(id), [id]);
        useEffect(() => {
          subscribe(id);
    -   }, []);
    +   }, [id]);
        return value;
      }
      function compute(_id: string) {
        return 1;
      }
    `,
    "useThing",
    { file: "useThing.ts" },
  ).toEqual(`
      useThing(id)
      ├─ useMemo([id])
    - ├─ useEffect([])
    + └─ useEffect([id])
  `);
});

test("typescriptreact: recursive JSX keeps nested call-site children", ({
  expectCallstack,
}) => {
  expectCallstack(
    `
      export function Foo() {
        return (
          <Foo>
    -       <Bar />
    +       <Bar />
    +       <Baz />
          </Foo>
        );
      }
      function Bar() {
        return null;
      }
    + function Baz() {
    +   return null;
    + }
    `,
    "Foo",
    { file: "Foo.tsx" },
  ).toEqual(`
      Foo()
      └─ Foo() ⇄
         ├─ Bar()
    +    └─ Baz()
  `);
});
