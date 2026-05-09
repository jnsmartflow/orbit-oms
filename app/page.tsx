import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROLE_REDIRECTS } from "@/lib/rbac";

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await auth();

  if (session?.user?.role) {
    redirect(ROLE_REDIRECTS[session.user.role] ?? "/unauthorized");
  }

  redirect("/login");
}
