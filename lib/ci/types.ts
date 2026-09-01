// lib/ci/types.ts
//
// Wire shapes for the CI module — the search feed, one bill's lines, the two
// board faces and one CI's detail. Pure types plus the status/enum guards; no
// imports, no Prisma, so a client component and a route handler can both take
// from here without dragging the client bundle in.
//
// Same role lib/mrn/types.ts plays for MRN, and shaped from the two mockups
// (docs/mockups/ci/supervisor.html, billing.html) rather than from the columns:
// a payload is what a screen needs, not what a table holds.

// ── Status ───────────────────────────────────────────────────────────────────
//
// 🔴 FOUR VALUES, AND THE LIVE CHECK CONSTRAINT ENFORCES EXACTLY THESE.
// chk_ci_returns_status is not expressible in Prisma (CORE §7.4), so this union
// is the only place application code learns the vocabulary. A FIFTH value needs
// a SQL ALTER on that constraint FIRST — never just a new string here.
//
// 'returned_to_floor' is in the constraint and in this union from day one even
// though no UI writes it yet (spec §11.1, still an open decision). It exists so
// that adding the button later is a UI change, not a live-CHECK migration.
export type CiStatus = "draft" | "submitted" | "closed" | "returned_to_floor";

export const CI_STATUSES: readonly CiStatus[] = [
  "draft",
  "submitted",
  "closed",
  "returned_to_floor",
];

export function isCiStatus(value: string): value is CiStatus {
  return (CI_STATUSES as readonly string[]).includes(value);
}

/**
 * Narrow a status string read back out of the database.
 *
 * Throws rather than defaulting: the CHECK constraint means an unknown value
 * here is a schema/code disagreement, and silently coercing it to 'draft' would
 * HIDE the row from every surface (everything filters `status <> 'draft'`) —
 * a bug that reads as "the CI vanished".
 */
export function asCiStatus(value: string): CiStatus {
  if (!isCiStatus(value)) throw new Error(`Unknown CI status "${value}"`);
  return value;
}

export type CiReturnType = "full" | "part";
export type CiMaterialMoved = "moved" | "not_moved";

export function isCiReturnType(v: string): v is CiReturnType {
  return v === "full" || v === "part";
}
export function isCiMaterialMoved(v: string): v is CiMaterialMoved {
  return v === "moved" || v === "not_moved";
}

// ── Search (supervisor frame 2) ──────────────────────────────────────────────

/**
 * One row of the search result list.
 *
 * 🔴 ALWAYS A LIST, NEVER A SINGLE ROW (spec §4). 11 invoice numbers map to two
 * OBDs each, always sharing one soNumber. With exactly one hit the UI skips
 * straight to the bill — that is a UI shortcut, not a query shortcut, and the
 * payload shape does not change.
 *
 * Fields are exactly the mockup's card: OBD, "N lines", dealer, date, litres.
 */
export interface CiSearchHit {
  orderId: number;
  obdNumber: string;
  /** Effective ship-to, resolved by lib/ci/derive.ts — see resolveCiDealer(). */
  customerName: string;
  /** Null when SAP has not sent one yet — 5% of dispatched bills (spec §4). */
  invoiceNo: string | null;
  /** ISO date string, or null. The card's "22 Aug". */
  invoiceDate: string | null;
  obdDateTime: string | null;
  /** ACTIVE lines only. The card's "12 lines". */
  lineCount: number;
  /** Σ (volumeLine) over active lines. The card's "212 L". */
  totalLitres: number;
}

export interface CiSearchResult {
  /** The normalised term actually queried — echoed so the UI can show what it
   *  searched after the bare-9-digits `I` prefix was applied (spec §4). */
  query: string;
  hits: CiSearchHit[];
}

// ── One bill's lines (supervisor frames 3-5) ─────────────────────────────────

/**
 * One line of the bill the supervisor is returning against.
 *
 * ⚠ This is the SOURCE line, read live from import_raw_line_items. It is NOT a
 * ci_return_lines row — those are written at submit (step 3c) and snapshot
 * these values, because a re-import patches the raw line in place and a closed
 * CI must not silently change what it claims was delivered.
 */
