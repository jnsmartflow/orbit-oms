// lib/mrn/types.ts
//
// Wire shapes for the MRN module — the two board faces, one MRN's detail, its
// lines and their manufacturing batches.
//
// ⚠ EVERY DERIVED FIELD IS PART OF THE SHAPE ON PURPOSE. Short, Excess,
// hasIssue, ageDays and the per-MRN issue summary are computed ONCE, in
// lib/mrn/derive.ts, on the way out of lib/mrn/queries.ts — never again by a
// consumer. There are no shortQty / excessQty COLUMNS and none may be added
// (design §11 OQ-2); if a card, a table, an XLS writer and a print sheet each
// recomputed them, the four could disagree about the same truck, which is
// exactly the failure storing them was rejected to avoid.
//
// Pure types + two guards. No Prisma import, no I/O — safe from a client
// component and a route handler alike.

// ── Closed vocabularies ──────────────────────────────────────────────────────

/**
 * `mrn.status`. Backed by the live CHECK `chk_mrn_status`, which Prisma cannot
 * see. A fifth state is a SQL ALTER on that constraint FIRST — never just a
 * new literal here. Same class as chk_pick_assignments_status (CORE §7.4).
 *
 * The ladder is one-way and has no reopen:
 *
 *   open ──START──► checking ──END──► done ──OTR PUNCH──► closed
 *    │  (supervisor)          (supervisor)      (billing)
 *    └─ billing owns the row: header PATCH, lines PUT and delete all 409
 *       the moment status ≠ 'open'
 *
 * 🔴 'closed' WAS ADDED 2026-09-01 (v27.19) AND 'done' DID NOT CHANGE MEANING.
 * `done` still means "the supervisor has finished checking"; `closed` means
 * "billing has recorded the OTR number and the document is finished". The ten
 * MRNs that predate this stay `done` for ever and were deliberately not
 * migrated — they genuinely never had an OTR number.
 *
 * ⚠ THIS UNION MUST BE WIDENED BEFORE ANY ROW CAN HOLD THE NEW VALUE.
 * asMrnStatus() below THROWS on an unrecognised status, and it is called in
 * lib/mrn/queries.ts:251 for every board row and every detail read — so a live
 * 'closed' row with a three-value union here takes the rail, the detail pane
 * and both phone faces down at once. Order is: SQL, then this file, then the
 * gates (design §3.2).
 */
export type MrnStatus = "open" | "checking" | "done" | "closed";

export const MRN_STATUSES: readonly MrnStatus[] = ["open", "checking", "done", "closed"];

export function isMrnStatus(value: string): value is MrnStatus {
  return (MRN_STATUSES as readonly string[]).includes(value);
}

/**
 * Narrow a status read back from the DB.
 *
 * THROWS on an unrecognised value rather than defaulting. The column is CHECK-
 * constrained, so an unknown string can only mean the constraint was widened
 * without this file following — and a board that silently files that row under
 * "open" would hide the drift for weeks. Loud is correct here.
 */
export function asMrnStatus(value: string): MrnStatus {
  if (!isMrnStatus(value)) {
    throw new Error(
      `Unknown mrn.status "${value}" — chk_mrn_status was widened without updating lib/mrn/types.ts`,
    );
  }
  return value;
}

/**
 * `mrn.receivedFrom`. Backed by the live CHECK `chk_mrn_received_from`. A third
 * source depot is a SQL ALTER first — see MrnStatus above, same rule.
 */
export type MrnReceivedFrom = "TPW" | "CDC";

export const MRN_RECEIVED_FROM: readonly MrnReceivedFrom[] = ["TPW", "CDC"];

export function isMrnReceivedFrom(value: string): value is MrnReceivedFrom {
  return (MRN_RECEIVED_FROM as readonly string[]).includes(value);
}

/** Which of the supervisor's three phone tabs a feed is for (design §11 OQ-6). */
export type MrnSupervisorTab = "toCheck" | "checking" | "done";

// ── Derived values ───────────────────────────────────────────────────────────

