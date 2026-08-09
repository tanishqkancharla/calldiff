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
