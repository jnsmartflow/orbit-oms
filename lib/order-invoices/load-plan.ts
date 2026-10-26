// lib/order-invoices/load-plan.ts — SPLIT LOAD, the rules (phase 2, 2026-10-24,
// Schema v27.76). PURE: no Prisma, no clock, no React. Tests:
// lib/order-invoices/load-plan.test.ts (npx tsx --test lib/order-invoices/load-plan.test.ts).
// Design: docs/prompts/drafts/code-design-2026-10-24-split-load-writer.md §0, A, B, E.
//
// SPLIT LOAD = ONE SAP invoice row whose tins are divided across trucks. Each
// truck share is its own order_invoices row: the ROOT ('sap' or 'manual') keeps
// its id, seq, number, trip, hold, copies and re-deliveries; every other share
// is a 'load' row whose "loadParentId" is the root (flat — a part's parent is
// never a part; the composite FK keeps it on the same OBD). Model A holds: on a
// split OBD every row carries line rows, and Σ tins per raw line == unitQty.
//
//   · GROUP — a root plus its 'load' parts. "Part k of n" is its place by seq,
//     root first — DERIVED here (loadGroupsOf), never stored.
//   · WAITING — on no trip, not dispatched. Only a waiting part is split again
//     or merged; the root may be split while on a trip (truck 1 stays there).
//   · REMAINDER RULE — a row's tins = the active line's unitQty − Σ every OTHER
//     row's tins of that line. Merge and Repair both write it, which is why a
//     merge also absorbs a re-import's new quantities.
//
// This file plans; lib/order-invoices/load-split.ts reads and writes.

import { addInvoicesRefusal, detectStale, MAX_INVOICES, type ActiveLine } from "./rules";
import { INVOICE_SOURCE } from "./source";
import { ciCoversRow } from "./ci-plan";
import { coveringCopy, splitAtOf } from "./copy-plan";

export interface LoadLine {
  rawLineItemId: number;
  qty: number;
}

/** One order_invoices row as the plan reads it. */
export interface LoadRow {
  id: number;
  seq: number;
  source: string;
  loadParentId: number | null;
  invoiceNo: string | null;
  invoiceDate: Date | null;
  tripDropId: number | null;
  /** The stop's trip id / number — null when on no stop. */
  tripId?: number | null;
  tripNumber?: string | null;
  isHeld: boolean;
  heldAt: Date | null;
  heldById: number | null;
  isDispatched: boolean;
  createdAt?: Date;
  /** [] on an unsplit seq 1 = "all lines". */
  lines: LoadLine[];
  /** What points at the row ON DELETE RESTRICT — trip numbers. Omitted = none. */
  copyTrips?: string[];
  redeliveryTrips?: string[];
  /** EVERY ci_returns row naming this row (void included) — the FK guard. */
  ciNumbers?: (string | null)[];
}

/** What one truck carries: tins per raw line (0 = not on this truck). */
export interface TruckInput {
  lines: LoadLine[];
}

export interface GroupPlace {
  rootId: number;
  k: number;
  n: number;
}

/** The ONE home of "which group, which part": every row → its root and k of n. */
export function loadGroupsOf(rows: ReadonlyArray<Pick<LoadRow, "id" | "seq" | "loadParentId">>): Map<number, GroupPlace> {
  const byRoot = new Map<number, Array<Pick<LoadRow, "id" | "seq" | "loadParentId">>>();
  for (const r of rows) {
    const rootId = r.loadParentId ?? r.id;
    const arr = byRoot.get(rootId) ?? [];
    arr.push(r);
    byRoot.set(rootId, arr);
  }
  const out = new Map<number, GroupPlace>();
  Array.from(byRoot.entries()).forEach(([rootId, members]) => {
    // Root first, then by seq (a root's seq is always below its parts', but the
    // sort does not rely on it).
    const sorted = members.slice().sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : a.seq - b.seq));
    sorted.forEach((r, i) => out.set(r.id, { rootId, k: i + 1, n: sorted.length }));
  });
  return out;
}

/**
 * THE ONE FORMATTER of a part's place: "part 2" (k only) or "part 2 of 3".
 * Every screen and message that names a part goes through it (with
 * loadGroupsOf for k / n) — never a retyped "part" string.
 */
export function loadPartText(k: number, n?: number): string {
  return n === undefined ? `part ${k}` : `part ${k} of ${n}`;
}