/** Per-line derivations. Owner: lib/mrn/derive.ts. */
export interface MrnLineDerived {
  /** max(0, qtySti - physicalQty). 0 on an unchecked line. */
  shortQty: number;
  /** max(0, physicalQty - qtySti). 0 on an unchecked line. */
  excessQty: number;
  /**
   * Anything the billing operator has to look at: short, excess, or any
   * non-SND condition count. ⚠ SND is NOT an issue — it is the SOUND
   * (undamaged) count, so a line with sndQty === physicalQty is the clean case.
   */
  hasIssue: boolean;
}

/** Per-MRN roll-up. Owner: lib/mrn/derive.ts. Drives the rail chips
 *  ("All clear" / "4 issues") and the phone card badges. */
export interface MrnIssueSummary {
  issueLineCount: number;
  totalShort: number;
  totalExcess: number;
  totalLeaky: number;
  totalDamage: number;
  totalEmpty: number;
  totalQtd: number;
  totalRej: number;
}

// ── Batches ──────────────────────────────────────────────────────────────────

/**
 * One manufacturing batch on a line. USUALLY exactly one per line; a line
 * occasionally splits (30 tins Jun-26 + 16 tins Jul-26), which is why this is a
 * table and not four columns on the line.
 *
 * 🔴 bestBefore* IS NO LONGER COLLECTED (2026-08-22, schema v27.17). The
 * supervisor does not record it, so both halves are nullable here and in live,
 * and every row written from that date has NULL in both. Nothing displays them
 * either — they are off the line sheet, the desktop table and the report. See
 * prisma/schema.prisma’s mrn_line_batches header for the full rationale.
 *
 * They survive on the ROW type because historical rows may still carry values;
 * they are absent from MrnBatchInput below because nothing may send them.
 */
export interface MrnBatchRow {
  id: number;
  batchNo: number;
  qty: number;
  mfgMonth: number;
  mfgYear: number;
  /** Null on every row written since 2026-08-22 — see above. */
  bestBeforeMonth: number | null;
  bestBeforeYear: number | null;
}

/** A batch as the phone SUBMITS it — no id yet, and the row may be brand new.
 *  Shape accepted by validateBatches() in lib/mrn/derive.ts.
 *
 *  ⚠ NO bestBefore FIELDS, deliberately. Nothing collects them, so nothing may
 *  send them; the confirm route rejects nothing but also writes nothing there.
 *  Adding them back here is the first step of accidentally reviving the field. */
export interface MrnBatchInput {
  qty: number;
  mfgMonth: number;
  mfgYear: number;
}

// ── Lines ────────────────────────────────────────────────────────────────────

/** The six STORED condition counts. Short and Excess are deliberately absent —
 *  they are derived (MrnLineDerived). All six are null until the supervisor
 *  opens the issue toggle on that line. */
export interface MrnConditionCounts {
  sndQty: number | null;
  leakyQty: number | null;
  damageQty: number | null;
  emptyQty: number | null;
  /** ⚠ Meaning UNKNOWN — carried through schema, UI and report because the
   *  source workbook has it (design §4). Do not repurpose it. */
  qtdQty: number | null;
  rejQty: number | null;
}

export interface MrnDetailLine extends MrnConditionCounts, MrnLineDerived {
  id: number;
  /**
   * The delivery number this line arrived under (v27.20, 2026-09-01).
   *
   * ⚠ '' IS A REAL VALUE, NOT "missing". 32 backfilled lines carry it — three
   * MRNs had no header delivery number to copy down. Billing's tab strip
   * (step 5) renders it as an unnamed group rather than hiding those lines.
   *
   * ⚠ AND `lineNo` IS SCOPED BY IT. Each delivery numbers from 1, so lineNo is
   * the nth line OF THIS DELIVERY and two lines on one MRN can share it. Do not
   * use lineNo alone as a key or a position.
   */
  deliveryNo: string;
  lineNo: number;
  /** The raw SAP material code as pasted. NOT a catalog row id. */
  skuCode: string;
  /**
   * From `sku_master_v2.description`, matched on `material`. **null is a NORMAL
   * state**, not an error — roughly 27% of distinct active SAP codes resolve in
   * neither catalog table, and the screens render "Not in catalog" against the
   * bare code with the line still fully usable.
   */
  description: string | null;
  /** formatPack(packCode, unit). null for the same reason as `description`. */
  pack: string | null;
  /** false ⇒ render the "UNKNOWN SKU" treatment. Derived from the lookup, so
   *  no consumer has to test `description === null` and invent the rule. */
  isCatalogued: boolean;

