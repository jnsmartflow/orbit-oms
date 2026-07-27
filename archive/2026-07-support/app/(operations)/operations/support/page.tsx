import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SupportPageContent } from "@/components/support/support-page-content";

export default async function Page() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!["operations", "admin"].includes(session.user.role ?? "")) redirect("/unauthorized");
  return <SupportPageContent />;
}
