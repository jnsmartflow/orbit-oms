import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { canViewTripSheets } from "@/lib/trip-sheet/access";
import { getTripSheet } from "@/lib/trip-sheet/load";
import { getTripSheetShellProps } from "@/lib/trip-sheet/shell-context";
import { TripSheetScreen } from "@/components/trip-sheet/trip-sheet-screen";
import { parseTripSheetTab } from "@/lib/trip-sheet/tabs";

export const dynamic = "force-dynamic";

// /trip-sheets/[id] — one Orbit trip on the phone (2026-10-09). `id` = trips.id.
// The sheet is read here, on the server, and handed down — the Share button
// captures it from memory. ?date= and ?type= are only where Back returns to.
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#F5F3FF" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TripSheetDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { date?: string; type?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewTripSheets(roles))) redirect("/unauthorized");

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sheet = await getTripSheet(id);
  if (!sheet) notFound();

  const backDate = searchParams.date && DATE_RE.test(searchParams.date) ? searchParams.date : sheet.header.tripDate;
  const shell = await getTripSheetShellProps(session.user);

  return (
    <RoleSidebarProvider>
      <TripSheetScreen
        sheet={sheet}
        backHref={`/trip-sheets?date=${backDate}&type=${parseTripSheetTab(searchParams.type)}`}
        {...shell}
      />
    </RoleSidebarProvider>
  );
}
