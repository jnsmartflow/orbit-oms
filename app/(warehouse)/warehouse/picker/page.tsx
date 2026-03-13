import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { SignOutButton } from "@/components/shared/sign-out-button";

export default async function PickerPage() {
  const session = await auth();
  requireRole(session, [ROLES.PICKER]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Picker</h1>
      <p className="text-muted-foreground">Signed in as {session!.user.name} · {session!.user.role}</p>
      <SignOutButton />
    </main>
  );
}
