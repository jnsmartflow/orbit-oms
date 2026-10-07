// lib/dispatch/legacy-slot.ts
//
// THE LEGACY TIME-OF-DAY SLOT — orders.dispatchSlot + slotId + originalSlotId — from
// an IST "HH:mm" clock. ONE owner (Challan orders slice 6, 2026-10-07, plan §E): the
// OBD import (app/api/import/obd/route.ts resolveSlot) and the challan-order create
// (lib/challan-orders/create.ts) both call this. Moved VERBATIM from route.ts, so
// every caller is byte-identical to before. Pure.
//
// Not the dispatch ENGINE (lib/dispatch/dispatch-engine.ts) — that one decides the
// dispatch window. This is the older Morning / Afternoon / Evening / Night label.

export function resolveLegacySlot(
  emailTime: string | null,
): { dispatchSlot: string; slotId: number } {
  // Simple time-based slot assignment — mirrors Mail Orders' receivedAt logic.
  // Fallback to Night (id=4) if emailTime is missing.
  if (!emailTime)                 return { dispatchSlot: "Night",     slotId: 4 };
  if (emailTime < "10:30")        return { dispatchSlot: "Morning",   slotId: 1 };
  if (emailTime < "12:30")        return { dispatchSlot: "Afternoon", slotId: 2 };
  if (emailTime < "15:30")        return { dispatchSlot: "Evening",   slotId: 3 };
  return { dispatchSlot: "Night", slotId: 4 };
}
