import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission } from "@/lib/permissions";
import { PushTestClient } from "./push-test-client";

// Force runtime render so process.env is read per-request (the public VAPID key
// takes effect as soon as it is set in Vercel — no rebuild needed).
export const dynamic = "force-dynamic";

export default async function PushTestPage() {
  // Same gate as app/picking/page.tsx: auth + picking.canView, admin bypass.
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;

  return <PushTestClient vapidPublicKey={vapidPublicKey} />;
}
