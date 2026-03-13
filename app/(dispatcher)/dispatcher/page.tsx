import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { SignOutButton } from "@/components/shared/sign-out-button";

export const dynamic = 'force-dynamic';

export default async function DispatcherPage() {
  const session = await auth();
  requireRole(session, [ROLES.DISPATCHER]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Dispatcher Dashboard</h1>
      <p className="text-muted-foreground">Signed in as {session!.user.name} · {session!.user.role}</p>
      <SignOutButton />
    </main>
  );
}
