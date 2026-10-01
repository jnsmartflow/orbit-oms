// lib/dispatch/windows.ts — the active dispatch windows, for every slot picker.
//
// Extracted from app/api/billing/dispatch-windows/route.ts (2026-10-01, Tint
// Manager tabs build step 2) so Billing's route and the Tint Manager's
// (app/api/tint/manager/dispatch-windows) read ONE query. Shape is the
// DispatchWindow the shared picker takes (components/floor/dispatch-slot-picker.tsx).
// Read-only, server-only.

import { prisma } from "@/lib/prisma";

export interface ActiveDispatchWindow {
  id: number;
  windowTime: string;
  label: string | null;
}

/** Active rows of dispatch_slot_master, in sortOrder. */
export async function getActiveDispatchWindows(): Promise<ActiveDispatchWindow[]> {
  return prisma.dispatch_slot_master.findMany({
    where: { isActive: true },
    select: { id: true, windowTime: true, label: true },
    orderBy: { sortOrder: "asc" },
  });
}