  qtySti: number;
  cartonQty: number | null;
  /** null until the supervisor confirms the line. 0 is a REAL, valid value —
   *  the truck brought none of this line (design §11 OQ-4). */
  physicalQty: number | null;

  isChecked: boolean;
  checkedAt: Date | null;
  checkedByName: string | null;

  /** Ordered by batchNo. EMPTY is valid and expected when physicalQty is 0. */
  batches: MrnBatchRow[];
}

// ── Header / board rows ──────────────────────────────────────────────────────

/** The header facts both faces show. Split out so the detail payload and the
 *  board row cannot drift on the fields they share. */
export interface MrnHeaderFields {
  id: number;
  mrnNumber: string;
  /**
   * The IST date the MRN was RAISED. Partners `srNo` in UNIQUE(mrnDate, srNo)
   * and drives billing's date stepper.
   *
   * ⚠ NOT the same thing as truckReportingDate, and usually the same day —
   * which is what makes confusing them easy. Both are immutable after create.
   */
  mrnDate: Date;
  /** Truck 1, 2, 3… of that mrnDate. */
  srNo: number;
  /**
   * The day the truck reported. THIS is what every screen labelled "reported"
   * shows and what `ageDays` keys off (design §11 OQ-5).
   */
  truckReportingDate: Date;
  receivedFrom: string;
  receivingWarehouse: string;
  stiRefNo: string | null;
  deliveryNo: string | null;
  otrNo: string | null;
  status: MrnStatus;

  createdAt: Date;
  createdByName: string | null;

  unloadingStartAt: Date | null;
  unloadingStartById: number | null;
  unloadingStartByName: string | null;
  unloadingEndAt: Date | null;
  unloadingEndByName: string | null;
}

export interface MrnBoardRow extends MrnHeaderFields, MrnIssueSummary {
  /**
   * The DISTINCT delivery numbers on this MRN's lines, '' excluded
   * (lib/mrn/delivery.ts is the owner of that rule).
   *
   * 🔴 THE ROW ALSO CARRIES THE LEGACY `deliveryNo` HEADER FIELD via
   * MrnHeaderFields, and they are not the same thing. The header one is frozen
   * history — no writer since 2026-09-01, NULL on every MRN raised from now on.
   * This is the live answer. Billing's rail search reads THIS.
   */
  deliveryNos: string[];
  lineCount: number;
  checkedLineCount: number;
  /** SUM(qtySti) — the "1,982 nos" chip on both faces. */
  totalQtySti: number;
  /** SUM(physicalQty) over CHECKED lines only. */
  totalPhysicalQty: number;
  /**
   * Whole IST days between `truckReportingDate` and today, floored at 0. Feeds
   * the phone card's `1d` / `{n}d` age tag — how long this truck has gone
   * unchecked. Keyed off the REPORTING date, never mrnDate or createdAt.
   */
  ageDays: number;
}

export interface MrnDetail extends MrnHeaderFields, MrnIssueSummary {
  lineCount: number;
  checkedLineCount: number;
  totalQtySti: number;
  totalPhysicalQty: number;
  /** Ordered by lineNo. */
  lines: MrnDetailLine[];
}

/** Billing's rail: one mrnDate, newest truck first. */
export interface MrnBillingBoard {
  /** The YYYY-MM-DD the rail is fenced to. */
  date: string;
  rows: MrnBoardRow[];
}

/** The supervisor's three phone tabs, in one payload — ONE fetch feeding both
 *  the cards and the tab counts, so the two can never drift (the invariant
 *  CLAUDE_PICKING.md §5.1 is built on). */
export interface MrnSupervisorBoard {
  toCheck: MrnBoardRow[];
  checking: MrnBoardRow[];
  done: MrnBoardRow[];
}
