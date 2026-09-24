// lib/billing/tag-reasons.ts
//
// The so_tag_matches.ciSkipReason vocabulary — "why the tag was not fully
// applied" — as ONE set of constants shared by the WRITER
// (lib/billing/telephonic-apply.ts, server) and the READER (the Telephonic
// tab's status pill, components/billing/billing-telephonic-tab.tsx, client).
//
// PURE: no Prisma, no React. It exists so the client never retypes a string the
// server writes (CORE §3: a status string is not an enum — import it).
//
// The CI-refusal reasons written by lib/ci/bill-only.ts ("CI already exists: …",
// "zero_qty: …", "A CI draft is open …", "failed: …") are free text and are NOT
// listed here: the tab shows any reason it does not recognise as
// "Couldn't raise — do by hand".

/** The hold write threw (hold tag, or path b's fallback hold). */
export const HOLD_FAILED = "hold failed";

/** Path (c): the CI was raised, the cancel's orders.update threw, the bill was held instead. */
export const CI_CANCEL_FAILED = "cancel failed";
/** Path (c): as above, and the fallback hold threw too — the bill may have gone to picking. */
export const CI_CANCEL_FAILED_HOLD_FAILED = "cancel failed; hold failed";
/** Path (c): the bill IS cancelled, but the assignment delete or the log write failed. */
export const CI_CANCEL_INCOMPLETE = "cancel incomplete";

/** The two "cancel failed" reasons — the tab shows both as "Cancel failed". */
export const CI_CANCEL_FAILED_REASONS: readonly string[] = [CI_CANCEL_FAILED, CI_CANCEL_FAILED_HOLD_FAILED];

/** Record-only reasons written by the planner with FIXED text. */
export const RECORD_ONLY_REASONS: readonly string[] = ["bill cancelled", "already dispatched", "bill removed"];

/** Record-only reasons from billingRefusal('ci', …) carry a trip number, so the
 *  reader matches their PREFIX (lib/billing/refusal.ts owns the wording). */
export const RECORD_ONLY_PREFIXES: readonly string[] = ["On trip ", "In the tint room"];

/** A deliberate "not applied" — shown grey, as the status itself. */
export function isRecordOnlyReason(reason: string | null): boolean {
  if (reason === null) return false;
  return RECORD_ONLY_REASONS.includes(reason) || RECORD_ONLY_PREFIXES.some((p) => reason.startsWith(p));
}