/** The same formatter for several parts: "part 2" (one) or "parts 2, 3". */
export function loadPartsText(ks: readonly number[]): string {
  return ks.length === 1 ? loadPartText(ks[0]) : `parts ${ks.join(", ")}`;
}

/** No CI on a single truck part (owner decision 2026-10-26 — raise a whole-bill
 *  CI from the CI page). Lives in ci-plan.ts (the server refuses it too);
 *  re-exported here for the Floor board. */
export { SPLIT_BILL_CI_PAGE } from "./ci-plan";

/**
 * WHICH ROWS A MERGE PRESS SENDS (owner answer 1, 2026-10-24): ONE ticked row
 * → every WAITING row of its load group with the SAME hold (the root
 * included), so the press merges what can merge into the oldest; TWO OR MORE
 * ticked → exactly those. [] when the ticked row is not in a load group.
 * planLoadMerge / loadMergeRefusal then say whether the server will accept it.
 */
export function mergeRowIdsOf(
  rows: ReadonlyArray<Pick<LoadRow, "id" | "seq" | "loadParentId" | "tripDropId" | "isDispatched" | "isHeld">>,
  tickedIds: readonly number[],
): number[] {
  const ticked = Array.from(new Set(tickedIds));
  if (ticked.length >= 2) return ticked;
  const row = rows.find((r) => r.id === ticked[0]);
  if (!row) return [];
  const groups = loadGroupsOf(rows);
  const rootId = groups.get(row.id)!.rootId;
  if (groups.get(row.id)!.n < 2) return [];
  return rows
    .filter((r) => groups.get(r.id)!.rootId === rootId && r.tripDropId === null && !r.isDispatched && r.isHeld === row.isHeld)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => r.id);
}

/** "Merge parts 2, 3 back into part 1?" — the confirm question for a planned
 *  merge, worded from the group's own k (loadGroupsOf). */
export function mergeQuestionOf(rows: readonly LoadRow[], plan: { survivorId: number; deleteIds: readonly number[] }): string {
  const groups = loadGroupsOf(rows);
  const ks = plan.deleteIds.map((id) => groups.get(id)!.k).sort((a, b) => a - b);
  return `Merge ${loadPartsText(ks)} back into ${loadPartText(groups.get(plan.survivorId)!.k)}?`;
}

/** The row's group root: its parent when it is a part, else itself. */
export function rootOf<R extends Pick<LoadRow, "id" | "loadParentId">>(rows: readonly R[], row: R): R {
  if (row.loadParentId === null) return row;
  return rows.find((r) => r.id === row.loadParentId) ?? row;
}

/** True when the OBD is Model A's UNSPLIT shape: one row, seq 1, no lines. */
export function isUnsplit(rows: readonly LoadRow[]): boolean {
  return rows.length === 1 && rows[0].seq === 1 && rows[0].lines.length === 0;
}

/** A split OBD with a row that has no lines — a press that died half-way. */
export function isHalfWritten(rows: ReadonlyArray<Pick<LoadRow, "lines">>): boolean {
  const split = rows.length > 1 || rows.some((r) => r.lines.length > 0);
  return split && rows.some((r) => r.lines.length === 0);
}

/**
 * The row's tins per raw line: its lines — or, on an UNSPLIT seq 1 (no lines),
 * every active line's unitQty (lines with 0 tins left out). A lineless row of a
 * split OBD carries nothing (half-written).
 */
export function tinsOfRow(row: LoadRow, all: readonly LoadRow[], active: readonly ActiveLine[]): Map<number, number> {
  const out = new Map<number, number>();
  if (row.lines.length > 0) {
    for (const l of row.lines) out.set(l.rawLineItemId, (out.get(l.rawLineItemId) ?? 0) + l.qty);
    return out;
  }
  if (isUnsplit(all) && all[0].id === row.id) {
    for (const a of active) if (a.unitQty > 0) out.set(a.rawLineItemId, a.unitQty);
  }
  return out;
}

function lineName(l: Pick<ActiveLine, "lineId" | "skuCodeRaw">): string {
  return `line ${l.lineId} (${l.skuCodeRaw})`;
}

/** Lines sorted by raw line, qty > 0 only. */
function cleanLines(lines: readonly LoadLine[]): LoadLine[] {
  return lines.filter((l) => l.qty > 0).slice().sort((a, b) => a.rawLineItemId - b.rawLineItemId);
}

