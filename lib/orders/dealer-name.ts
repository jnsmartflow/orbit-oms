// lib/orders/dealer-name.ts
//
// The NAME a bill's dealer is shown under — Floor's copy of Picking's rule
// (lib/picking/queue.ts, the SAP-name fallback of 2026-08-31), owner decision
// 2026-09-29: master name, then the name SAP put on the bill, then the literal.
//
// ⚠ A COPY, NOT AN IMPORT. Picking's `nonBlank` is private to lib/picking/
// queue.ts and Floor is a CALLER of Picking (FLOOR §1) — it may not reach in and
// export it. The rule is three lines; this file is the one place Floor and the
// trip module spell it, so a fourth caller imports this rather than retyping.
//
// ⚠ A NAME NEVER SAYS WHETHER THE DEALER IS IN MASTER. An unmastered bill now
// prints a real SAP name, so `name === "(Unmatched)"` is no longer a test for
// anything — read `dealerInMaster` (the search's "unmatched" term does).
//
// PURE — no prisma, no clock.

/** The literal shown only when neither master nor SAP has a name. */
export const UNMATCHED_LABEL = "(Unmatched)";

/**
 * A name that is only whitespace is not a name. Returns the ORIGINAL value when
 * it survives (never the trimmed one), so a name that already rendered renders
 * byte-identically. Same contract as Picking's private helper.
 */
export function nonBlank(value: string | null | undefined): string | null {
  return value != null && value.trim() !== "" ? value : null;
}

/** Master name → SAP's ship-to name → "(Unmatched)". */
export function dealerDisplayName(
  masterName: string | null | undefined,
  sapShipToName: string | null | undefined,
): string {
  return nonBlank(masterName) ?? nonBlank(sapShipToName) ?? UNMATCHED_LABEL;
}
