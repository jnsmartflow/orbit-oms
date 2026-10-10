import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTodayIST } from "@/lib/dates";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { canViewTripSheets } from "@/lib/trip-sheet/access";
import { getTripSheetShellProps } from "@/lib/trip-sheet/shell-context";
import { TripSheetsList } from "@/components/trip-sheet/trip-sheets-list";
import { parseTripSheetTab } from "@/lib/trip-sheet/tabs";

export const dynamic = "force-dynamic";

// /trip-sheets — the phone list of a day's Orbit trips (2026-10-09).
// ⚠ NOT /trips (the NTS mirror). No layout.tsx in this folder — see
// lib/trip-sheet/shell-context.ts.
//
// Pale masthead → dark status-bar glyphs, the same override /picking, /ci,
// /mrn and /trips carry (CLAUDE_UI §59.8). themeColor goes on the VIEWPORT export.
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#F5F3FF" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TripSheetsPage({ searchParams }: { searchParams: { date?: string; type?: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewTripSheets(roles))) redirect("/unauthorized");

  const date = searchParams.date && DATE_RE.test(searchParams.date) ? searchParams.date : getTodayIST();
  const shell = await getTripSheetShellProps(session.user);

  return (
    <RoleSidebarProvider>
      <TripSheetsList initialDate={date} initialTab={parseTripSheetTab(searchParams.type)} {...shell} />
    </RoleSidebarProvider>
  );
}
