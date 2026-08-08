/**
 * Example React/TSX component used to demo calldiff on component trees.
 */
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

function useUser(_id: string): { avatar: string; name: string } | null {
  fetchUser(_id);
  return null;
}

function fetchUser(_id: string) {}

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
  trackFollow(_props.userId);
  return null;
}

function trackFollow(_userId: string) {}