export interface CiBillLine {
  /** `import_raw_line_items.id` — becomes ci_return_lines.rawLineItemId. */
  rawLineItemId: number;
  /** SAP's item number on the OBD. Display only; not a join key. */
  lineId: number | null;
  /** The raw SAP material code. Resolved via sku_master_v2.material ONLY. */
  skuCode: string;
  /** From the catalog. Null is NORMAL — ~5.9% of active lines never resolve. */
  description: string | null;
  /** formatPack(packCode, unit) — "20L", "500ML". Null for the same reason. */
  pack: string | null;
  /** false ⇒ render the unmastered treatment against the bare code. */
  isCatalogued: boolean;
  /** SAP's DELIVERY quantity. NOT an invoiced quantity — no such column exists
   *  anywhere in this database. The mockup's "of 8" / "All 8". */
  deliveryQty: number;
  /**
   * volumeLine ÷ unitQty, already guarded. Null ONLY when unitQty was null or
   * zero — never merely because the value is 0. See lib/ci/derive.ts.
   */
  litresPerTin: number | null;
  /** volumeLine for the whole line, as SAP sent it. */
  lineLitres: number;
}

export interface CiBillResult {
  orderId: number;
  obdNumber: string;
  /** Header line 1 of frames 3-5. */
  customerName: string;
  /** The sub-strip: date · invoice · litres. */
  invoiceNo: string | null;
  invoiceDate: string | null;
  obdDateTime: string | null;
  totalLitres: number;
  /** Snapshot candidates the submit route (3c) will copy onto the header. */
  soNumber: string | null;
  customerId: number | null;
  customerCode: string | null;
  lines: CiBillLine[];
}

// ── Boards ───────────────────────────────────────────────────────────────────

/** One card, on either face. The supervisor's Submitted list and billing's rail
 *  show the same facts at different densities, so one row type serves both. */
export interface CiBoardRow {
  id: number;
  /** Never null on a board row: every board filters `status <> 'draft'`, and a
   *  number is allocated at the moment a CI leaves draft. */
  ciNumber: string;
  status: CiStatus;
  customerName: string;
  obdNumber: string;
  returnType: CiReturnType;
  lineCount: number;
  totalLitres: number;
  totalTins: number;
  /** billing rail's "12:20". ISO instant; the client formats to IST. */
  submittedAt: string | null;
  closedAt: string | null;
}

/**
 * The supervisor's Submitted tab (frame 9): two bands, "With billing" and
 * "Finished".
 *
 * ⚠ SCOPED TO THE VIEWER'S OWN CIs, as the mockup draws it — spec §11.5 is an
 * OPEN DECISION ("does Submitted show other supervisors' CIs, or only his
 * own?"). The scope lives in ONE place, buildCiSupervisorWhere(), so answering
 * §11.5 the other way is a one-line change there and nowhere else.
 *
 * Date fencing mirrors MRN's supervisor board exactly: the outstanding band
 * spans ALL dates (work handed to billing yesterday is still his to see), and
 * only the finished band is fenced to today — a receipt, not a task.
 */
export interface CiSupervisorBoard {
  face: "supervisor";
  withBilling: CiBoardRow[];
  finished: CiBoardRow[];
}

/** Billing's one rail (frame 1): pending on top, closed underneath, one date. */
export interface CiBillingBoard {
  face: "billing";
  /** The IST calendar day this rail is fenced to, "YYYY-MM-DD". */
  date: string;
  pending: CiBoardRow[];
  closed: CiBoardRow[];
  /** The header's "4 pending · 13 closed" and "Today 17 CIs". */
  pendingCount: number;
  closedCount: number;
  totalCount: number;
}

export type CiBoardResult = CiSupervisorBoard | CiBillingBoard;

// ── One CI's detail (billing right pane) ─────────────────────────────────────