function tinsTotal(lines: readonly LoadLine[]): number {
  return lines.reduce((s, l) => s + l.qty, 0);
}

/**
 * THE REMAINDER RULE: per active line, unitQty − Σ the `others` rows' tins of
 * it. Refused when another row already carries more than the bill has.
 */
export function remainderLines(
  active: readonly ActiveLine[],
  others: readonly LoadRow[],
): { ok: true; lines: LoadLine[] } | { ok: false; errors: string[] } {
  const taken = new Map<number, number>();
  for (const r of others) for (const l of r.lines) taken.set(l.rawLineItemId, (taken.get(l.rawLineItemId) ?? 0) + l.qty);
  const errors: string[] = [];
  const lines: LoadLine[] = [];
  for (const a of active) {
    if (a.unitQty <= 0) continue;
    const rem = a.unitQty - (taken.get(a.rawLineItemId) ?? 0);
    if (rem < 0) errors.push(`${lineName(a)}: the other trucks carry ${a.unitQty - rem} tins but the bill has only ${a.unitQty}`);
    else if (rem > 0) lines.push({ rawLineItemId: a.rawLineItemId, qty: rem });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, lines };
}

/**
 * The concurrency token (design E.2): every row's id, seq, stop, hold,
 * dispatched and lines. GET hands it out, a press sends it back; different →
 * someone moved / held / re-split the bill since it was opened. Not updatedAt:
 * a lines-only change never touches order_invoices."updatedAt".
 */
export function rowsKey(rows: readonly LoadRow[]): string {
  return rows
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((r) => {
      const lines = r.lines
        .slice()
        .sort((a, b) => a.rawLineItemId - b.rawLineItemId)
        .map((l) => `${l.rawLineItemId}x${l.qty}`)
        .join(",");
      return `${r.id}:${r.seq}:${r.tripDropId ?? "-"}:${r.isHeld ? 1 : 0}:${r.isDispatched ? 1 : 0}:${lines}`;
    })
    .join("|");
}

/** "I536230716" — the group's paper, or its place before SAP stamps a number. */
export function paperLabel(root: Pick<LoadRow, "seq" | "invoiceNo">, obdNumber: string): string {
  return root.invoiceNo ?? `Invoice ${root.seq} of ${obdNumber}`;
}

/** "I536230716 part 2 of 3" — a part's name in a refusal. */
export function partLabel<R extends Pick<LoadRow, "id" | "seq" | "loadParentId" | "invoiceNo">>(rows: readonly R[], row: R, obdNumber: string): string {
  const place = loadGroupsOf(rows).get(row.id);
  const name = paperLabel(rootOf(rows, row), obdNumber);
  return place && place.n > 1 ? `${name} ${loadPartText(place.k, place.n)}` : name;
}

// ── SPLIT ────────────────────────────────────────────────────────────────────

export interface LoadSplitPlan {
  sourceRowId: number;
  /** Truck 1's share — what the SOURCE row keeps. qty > 0 only. */
  sourceLines: LoadLine[];
  creates: Array<{
    seq: number;
    /** The ROOT's id (flat group). */
    loadParentId: number;
    /** Copied from the ROOT (NULL stays NULL — SAP not billed yet). */
    invoiceNo: string | null;
    invoiceDate: Date | null;
    /** Copied from the SOURCE row (case 3). */
    isHeld: boolean;
    heldAt: Date | null;
    heldById: number | null;
    lines: LoadLine[];
  }>;
  /** true = the source had no lines (unsplit seq 1) — it GAINS line rows. */
  sourceGainsLines: boolean;
}

/**
 * Plan dividing `sourceRowId` across `trucks` (trucks[0] = what the source
 * keeps). Every error, in plain English; nothing is written by this.
 */
