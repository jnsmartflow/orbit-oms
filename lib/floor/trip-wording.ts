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
        // 🔴 "Confirm plan" IS DELIBERATELY UNCHANGED, AND THAT IS AN OWNER
        // DECISION (2026-09-13) — DO NOT RENAME IT.
        //
        // ⚠ THE REASON BELOW IS NOW HISTORY, AND THE CONCLUSION STILL HOLDS. The
        // press marked bills dispatched for one day (2026-09-13 → 09-14); it no
        // longer does, so the argument against renaming is simply that the
        // button confirms a plan and always did.
        // The obvious move was to rename this "Confirm & mark dispatched", and
        // it was considered and rejected: **the dispatch mark is temporary**. It
        // belongs to the loading screen, which is a few weeks out, and it lives
        // on this button only until that screen exists (see the header of
        // lib/floor/dispatch.ts). Naming a button after a side effect that is
        // scheduled to be taken away teaches the depot a word with an expiry
        // date, and the button's REAL job — confirming the plan — does not
        // change when loading arrives.
        //
        // The consequence is told where it is read instead: the caption below,
        // and the confirmation prompt at the moment of the click
        // (`releaseTrip`, components/floor/floor-page.tsx), which names the
        // real count and the skipped count.
        releaseButton: "Confirm plan",
        // ⚠ THE CHIP STAYS "Confirmed", DELIBERATELY. `chk_trips_status` has a
        // real `dispatched` value for TRIPS, which this trip does NOT have — it
        // is at `released`. Labelling it "Dispatched" would make one word mean
        // two different states on the same rail, and the trip has genuinely not
        // reached that status: its bills have gone, the trip row has not been
        // closed out.
        releasedLabel: "Confirmed",
        // ⚠ IT SAID "Checked bills are marked dispatched" UNTIL 2026-09-14, and
        // that stopped being true when release stopped dispatching. The press
        // now does one thing, and the line names the NEXT step rather than a
        // consequence of this one — dispatch is its own button on a released
        // trip (trip-detail-header.tsx), pressed through the day as bills are
        // checked.
        releaseCaveat:
          "The floor can see these bills. Dispatch them as they are checked.",
      };
}