/** One returned line, as billing's table renders it. */
export interface CiDetailLine {
  id: number;
  lineNumber: number;
  /**
   * `import_raw_line_items.id` — the SAME key CiBillLine carries.
   *
   * 🔴 ADDED FOR THE EDIT PATH (2026-09-01, step 7e). Without it the phone can
   * show a submitted CI's lines but cannot say WHICH bill lines they are, so it
   * cannot seed the editor or post a change back: PUT /lines speaks
   * rawLineItemId and nothing else. `id` is the ci_return_lines PK and is no
   * use for that — it is a row on the CI, not a line on the bill.
   *
   * ⚠ NULLABLE, AND NOT DEFENSIVELY. The column is a POINTER, not a foreign key
   * — the spec says so and sql/2026-08-31-ci-module.sql:294 records the decision
   * — so the schema allows null and this type must say so rather than assert it
   * away. PUT /lines has written it on every row it has ever created, so null
   * should not occur in practice; if one ever does, the edit screen drops that
   * CI to read-only rather than posting a line it cannot identify.
   */
  rawLineItemId: number | null;
  skuCode: string;
  skuDescription: string | null;
  packCode: string | null;
  deliveryQty: number | null;
  returnedQty: number;
  litresPerTin: number | null;
  returnedQtyLitres: number | null;
}

export interface CiDetail {
  id: number;
  ciNumber: string | null;
  status: CiStatus;

  // the bill
  orderId: number;
  obdNumber: string;
  /**
   * ⚠ READ LIVE THROUGH orderId, NOT the snapshot, and that asymmetry is
   * deliberate (spec §4): 5% of bills have no invoice number when the CI is
   * raised and it arrives later, so the live value is the fresher one. Falls
   * back to the snapshot, never the reverse.
   */
  invoiceNo: string | null;
  invoiceDate: string | null;
  soNumber: string | null;
  customerCode: string | null;
  customerName: string | null;
  /**
   * ⚠ NOT A COLUMN — read LIVE via customerId → delivery_point_master.area.
   * Blank for an unmastered dealer, which is a normal state, not an error.
   * The mockup's "102492 · OBD 9109145575 · Ghod Dod".
   */
  area: string | null;

  // stage 1
  returnType: CiReturnType;
  materialMoved: CiMaterialMoved;
  materialReceivedDate: string;
  /**
   * The FK. Added for the edit path (2026-09-01, step 7e): PATCH /details
   * speaks reasonId, so the screen has to seed the reason picker with the id
   * and not just the words.
   *
   * 🔴 `reasonLabel` STAYS AND IS NOT DERIVED FROM THIS. It is the SNAPSHOT
   * taken when the CI was raised (spec §3.1), so renaming a reason never
   * rewrites the history of returns filed under the old wording. Rendering the
   * label by looking this id up in ci_reason_master would silently undo that.
   * The id is for writing; the label is for reading.
   */
  reasonId: number;
  reasonLabel: string;
  reasonRemark: string | null;
  supervisorName: string | null;
  submittedAt: string | null;

  // stage 2
  ciDate: string | null;
  sapCiNumber: string | null;
  /** Serialised as a string — Prisma Decimal does not survive JSON as a number
   *  without losing the scale the paper form is signed against. */
  ciValue: string | null;
  billingOperatorName: string | null;
  closedAt: string | null;

  // derived
  lines: CiDetailLine[];
  lineCount: number;
  totalTins: number;
  totalLitres: number;
  /** The mockup's "3 of 12 on the bill" — the denominator is the BILL's active
   *  line count, read live from import_raw_line_items, not stored on the CI. */
  billLineCount: number;
}

// ── Marker (billing only) ────────────────────────────────────────────────────

/**
 * 🔴 BILLING POLLS, THE SUPERVISOR DOES NOT (spec §10). CI runs the opposite way
 * to MRN: the supervisor CREATES the work, so he has nothing to wait for; the
 * billing desk is the side waiting on someone else. MRN's marker is
 * supervisor-only for the mirror-image reason. This is a deliberate asymmetry
 * in BOTH modules — do not "align" them.
 */
export interface CiMarker {
  count: number;
  latest: string | null;
}

// ── Reason picker (supervisor frame 7) ───────────────────────────────────────

/**
 * One selectable reason, from `ci_reason_master` via GET /api/ci/reasons.
 *
 * 🔴 NEVER HARDCODE THIS LIST IN A COMPONENT. It is data so the depot can
 * change it without a deploy (spec §3.1); a client-side copy goes stale the
 * first time a row is edited and offers a reason the submit route refuses.
 */
export interface CiReasonOption {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
  /** The three common ones sit above the divider; the rest under "More". */
  isPinned: boolean;
}