export function planLoadSplit(input: {
  rows: readonly LoadRow[];
  sourceRowId: number;
  trucks: readonly TruckInput[];
  active: readonly ActiveLine[];
  /** orders."dispatchStatus" = 'hold' — the hold truth of an UNSPLIT bill (E.6). */
  obdHeld: boolean;
}): { ok: true; plan: LoadSplitPlan } | { ok: false; errors: string[] } {
  const { rows, trucks, active } = input;
  const source = rows.find((r) => r.id === input.sourceRowId);
  if (!source) return { ok: false, errors: [`Invoice row ${input.sourceRowId} is not an invoice of this bill`] };
  const errors: string[] = [];

  // 1. Not dispatched; a part only while waiting.
  if (source.isDispatched) errors.push("This invoice is dispatched — it cannot be split");
  if (source.source === INVOICE_SOURCE.LOAD && source.tripDropId !== null) {
    errors.push(`This part is on ${source.tripNumber ?? "a trip"} — only a part on no trip can be split again`);
  }
  // 2. At least two trucks; the existing fuse on rows per bill.
  if (trucks.length < 2) errors.push("A split needs at least 2 trucks");
  if (rows.length + trucks.length - 1 > MAX_INVOICES) errors.push(`At most ${MAX_INVOICES} invoices and parts on one bill`);
  if (errors.length > 0) return { ok: false, errors };

  const activeById = new Map(active.map((a) => [a.rawLineItemId, a]));
  const tins = tinsOfRow(source, rows, active);
  // 7. A source line no longer active in SAP — the stale guard catches it first.
  if (Array.from(tins.keys()).some((id) => !activeById.has(id))) {
    return { ok: false, errors: ["Lines changed in SAP — re-check first"] };
  }
  const total = Array.from(tins.values()).reduce((s, q) => s + q, 0);
  if (total < 2) return { ok: false, errors: ["This invoice has fewer than 2 tins — there is nothing to split"] };

  // 3-4. Lines of this row, once per truck, whole numbers ≥ 0.
  const placed = new Map<number, number>();
  trucks.forEach((t, i) => {
    const label = `Truck ${i + 1}`;
    const seen = new Set<number>();
    for (const l of t.lines) {
      const line = activeById.get(l.rawLineItemId);
      if (!tins.has(l.rawLineItemId) || !line) {
        errors.push(`${label}: item ${l.rawLineItemId} is not a line of this invoice`);
        continue;
      }
      if (seen.has(l.rawLineItemId)) {
        errors.push(`${label}: ${lineName(line)} is listed twice`);
        continue;
      }
      seen.add(l.rawLineItemId);
      if (!Number.isInteger(l.qty) || l.qty < 0) {
        errors.push(`${label}: ${lineName(line)} needs a whole number of tins, 0 or more`);
        continue;
      }
      placed.set(l.rawLineItemId, (placed.get(l.rawLineItemId) ?? 0) + l.qty);
    }
    // 6. Every truck carries something (case 11).
    if (tinsTotal(t.lines.filter((l) => Number.isInteger(l.qty) && l.qty > 0)) < 1) errors.push(`${label} has no tins`);
  });
  // 5. Sums exact per raw line.
  Array.from(tins.entries()).forEach(([id, want]) => {
    const line = activeById.get(id)!;
    const got = placed.get(id) ?? 0;
    if (got < want) errors.push(`${lineName(line)}: ${want - got} of ${want} tins not placed`);
    else if (got > want) errors.push(`${lineName(line)}: ${got} tins placed but this invoice has only ${want}`);
  });
  if (errors.length > 0) return { ok: false, errors };

  const root = rootOf(rows, source);
  const unsplit = isUnsplit(rows);
  // Case 3: parts copy the source's hold. An unsplit bill's truth is orders (E.6).
  const isHeld = unsplit ? input.obdHeld : source.isHeld;
  const maxSeq = rows.reduce((m, r) => Math.max(m, r.seq), 0);
  return {
    ok: true,
    plan: {
      sourceRowId: source.id,
      sourceLines: cleanLines(trucks[0].lines),
      creates: trucks.slice(1).map((t, i) => ({
        seq: maxSeq + 1 + i,
        loadParentId: root.id,
        invoiceNo: root.invoiceNo,
        invoiceDate: root.invoiceDate,
        isHeld,
        heldAt: isHeld ? source.heldAt : null,
        heldById: isHeld ? source.heldById : null,
        lines: cleanLines(t.lines),
      })),
      sourceGainsLines: source.lines.length === 0,
    },
  };
}

// ── MERGE ────────────────────────────────────────────────────────────────────

export interface LoadMergePlan {
  survivorId: number;
  /** 'load' rows deleted (their lines CASCADE). */
  deleteIds: number[];
  /** The survivor's new lines; [] with backToUnsplit. */
  survivorLines: LoadLine[];
  /** After the merge the OBD is one row at seq 1 → Model A's "no lines". */
  backToUnsplit: boolean;
}

