import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTripSheet } from "@/lib/trip-sheet/load";
import { OrbitTripSheetDocument } from "@/components/trip-sheet/trip-sheet-document";
import { OrbitTripSheetPrintButton } from "@/components/trip-sheet/print-button";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /trip-sheets/[id]/sheet — the A4 ORBIT trip sheet for one Floor trip
// (2026-10-09). `id` = trips.id. Read-only: getTripSheet (lib/trip-sheet/load.ts)
// does SELECTs only.
//
// 🔴 NOT /trips/[tripNo]/sheet — that is the NTS mirror (CLAUDE_FLOOR_TRIPS §2).
// 🔴 NO layout.tsx in app/trip-sheets/ — a layout would wrap this print page in
//    the sidebar and mobile shell (the cascade CLAUDE_TRIP_REPORT §8 warns
//    about). A future phone list at /trip-sheets must mount its shell inline in
//    its own page.tsx, the way app/trips/page.tsx does.
//
// Access: `trip_sheet` canView OR `floor` canView (per-user ticks, CORE §5).
// ─────────────────────────────────────────────────────────────────────────────

function Message({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-[13px] text-gray-500">
      <p>{text}</p>
      <Link href="/floor" className="text-brand-700 hover:underline">
        &larr; Back to Floor
      </Link>
    </div>
  );
}

export default async function OrbitTripSheetPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  const allowed =
    (await checkAnyPermission(roles, "trip_sheet", "canView")) ||
    (await checkAnyPermission(roles, "floor", "canView"));
  if (!allowed) return <Message text="You do not have access to trip sheets." />;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const sheet = await getTripSheet(id);
  if (!sheet) notFound();
  if (sheet.header.isHand) return <Message text={`${sheet.header.tripNumber} is a Hand trip — no trip sheet.`} />;

  return (
    <div className="min-h-screen bg-[#e5e7eb] py-6">
      {/* Screen-only toolbar — outside #orbit-trip-sheet-print-area, so print hides it. */}
      <div className="max-w-[800px] mx-auto mb-3 flex items-center gap-2 px-4">
        <Link href="/floor" className="text-[12px] text-brand-700 hover:underline">
          &larr; Back to Floor
        </Link>
        <div className="flex-1" />
        <OrbitTripSheetPrintButton />
      </div>
      <OrbitTripSheetDocument sheet={sheet} printAreaId="orbit-trip-sheet-print-area" />
    </div>
  );
}
