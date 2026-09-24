// lib/ci/live-ci.ts
//
// "Does this bill carry a LIVE CI?" — ONE definition for every guard that must
// refuse to send a CI'd bill back toward the floor (design
// web-update-2026-09-24-billing-mo-actions.md §3.7):
//   • Floor Release        — lib/floor/release.ts (releaseBillsToFloor)
//   • Floor unhold         — app/api/floor/actions/route.ts ("unhold")
//   • Picking cancel       — app/api/picking/cancel/route.ts
//   (Floor Restore has refused a live CI since 2026-09-22 with its own read —
//   app/api/floor/actions/route.ts "restore" — and keeps its own wording.)
//
// LIVE = not voided and not a draft, any source. A draft is an in-flight write,
// invisible everywhere (CLAUDE_CI.md §2).
//
// 🔴 FULL RETURNS ONLY (returnType 'full'). A FULL CI says the goods never leave
// the depot — a Floor Raise CI, a billing / Telephonic bill-only CI, a manual
// full return — so the bill must not go back toward a picker. A PART CI
// (returnType 'part' — every auto_finding CI, and a manual part return) says
// SOME lines come back and the REST SHIPS: guarding on it would leave a held
// part-CI bill with no way to be released at all. Widening this to every CI is
// the one-line change of dropping `returnType` below — do it only with a
// release path for part-CI bills in hand.
//
// Server-only (Prisma). Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";

export interface LiveCi {
  id: number;
  ciNumber: string | null;
}

/** The earliest live FULL CI on the bill, or null. */
export async function findLiveCi(orderId: number): Promise<LiveCi | null> {
  return prisma.ci_returns.findFirst({
    where: { orderId, isVoided: false, status: { not: "draft" }, returnType: "full" },
    orderBy: { id: "asc" },
    select: { id: true, ciNumber: true },
  });
}

/** "This bill has CI-2026-00112 — it cannot be released here." */
export function liveCiRefusal(ci: LiveCi, verb: "released" | "cancelled"): string {
  return `This bill has ${ci.ciNumber ?? `CI #${ci.id}`} — it cannot be ${verb} here.`;
}
