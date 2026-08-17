import { outdent } from "outdent";
import { expect, test } from "vitest";
import { diffOutdent } from "./diff-outdent.js";
import { workspace } from "./workspace.js";

const src = outdent({ trimTrailingNewline: false });

test("typescriptreact: tracks JSX components as calls", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/app.tsx": src`
       export function App() {
         setup();
         return <Button onClick={handle} />;
       }
       function setup() {}
       function handle() {
         click();
       }
       function click() {}
       function Button(_props: { onClick(): void }) {
         return null;
       }
    `,
  });
  const to = host.commit("after", {
    "/app.tsx": src`
       export function App() {
         setup();
         track();
         return <Button onClick={handle} />;
       }
       function setup() {}
       function track() {}
       function handle() {
         click();
       }
       function click() {}
       function Button(_props: { onClick(): void }) {
         return null;
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e App`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      App()
      ├─ setup()
    + ├─ track()
      └─ Button(_props)
  `));
});

test("typescriptreact: diffs React component trees", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/UserProfile.tsx": src`
       export function UserProfile({ userId }: { userId: string }) {
         const user = useUser(userId);
         if (!user) {
           return <Spinner />;
         }
         return (
           <Card>
             <Avatar src={user.avatar} />
             <FollowButton userId={userId} />
           </Card>
         );
       }
      
       function useUser(_id: string) {
         return null as null | { avatar: string; name: string };
       }
       function Spinner() {
         return null;
       }
       function Card(_props: { children?: unknown }) {
         return null;
       }
       function Avatar(_props: { src: string }) {
         return null;
       }
       function FollowButton(_props: { userId: string }) {
         trackFollow();
         return null;
       }
       function trackFollow() {}
    `,
  });
  const to = host.commit("after", {
    "/UserProfile.tsx": src`
       export function UserProfile({ userId }: { userId: string }) {
         const user = useUser(userId);
         if (!user) {
           return <Skeleton />;
         }
         return (
           <ProfileLayout>
             <Avatar src={user.avatar} />
             <UserMeta user={user} />
             <FollowButton userId={userId} />
           </ProfileLayout>
         );
       }
      
       function useUser(_id: string) {
         return null as null | { avatar: string; name: string };
       }
       function Skeleton() {
         return null;
       }
       function ProfileLayout(_props: { children?: unknown }) {
         return null;
       }
       function Avatar(_props: { src: string }) {
         return null;
       }
       function UserMeta(_props: { user: { name: string } }) {
         return null;
       }
       function FollowButton(_props: { userId: string }) {
         trackFollow();
         return null;
       }
       function trackFollow() {}
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e UserProfile`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
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
  `));
});

test("typescriptreact: recursive JSX keeps nested call-site children", () => {
  const host = workspace();
  const from = host.commit("before", {
    "/Foo.tsx": src`
       export function Foo() {
         return (
           <Foo>
             <Bar />
           </Foo>
         );
       }
       function Bar() {
         return null;
       }
    `,
  });
  const to = host.commit("after", {
    "/Foo.tsx": src`
       export function Foo() {
         return (
           <Foo>
             <Bar />
             <Baz />
           </Foo>
         );
       }
       function Bar() {
         return null;
       }
       function Baz() {
         return null;
       }
    `,
  });

  const result = host.run(`calldiff diff ${from} ${to} -e Foo`);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(diffOutdent(`
      Foo()
      └─ Foo() ⇄
         ├─ Bar()
    +    └─ Baz()
  `));
});
