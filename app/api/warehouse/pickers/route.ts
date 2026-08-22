import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PICK_ASSIGNED } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

// ── The picker roster + how many OPEN bills each one is holding ────────────
// Consumed by the supervisor board's assign-to-picker sheet (and, before it
// was archived, by the desktop board). One question: who can I hand this to,
// and what is already on his plate right now.
//
// 🔴 REBUILT 2026-08-22. The count this route returned was wrong in two
// independent ways, and both are recorded here because both are the kind of
// thing that gets reintroduced by someone "restoring" a familiar shape.
//
// WRONG THING 1 — it counted the wrong BILLS. The filter was
// `status: { in: ["assigned", "picked"] }`, which reads like a state filter
// and filters NOTHING: the live CHECK constraint `chk_pick_assignments_status`
// already restricts that column to exactly those two values
// (CLAUDE_PICKING.md §7). So every assignment row matched, and the number
// behind a picker's name counted bills he had finished hours earlier.
//   ⚠ `status` CANNOT be repaired into the right test, so do not try:
//     • `approve` never writes it (app/api/picking/approve/route.ts stamps
//       checkedAt/checkedById only), so a signed-off bill's row reads
//       "picked" forever;
//     • it cannot see a CANCELLED or REMOVED order at all, because it
//       describes the assignment, not the bill.
//   The JOINED ORDER's stage is the only honest source, which is what this
//   now reads. No extra round trip: one query, the join lives in the WHERE.
//
// WRONG THING 2 — it counted the wrong DAY. The window was
// `new Date(new Date().toISOString().slice(0,10) + "T00:00:00")`, which takes
// the UTC calendar date and then parses an OFFSET-LESS string — read in the
// HOST's timezone per the ES spec (CORE §3's Date.parse landmine, whose
// reference fix is pickedAtMs() in lib/picking/picker-split.ts). On Vercel
// (UTC) that made the "today" window 05:30 IST today → 05:29 IST tomorrow.
//
// 🔴 THE DATE WINDOW IS GONE ENTIRELY, and that is the fix for #2 rather than
// a normalisation. An OPEN count has no business being date-fenced: a bill
// assigned yesterday and still unpicked is still in the man's hands this
// morning, and hiding it is how a supervisor double-loads someone. The
// picker's own Pending tab is deliberately not date-fenced either
// (CLAUDE_PICKING.md §5.4). With no day to compute, there is no day to get
// wrong — do not reintroduce one to "scope it to today".
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN, ROLES.OPERATIONS]);

  // Role + isActive, and deliberately nothing else — no shift, no attendance,
  // no depot. `assign/route.ts` re-validates the chosen pickerId with this
  // exact shape, so the two can never disagree about who is assignable.
  const pickerUsers = await prisma.users.findMany({
    where: {
      role: { name: "picker" },
      isActive: true,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Every OPEN assignment, no date fence. "Open" = the order is still sitting
  // at pick_assigned: the picker has it and has not marked it done. A
  // pick_done / pick_checked / cancelled / dispatched bill drops out on its
  // own, because the stage moved.
  //
  // PICK_ASSIGNED comes from the central ladder (lib/workflow-stages.ts §2) —
  // never a "pick_assigned" string literal here, so a renamed stage moves this
  // route with everything else.
  const openAssignments = await prisma.pick_assignments.findMany({
    where: {
      pickerId: { in: pickerUsers.map((u) => u.id) },
      order: {
        workflowStage: PICK_ASSIGNED,
        // The standing soft-delete rule for every orders read (CORE §3). A
        // removed order must not sit on a picker's count keeping him off the
        // free list — `status` could never express this, which is half the
        // reason it was the wrong column to filter on.
        isRemoved: false,
      },
    },
    // pickerId is all that is needed now that totalKg is gone; the order is
    // reached for the WHERE only, so nothing is selected through it.
    select: { pickerId: true },
  });

  // One number per picker: how many open bills he is holding.
  const openByPicker = new Map<number, number>();
  for (const a of openAssignments) {
    openByPicker.set(a.pickerId, (openByPicker.get(a.pickerId) ?? 0) + 1);
  }

  // ⚠ THREE FIELDS WERE REMOVED FROM THIS PAYLOAD on 2026-08-22:
  // `assignedCount`, `pickedCount` and `totalKg`. All three were computed off
  // the broken window above. `assignedCount` had exactly one reader (the
  // sheet's "N jobs" label, which now reads pendingCount); the other two had
  // NO readers anywhere in the repo. They are gone rather than merely
  // corrected because leaving a wrong-day number in an API for nobody to read
  // is how the next session inherits this bug. Re-add nothing here without a
  // consumer that needs it.
  const pickers = pickerUsers.map((u) => {
    const pendingCount = openByPicker.get(u.id) ?? 0;
    return {
      id: u.id,
      name: u.name,
      avatarInitial: u.name.charAt(0).toUpperCase(),
      status: (pendingCount > 0 ? "picking" : "available") as "picking" | "available",
      pendingCount,
    };
  });

  // Sort: picking first, then available; name-ascending within each group
  // (findMany already ordered by name, and a stable sort preserves it).
  pickers.sort((a, b) => {
    if (a.status !== b.status) return a.status === "picking" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ pickers });
}
