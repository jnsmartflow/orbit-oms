// lib/mrn/delivery.ts
//
// 🔴 THE ONE OWNER OF "what delivery numbers does this MRN have".
//
// PURE. No Prisma, no React, no I/O — importable from a route handler, a server
// component and a client component alike, which is the point: billing's facts
// row, the XLS export, the A4 sheet and the rail search all answer this question
// and must answer it identically.
//
// ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
//
// `mrn.deliveryNo` — the HEADER column — is LEGACY as of 2026-09-01. One STI can
// carry several delivery numbers, so the number moved onto `mrn_lines`. The
// header column is deliberately NOT dropped: it holds real history for the
// thirteen MRNs raised before the split, and the step-2 backfill copied each of
// those values down onto its own lines, so nothing was lost either way.
//
// ⚠ BUT IT NO LONGER HAS A WRITER. create/route.ts and header/route.ts both
// stopped writing it in this change. Anything still READING `mrn.deliveryNo` is
// reading a frozen field that will be NULL on every MRN raised from now on —
// which on the A4 sheet means a blank delivery number on a document that goes
// to a supplier. If you find a surface reading it, that surface is stale; point
// it here instead.

/**
 * The distinct delivery numbers on a set of lines, in the order the lines
 * arrive (which is deliveryNo ASC — lib/mrn/queries.ts orders every line read
 * that way, so this is stable and needs no sort of its own).
 *
 * ⚠ '' IS EXCLUDED. It is a real stored value — 32 live lines carry it, from
 * three MRNs that had no header delivery number to backfill from — but it is
 * the ABSENCE of a delivery number, not one of them. Counting it would make a
 * single-delivery truck with a couple of unnamed lines report "2 deliveries".
 */
export function deliveryNumbers(lines: readonly { deliveryNo: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    if (l.deliveryNo === "" || seen.has(l.deliveryNo)) continue;
    seen.add(l.deliveryNo);
    out.push(l.deliveryNo);
  }
  return out;
}

/**
 * The delivery number(s) as ONE display string, or null when there are none.
 *
 *   []                       → null          (the caller renders its own dash)
 *   ["9109203426"]           → "9109203426"
 *   ["A", "B"]               → "A, B"
 *   ["A", "B", "C"]          → "3 deliveries"
 *
 * 🔴 NULL MEANS "no delivery number", AND EVERY CALLER MUST RENDER ITS OWN
 * PLACEHOLDER. The facts row and the report header already print an em-dash for
 * an absent value and must keep doing it — returning "—" from here would put a
 * presentation choice in a pure module and hand the XLS a literal dash where it
 * wants an empty cell.
 *
 * ⚠ THREE OR MORE COLLAPSES TO A COUNT, and that is a deliberate trade. The
 * facts row is one cell in an eight-across grid and the A4 header block is one
 * cell of four; a truck with five delivery numbers would push either out of
 * shape. If the printed sheet ever needs every number spelled out, that is a
 * second function and a second cell — do not widen this one and change all four
 * surfaces at once.
 */
export function formatDeliveryNos(lines: readonly { deliveryNo: string }[]): string | null {
  const nos = deliveryNumbers(lines);
  if (nos.length === 0) return null;
  if (nos.length <= 2) return nos.join(", ");
  return `${nos.length} deliveries`;
}

/**
 * Does any of these lines carry `query`, matched loosely? Backs billing's rail
 * search.
 *
 * ⚠ THE RAIL SEARCHES THE LINES, NOT THE HEADER, SINCE 2026-09-01. Searching
 * `mrn.deliveryNo` would find only the thirteen historical MRNs and silently
 * fail on every truck raised since — a search box that quietly stops working is
 * worse than one that never did.
 */
export function matchesDeliveryNo(
  lines: readonly { deliveryNo: string }[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return false;
  return deliveryNumbers(lines).some((d) => d.toLowerCase().includes(q));
}
