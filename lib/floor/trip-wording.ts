// lib/floor/trip-wording.ts
//
// What a trip's second state is CALLED on screen, which depends on whether desk
// control is on.
//
// 🔴 THE STORED VALUE IS 'released' IN BOTH CASES AND MUST NOT BE RENAMED.
// `chk_trips_status` admits draft | released | loading | dispatched | cancelled,
// and a sixth value needs a SQL ALTER before any code may write it (CORE §3's
// status-string rule). This module changes the LABEL, never the literal.
//
// 🔴 WHY THE LABEL MOVES AT ALL. With desk control ON, pressing the button is a
// real handover: the trip's bills appear on the supervisor's Assign tab at that
// moment, and "Release to floor" describes exactly what happened. With it OFF
// the floor can already see every waiting bill — the visibility stamp is written
// but nothing filters on it — so "Release to floor" would promise an event that
// does not occur. The operator would press it, watch the floor not change, and
// stop trusting the button. "Confirm plan" is what the press actually means
// then: the load is settled, and the trip stops being a private note.
//
// ⚠ PURE. No React, no clock, no I/O — importable from a server module or a
// client component, and testable without either.

export interface TripWording {
  /** The button on a draft band. */
  releaseButton: string;
  /** The status chip once the trip has left draft. */
  releasedLabel: string;
  /**
   * The quiet line under the button when desk control is off — null when it is
   * on and the button needs no qualification.
   *
   * ⚠ IT SAYS WHAT IS TRUE, not what would be reassuring. The bills ARE already
   * visible; hiding that would let the operator believe he is gating work he is
   * not.
   */
  releaseCaveat: string | null;
}

export function tripWording(gateOn: boolean): TripWording {
  return gateOn
    ? {
        releaseButton: "Release to floor",
        releasedLabel: "Released",
        releaseCaveat: null,
      }
    : {
        releaseButton: "Confirm plan",
        releasedLabel: "Confirmed",
        releaseCaveat: "Desk control is off — the floor already sees these bills.",
      };
}