/** The RESTRICT guard on a row a merge would delete, in plain English, or []. */
function linkReasons(r: LoadRow): string[] {
  return [
    ...(r.copyTrips ?? []).map((t) => `billing copied it for trip ${t}`),
    ...(r.redeliveryTrips ?? []).map((t) => `it is re-delivered on trip ${t}`),
    ...(r.ciNumbers ?? []).map((n) => `it has ${n ?? "a CI draft"}`),
  ];
}

/** Why this row can never be merged AWAY (deleted), or null. */
export function mergeAwayRefusal(rows: readonly LoadRow[], r: LoadRow, obdNumber: string): string | null {
  if (r.source !== INVOICE_SOURCE.LOAD) return null; // a root is never deleted — it survives
  if (r.isDispatched) return `${partLabel(rows, r, obdNumber)} is dispatched`;
  if (r.tripDropId !== null) return `${partLabel(rows, r, obdNumber)} is on ${r.tripNumber ?? "a trip"} — remove it from the trip first`;
  const links = linkReasons(r);
  if (links.length > 0) return `${partLabel(rows, r, obdNumber)} cannot be merged — ${links.join(", ")}, and that record stays on it.`;
  return null;
}

/** Plan merging the chosen rows of ONE group back into one row. */
export function planLoadMerge(
  rows: readonly LoadRow[],
  rowIds: readonly number[],
  active: readonly ActiveLine[],
  obdNumber: string,
): { ok: true; plan: LoadMergePlan } | { ok: false; errors: string[] } {
  const ids = Array.from(new Set(rowIds));
  const chosen = rows.filter((r) => ids.includes(r.id));
  const foreign = ids.filter((id) => !rows.some((r) => r.id === id));
  if (foreign.length > 0) return { ok: false, errors: [`Invoice row ${foreign.join(", ")} is not an invoice of this bill`] };
  if (chosen.length < 2) return { ok: false, errors: ["Choose at least 2 parts to merge"] };

  const groups = loadGroupsOf(rows);
  const rootIds = new Set(chosen.map((r) => groups.get(r.id)!.rootId));
  if (rootIds.size > 1) return { ok: false, errors: ["Only parts of the SAME invoice can be merged"] };
  if (!chosen.some((r) => r.source === INVOICE_SOURCE.LOAD)) return { ok: false, errors: ["These are not parts of one invoice"] };

  const errors: string[] = [];
  for (const r of chosen) {
    if (r.isDispatched) errors.push(`${partLabel(rows, r, obdNumber)} is dispatched`);
    else if (r.tripDropId !== null) errors.push(`${partLabel(rows, r, obdNumber)} is on ${r.tripNumber ?? "a trip"} — remove it from the trip first`);
  }
  if (new Set(chosen.map((r) => r.isHeld)).size > 1) {
    errors.push("Some of these parts are on hold and some are not — hold or release them together first");
  }
  const rootId = Array.from(rootIds)[0];
  const survivor = chosen.find((r) => r.id === rootId) ?? chosen.slice().sort((a, b) => a.seq - b.seq)[0];
  const doomed = chosen.filter((r) => r.id !== survivor.id);
  for (const r of doomed) {
    const links = linkReasons(r);
    if (links.length > 0) errors.push(`${partLabel(rows, r, obdNumber)} cannot be merged — ${links.join(", ")}, and that record stays on it.`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const remaining = rows.filter((r) => !doomed.some((d) => d.id === r.id));
  if (remaining.length === 1 && remaining[0].seq === 1) {
    return { ok: true, plan: { survivorId: survivor.id, deleteIds: doomed.map((r) => r.id), survivorLines: [], backToUnsplit: true } };
  }
  const rem = remainderLines(active, remaining.filter((r) => r.id !== survivor.id));
  if (!rem.ok) return { ok: false, errors: rem.errors };
  if (tinsTotal(rem.lines) < 1) return { ok: false, errors: ["The merged part would carry no tins"] };
  return {
    ok: true,
    plan: { survivorId: survivor.id, deleteIds: doomed.map((r) => r.id), survivorLines: rem.lines, backToUnsplit: false },
  };
}

// ── REPAIR (E.8) ─────────────────────────────────────────────────────────────

export interface LoadRepairPlan {
  /** (a) 'load' rows with no lines, on no trip, not dispatched, nothing pointing at them. */
  deleteIds: number[];
  /** (b) the ONE lineless row left and its remainder; null = none. */
  fill: { rowId: number; lines: LoadLine[] } | null;
  /** E.6 — an unsplit bill whose seq-1 hold mirror disagrees with orders: the value to mirror. */
  mirrorHeld: boolean | null;
  changed: boolean;
}

/**
 * Repair the two shapes a dead press can leave (parts with no lines; the
 * source with no lines) and the unsplit hold mirror. Anything else → refused.
 */
export function planLoadRepair(
  rows: readonly LoadRow[],
  active: readonly ActiveLine[],
  obdHeld: boolean,
): { ok: true; plan: LoadRepairPlan } | { ok: false; errors: string[] } {
  const deletable = rows
    .filter(
      (r) =>
        r.source === INVOICE_SOURCE.LOAD &&
        r.lines.length === 0 &&
        r.tripDropId === null &&
        !r.isDispatched &&
        linkReasons(r).length === 0,
    )
    .sort((a, b) => a.seq - b.seq);
  // ⚠ A split-again of a PART that died after its step 3 leaves the SOURCE part
  // lineless too — indistinguishable from the new parts by shape. New parts
  // always take seqs ABOVE every existing row (planLoadSplit), so the lowest-seq
  // lineless part is the source: kept (and given the remainder) whenever the
  // lined rows do not already cover the bill and no other row is lineless.
  // (Found writing the tests 2026-10-24; the design's rule (a) alone deleted it.)
  let deleteIds = deletable.map((r) => r.id);
  const linelessOther = rows.filter((r) => r.lines.length === 0 && !deleteIds.includes(r.id));
  if (linelessOther.length === 0 && deletable.length > 0) {
    const rem = remainderLines(active, rows.filter((r) => r.lines.length > 0));
    if (!rem.ok) return { ok: false, errors: rem.errors };
    if (tinsTotal(rem.lines) > 0) deleteIds = deleteIds.slice(1);
  }
  const remaining = rows.filter((r) => !deleteIds.includes(r.id));
  let fill: LoadRepairPlan["fill"] = null;
  // (c) seq 1 alone = unsplit; its lines (if any) are Add invoices' to undo.
  if (remaining.length >= 2) {
    const lineless = remaining.filter((r) => r.lines.length === 0);
    if (lineless.length > 1) {
      return { ok: false, errors: [`${lineless.length} invoices of this bill have no lines — ask an admin`] };
    }
    if (lineless.length === 1) {
      const rem = remainderLines(active, remaining.filter((r) => r.id !== lineless[0].id));
      if (!rem.ok) return { ok: false, errors: rem.errors };
      if (tinsTotal(rem.lines) < 1) return { ok: false, errors: ["Nothing is left over for the row with no lines — ask an admin"] };
      fill = { rowId: lineless[0].id, lines: rem.lines };
    }
  }
  const unsplitAfter = remaining.length === 1 && remaining[0].seq === 1 && remaining[0].lines.length === 0;
  const mirrorHeld = unsplitAfter && !remaining[0].isDispatched && remaining[0].isHeld !== obdHeld ? obdHeld : null;
  return { ok: true, plan: { deleteIds, fill, mirrorHeld, changed: deleteIds.length > 0 || fill !== null || mirrorHeld !== null } };
}

// ── GUARDS (E) ───────────────────────────────────────────────────────────────

/** The bill facts the guards read. */
export interface LoadBill {
  obdNumber: string;
  isRemoved: boolean;
  workflowStage: string;
  dispatchStatus: string | null;
}

/** One ci_returns row of the OBD. */
export interface LoadCi {
  id: number;
  ciNumber: string | null;
  status: string;
  isVoided: boolean;
  orderInvoiceId: number | null;
}

/** One trip_bill_copies row of the OBD, newest first. */
export interface LoadCopy {
  tripId: number;
  orderInvoiceId: number;
  copiedAt: Date;
  tripNumber: string;
}

export interface LoadFacts {
  cis: readonly LoadCi[];
  copies: readonly LoadCopy[];
  /** The active Freight trip this bill is on, if any (E.11). */
  freightTripNumber: string | null;
  active: readonly ActiveLine[];
}

/** The stage refusals Add invoices uses, WITHOUT its SAP-number rule
 *  (decision 1: a split before billing is allowed). Reuses its words. */
const NUMBER_NOT_CHECKED = "split-load";

/** E.1 — the whole-bill refusal, or null. GET's blockedReason. */
export function loadBillRefusal(bill: LoadBill): string | null {
  return addInvoicesRefusal({ isRemoved: bill.isRemoved, workflowStage: bill.workflowStage, sapInvoiceNo: NUMBER_NOT_CHECKED });
}

export const LOAD_CHANGED = "This bill changed since you opened it — reopen Split load.";
export const LOAD_HALF_WRITTEN = "The last split did not finish — press Repair first.";
export const LOAD_STALE = "Lines changed in SAP — merge the waiting parts back to re-check, then split again.";
export const LOAD_HOLD_OUT_OF_STEP = "Hold record out of step — press Repair";
export const LOAD_SAME_MOMENT = "Someone changed this bill at the same moment — reopen Split load.";

/**
 * Why `row` cannot be split now (E.3–E.11 + A.2 rule 1), or null. The first
 * refusal wins; GET shows the same text per row as `canSplit`.
 */
export function loadSplitRefusal(bill: LoadBill, rows: readonly LoadRow[], row: LoadRow, facts: LoadFacts): string | null {
  const bills = loadBillRefusal(bill);
  if (bills !== null) return bills;
  // E.3 before E.4: send the person to the button that fixes it.
  if (isHalfWritten(rows)) return LOAD_HALF_WRITTEN;
  if (detectStale(facts.active.slice(), rows.flatMap((r) => r.lines))) return LOAD_STALE;
  if (row.isDispatched) return `${partLabel(rows, row, bill.obdNumber)} is dispatched — it cannot be split`;
  if (row.source === INVOICE_SOURCE.LOAD && row.tripDropId !== null) {
    return `${partLabel(rows, row, bill.obdNumber)} is on ${row.tripNumber ?? "a trip"} — only a part on no trip can be split again`;
  }
  // E.5 — a non-voided CI covering the row (its own, or a whole-OBD one), draft included.
  const ci = facts.cis.find((c) => !c.isVoided && ciCoversRow(c, row.id));
  if (ci) return `${paperLabel(rootOf(rows, row), bill.obdNumber)} has ${ci.ciNumber ?? "a CI draft"} — it cannot be split.`;
  // E.6 — an unsplit bill's hold truth is orders; its seq-1 mirror must agree.
  if (isUnsplit(rows) && rows[0].isHeld !== (bill.dispatchStatus === "hold")) return LOAD_HOLD_OUT_OF_STEP;
  // E.7 — a billing copy covering the row on the trip it is on now.
  if (row.tripDropId !== null && row.tripId !== undefined && row.tripId !== null) {
    const splitAt = splitAtOf(rows.map((r) => ({ seq: r.seq, createdAt: r.createdAt ?? new Date(0), source: r.source })));
    const copy = coveringCopy(facts.copies, row.id, splitAt, (tid) => tid === row.tripId);
    if (copy) {
      return `Billing already copied ${paperLabel(rootOf(rows, row), bill.obdNumber)} for ${copy.tripNumber} — split it before billing copies it, or ask billing to take the trip back.`;
    }
  }
  // E.11 — a Freight paper trip.
  if (facts.freightTripNumber !== null) return `On freight trip ${facts.freightTripNumber} — remove it there first`;
  const tins = Array.from(tinsOfRow(row, rows, facts.active).values()).reduce((s, q) => s + q, 0);
  if (tins < 2) return `${partLabel(rows, row, bill.obdNumber)} has fewer than 2 tins — there is nothing to split`;
  return null;
}

/**
 * Why these rows cannot be merged now (E.1, E.3, the CI rule), or null. Stale
 * is ALLOWED — a merge is its fix (owner Q9). The per-row rules are planLoadMerge's.
 */
export function loadMergeRefusal(bill: LoadBill, rows: readonly LoadRow[], rowIds: readonly number[], facts: LoadFacts): string | null {
  const bills = loadBillRefusal(bill);
  if (bills !== null) return bills;
  if (isHalfWritten(rows)) return LOAD_HALF_WRITTEN;
  // A live CI covering a chosen row holds that row's tins as picks: changing its
  // lines would leave the CI on tins the row no longer carries.
  for (const id of rowIds) {
    const row = rows.find((r) => r.id === id);
    const ci = facts.cis.find((c) => !c.isVoided && ciCoversRow(c, id));
    if (row && ci) return `${partLabel(rows, row, bill.obdNumber)} has ${ci.ciNumber ?? "a CI draft"} — it cannot be merged.`;
  }
  return null;
}
