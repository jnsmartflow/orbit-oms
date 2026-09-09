import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// The floor visibility gate — read-only helper.
//
// One row in `app_settings` decides whether the supervisor's Assign tab shows
// every waiting bill (the board as it has always been) or only the bills an
// operator has explicitly made visible (`orders.pickVisibleAt`).
//
// ⚠ DEFAULT-OFF, the OPPOSITE of lib/hide/tag-settings.ts, and the asymmetry is
// deliberate. A tag defaults ON because a missing row must not make a badge
// disappear. This defaults OFF because a missing row must not make the floor's
// WORK disappear: with the gate on and nothing marked visible, the Assign tab is
// empty and three supervisors are standing at a screen that shows no bills. The
// safe direction is always "show the supervisor his work", so every uncertain
// answer here resolves to false.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one `app_settings.settingKey` this module owns.
 *
 * Exported so no caller ever retypes the string. A hand-typed key in a `where`
 * matches nothing and fails SILENTLY — the gate would read as permanently off
 * and nobody would see an error (CORE §3, the status-string rule; same class).
 */
export const PICK_VISIBILITY_GATE_KEY = "picking.visibilityGate";

/**
 * Is the floor visibility gate switched ON?
 *
 * FAILS CLOSED TO FALSE, in all four ways it can fail:
 *   - no row for the key      → false (the ship state; nothing has been enabled)
 *   - row with isEnabled false → false
 *   - a null/undefined read    → false (the `=== true` test, not a truthy one)
 *   - the query itself throws  → false (caught below)
 *
 * The throw case matters: this runs on the marker's 15s poll and on every queue
 * fetch. A database blip must degrade to the ungated board the floor already
 * knows, never to an empty screen. Sequential await, no prisma.$transaction
 * (CORE §3).
 */
export async function isPickGateOn(): Promise<boolean> {
  try {
    const row = await prisma.app_settings.findUnique({
      where: { settingKey: PICK_VISIBILITY_GATE_KEY },
      select: { isEnabled: true },
    });
    return row?.isEnabled === true;
  } catch {
    return false;
  }
}
