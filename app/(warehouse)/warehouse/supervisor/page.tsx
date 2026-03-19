import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission } from "@/lib/permissions";
import { SignOutButton } from "@/components/shared/sign-out-button";

export const dynamic = 'force-dynamic';

export default async function SupervisorPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") {
    const allowed = await checkPermission(session.user.role, "warehouse", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Floor Supervisor</h1>
      <p className="text-muted-foreground">Signed in as {session!.user.name} · {session!.user.role}</p>
      <SignOutButton />
    </main>
  );
}
