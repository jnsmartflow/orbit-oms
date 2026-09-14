// lib/floor/trip-wording.ts
//
// What a trip's states are CALLED on screen. ONE fixed set of words.
//
// 🔴 THE GATE TEST IS GONE (2026-09-14). This module used to take `gateOn` and
// return two different word sets: "Release to floor" / "Released" with desk
// control ON, "Confirm plan" / "Confirmed" with it off. Both halves were true
// descriptions of their state, and that was the problem — the same trip changed
// its name on screen when somebody flipped a switch in the header, and the depot
// had to learn two vocabularies for one press. The OFF words won because they
// are what the press actually means: the load is settled, and the trip stops
// being a private note.
//
// 🔴 THE STORED VALUE IS 'released' AND MUST NOT BE RENAMED. `chk_trips_status`
// admits draft | released | dispatched | cancelled, and a new value needs a SQL
// ALTER before any code may write it (CORE §3's status-string rule). This module
// changes the LABEL, never the literal. The chip therefore reads "Confirmed"
// over a row whose status column says `released`, deliberately.
//
// 🔴 "Confirm plan" IS AN OWNER DECISION — DO NOT RENAME IT. The obvious move
// when dispatch marking rode on this press was "Confirm & mark dispatched", and
// it was considered and rejected: dispatch belongs to the loading screen, and
// naming a button after a side effect scheduled to be taken away teaches the
// depot a word with an expiry date. Release stopped dispatching on 2026-09-14,
// so the argument is now simply that the button confirms a plan and always did.
//
// ⚠ THE CAPTION IS GONE TOO. A quiet line under the button used to read "The
// floor can see these bills. Dispatch them as they are checked." It existed to
// qualify a button whose meaning depended on the switch. With one fixed set of
// words there is nothing left to qualify, and nothing replaces it.
//
// ⚠ PURE, AND NOW A CONSTANT IN ALL BUT NAME. Kept as a function so the three
// call sites do not each have to decide whether to import a value or call
// something, and so a future slice can reintroduce a parameter in one place if
// the loading screen ever needs its own vocabulary.

export interface TripWording {
  /** The button on a draft band. */
  releaseButton: string;
  /** The status chip once the trip has left draft. */
  releasedLabel: string;
}

export function tripWording(): TripWording {
  return {
    releaseButton: "Confirm plan",
    releasedLabel: "Confirmed",
  };
}
