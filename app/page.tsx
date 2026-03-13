import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = 'force-dynamic';

const ROLE_REDIRECTS: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/dispatcher",
  support: "/support",
  tint_manager: "/tint/manager",
  tint_operator: "/tint/operator",
  floor_supervisor: "/warehouse/supervisor",
  picker: "/warehouse/picker",
};

export default async function Home() {
  const session = await auth();

  if (session?.user?.role) {
    redirect(ROLE_REDIRECTS[session.user.role] ?? "/unauthorized");
  }

  redirect("/login");
}
