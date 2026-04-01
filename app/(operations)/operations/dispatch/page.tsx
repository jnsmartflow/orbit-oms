import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PlanningPage } from "@/components/planning/planning-page";

export default async function Page() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!["operations", "admin"].includes(session.user.role ?? "")) redirect("/unauthorized");
  return <PlanningPage />;
}
