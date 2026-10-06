// ── Spreading ONE finding across a merged (batch-split) row (2026-10-06) ────
//
// SAP emits one line per batch/lot, and the detail screen merges those lines
// into one row (lib/picking/group-lines.ts). The floor counts the row, not the
// batches: the picker or supervisor types ONE "found" number against the
// MERGED total. pick_findings is UNIQUE on rawLineItemId — one row per raw
// line — so that one number has to be split back across the lines before it
// can be stored. This file is the one place that split is decided. Both write
// routes (app/api/picking/findings/report|confirm) import it, so the two can
// never allocate differently.
//
// PURE — no prisma import, no I/O, no dates — for the same reason
// group-lines.ts is: a route handler cannot be exercised without a session, and
// this repo's dev server points at production.
//
// THE RULE (owner decision, 2026-10-06): lines in `lineId` order, each takes
// min(remaining, its own qtyOrdered), remaining carries to the next. So a
// shortfall always lands on the LAST lines. Nobody knows which batch was short
// — the floor never counted per batch — so the rule is deterministic rather
// than "true"; what IS true is that the per-line rows sum to exactly the number
// typed, and no line is ever found-more-than-ordered.
//
// ⚠ ONE RULE FOR BOTH REASONS, ON PURPOSE. The single-line path stores the
// number TYPED as qtyFound on old_mfg exactly as on short_quantity (it does not
// force qtyOrdered), so mirroring it means filling old_mfg the same way. On the
// common old_mfg save — the whole row found, which is what the report popup
// prefills — the fill gives every line its own full qtyOrdered. lib/ci/auto.ts
// returns the whole line for old_mfg regardless of qtyFound, so the CI is the
// same either way.
//
// A single-line call is a pass-through: one line, found = the number typed.

/** A merged row is a handful of batch lines (the live worst case is 8); this
 *  bound only stops a malformed body from fanning out into hundreds of reads. */
export const MAX_LINES_PER_FINDING = 50;

export type LineIdsResult =
  | { ok: true; ids: number[] }
  | { ok: false; error: string };

/**
 * Normalise the two body shapes to ONE array, at the top of each route.
 *
 *   { rawLineItemId: 123 }               → [123]  (a single-line row — the
 *                                                  original shape, unchanged)
 *   { rawLineItemIds: [123, 124, ...] }  → those ids (a merged row's lineIds)
 *
 * When `rawLineItemIds` is present it wins; `rawLineItemId` is then ignored.
 * The single-id error text is the routes' original text, byte for byte.
 */
export function normaliseLineIds(body: {
  rawLineItemId?: unknown;
  rawLineItemIds?: unknown;
}): LineIdsResult {
  if (body.rawLineItemIds !== undefined) {
    const raw = body.rawLineItemIds;
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      raw.length > MAX_LINES_PER_FINDING ||
      !raw.every((v) => typeof v === "number" && Number.isInteger(v) && v > 0)
    ) {
      return {
        ok: false,
        error: `rawLineItemIds must be 1 to ${MAX_LINES_PER_FINDING} positive whole numbers`,
      };
    }
    const ids = raw as number[];
    if (new Set(ids).size !== ids.length) {
      return { ok: false, error: "rawLineItemIds must not repeat a line" };
    }
    return { ok: true, ids };
  }
  const one = body.rawLineItemId;
  if (typeof one !== "number" || !Number.isInteger(one) || one <= 0) {
    return { ok: false, error: "rawLineItemId is required" };
  }
  return { ok: true, ids: [one] };
}

/** The `import_raw_line_items` columns the allocation reads. */
export interface AllocatableLine {
  id: number;
  lineId: number;
  unitQty: number;
}

export interface AllocatedLine {
  id: number;
  qtyFound: number;
}

export type AllocationResult =
  | { ok: true; lines: AllocatedLine[] }
  | { ok: false; error: string };

/**
 * Split `qtyFound` across `lines`, sorted by `lineId` ascending (id breaks a
 * tie, so the order is total and repeatable).
 *
 * Rejects `qtyFound < 0` or `qtyFound > the summed qtyOrdered`. The over-total
 * message is worded exactly as the routes' old single-line message, so a
 * single-line caller sees the same text it always did.
 */
export function allocateFoundQty(
  lines: readonly AllocatableLine[],
  qtyFound: number,
): AllocationResult {
  if (lines.length === 0) {
    return { ok: false, error: "rawLineItemId is required" };
  }
  if (!Number.isInteger(qtyFound) || qtyFound < 0) {
    return { ok: false, error: "qtyFound must be a whole number of 0 or more" };
  }

  const sorted = [...lines].sort((a, b) => a.lineId - b.lineId || a.id - b.id);
  const total = sorted.reduce((sum, l) => sum + l.unitQty, 0);
  if (qtyFound > total) {
    return { ok: false, error: `qtyFound cannot exceed the ${total} ordered` };
  }

  let remaining = qtyFound;
  const out: AllocatedLine[] = [];
  for (const l of sorted) {
    const take = Math.min(remaining, l.unitQty);
    out.push({ id: l.id, qtyFound: take });
    remaining -= take;
  }
  return { ok: true, lines: out };
}
