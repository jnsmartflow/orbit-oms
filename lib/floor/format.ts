// Floor Control — display formatting helpers. Pure string work: no React, no
// browser API, no DB. Deliberately NOT a "use client" file so it can be imported
// from either a server or a client component.
//
// Moved here from components/support/shared/table-cells.tsx (verbatim) as step 1
// of the Support retirement — Floor is the only remaining consumer.

// ── Article pack-word abbreviation ───────────────────────────────────────────
// articleTag is a comma-separated "{integer} {word}" list written at import
// (e.g. "16 Drum, 14 Carton"). Abbreviates known words for display only —
// never touches the stored value. Any group that fails to parse as
// "{integer} {word}" bails the whole string back to the raw original,
// verbatim, rather than partially formatting it.
export const ARTICLE_WORD_ABBR: Record<string, string> = { Drum: "D", Carton: "C", Tin: "T", Bag: "B" };

export function formatArticleTag(raw: string): string {
  const groups = raw.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
  if (groups.length === 0) return raw;
  const parts: string[] = [];
  for (const g of groups) {
    const m = g.match(/^(\d+)\s+(\S.*)$/);
    if (!m) return raw;
    const [, num, word] = m;
    const short = ARTICLE_WORD_ABBR[word];
    parts.push(short ? `${num} ${short}` : `${num} ${word}`);
  }
  return parts.join(" · ");
}

// ── Rail/board display date — which clock to show, email or SAP ────────────
//
// orders.orderDateTime gets permanently overwritten to the customer's email-
// arrival time once a mail-order match happens (applyMailOrderEnrichment,
// app/api/import/obd/route.ts) — unconditionally, no comparison against the
// real SAP punch time (orders.obdEmailDate). See
// docs/prompts/drafts/code-discovery-2026-08-06-floor-order-time-source.md.
//
// The detail panel (step 1, app/api/floor/order/[orderId]/route.ts) was fixed
// to always show the SAP time, no conditional — Smart Flow's call for that
// single-value surface. The rail cards and the Floor board table are
// higher-density surfaces where a same-day email time is still useful context
// (e.g. "this bill was actually ordered at 15:22, not 05:30") — so here the
// two clocks are compared and the more informative one is shown, with a
// marker for which one it is.
//
// Reuses CLAUDE_IMPORT.md §12.2's exact day-comparison idiom (en-CA +
// Asia/Kolkata) — no new date library, no new timezone logic.
export interface FloorDisplayDate {
  obdDateTime: Date | null;
  isEmailTime: boolean;
}

function istDayOf(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Which timestamp Floor's rail/board should show for a bill, and whether it
 * is the email-arrival clock (as opposed to SAP's own punch clock).
 *
 * - Neither present → nothing to show.
 * - Only one present → show it; nothing to compare, so never flagged as the
 *   email clock (there is no SAP clock here to be more informative than).
 * - Both present and EQUAL (the normal SAP-only order — the two columns were
 *   never split apart by a mail match) → show obdEmailDate, not flagged.
 * - Both present and DIFFER → compare IST calendar day. Same day → the email
 *   time is a same-day refinement of the SAP time, show it and flag it.
 *   Different day → the bill was blocked/released later than it was emailed;
 *   the SAP time is what actually happened, show that instead.
 */
export function resolveFloorDisplayDate(
  orderDateTime: Date | null,
  obdEmailDate: Date | null,
): FloorDisplayDate {
  if (orderDateTime === null && obdEmailDate === null) {
    return { obdDateTime: null, isEmailTime: false };
  }
  if (orderDateTime === null) {
    return { obdDateTime: obdEmailDate, isEmailTime: false };
  }
  if (obdEmailDate === null) {
    return { obdDateTime: orderDateTime, isEmailTime: false };
  }
  if (orderDateTime.getTime() === obdEmailDate.getTime()) {
    return { obdDateTime: obdEmailDate, isEmailTime: false };
  }
  if (istDayOf(orderDateTime) === istDayOf(obdEmailDate)) {
    return { obdDateTime: orderDateTime, isEmailTime: true };
  }
  return { obdDateTime: obdEmailDate, isEmailTime: false };
}
