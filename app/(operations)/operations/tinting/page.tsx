import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TintManagerContent } from "@/components/tint/tint-manager-content";

export default async function Page() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!["operations", "admin"].includes(session.user.role ?? "")) redirect("/unauthorized");
  return <TintManagerContent />;
}
