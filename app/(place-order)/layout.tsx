import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission } from "@/lib/permissions";

// Place Order layout — full-bleed, no sidebar.
//
// Distinct from the standard role-layout used by /mail-orders, /support, etc.
// because /place-order needs every pixel for the photo-grid + cart panel
// (planning doc §2.3). Auth + role gate here; the page itself renders its own
// page-specific topbar in later phases.

export const dynamic = "force-dynamic";

export default async function PlaceOrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "place_order", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  return <div className="min-h-screen bg-[#f9fafb]">{children}</div>;
}
