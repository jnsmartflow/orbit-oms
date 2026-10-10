// lib/order-invoices/rules.ts — ADD INVOICES, the rules. PURE: no Prisma, no
// clock, no React. Tests: lib/order-invoices/rules.test.ts
// (npx tsx --test lib/order-invoices/rules.test.ts).
//
// MODEL A (Schema v27.63, CORE §7.3): an UNSPLIT OBD is its seq-1 'sap' row and
// NO line rows ("no line rows" = all lines of the OBD). A SPLIT OBD is n ≥ 2
// rows — seq 1 is SAP's invoice, unchanged; seq 2..n are typed by hand — and
// EVERY row, seq 1 included, carries line rows that place every ACTIVE raw line
// of the OBD exactly: Σ tins per line == the line's unitQty.
//
// 🔴 LINES ARE KEYED BY rawLineItemId, NEVER BY SKU. One OBD can carry the same
// SKU on two lines (live: OBD 9109951956, SKU 9296830 on lines 900003 and
// 900004) — matching on SKU would merge them.
//
// Phase 2 is RECORD-ONLY: nothing here moves a trip, a hold, picking or CI.

// ONE rule for an invoice number, shared with CI's search (CLAUDE_CI.md §5):
// trimmed, uppercased, bare 9 digits get their `I`. Not re-written here.
import { normaliseCiSearchTerm } from "@/lib/ci/search-term";
import { DISPATCHED } from "@/lib/workflow-stages";

// No exported constant names these two stages (lib/floor/invoice-pairs.ts makes
// the same note for "cancelled"); one local name each so they are typed once.
const CANCELLED_STAGE = "cancelled";
/** The legacy terminal stage (rank 60, CLAUDE_CORE.md / lib/workflow-stages.ts). */
const CLOSED_STAGE = "closed";

/** Every live SAP invoice number is `I` + 9 digits (CI measured 6,950 of 6,950,
 *  lib/ci/search-term.ts). A typed number must have that shape. */
export const INVOICE_NO_SHAPE = /^I\d{9}$/;

/** At least the SAP invoice and one more — one invoice is not a split. */
export const MIN_INVOICES = 2;

/** A fuse, not a business rule: no paper split comes near it. */
export const MAX_INVOICES = 20;

/** A typed invoice number, canonicalised by CI's rule. Blank stays blank. */
export function normaliseInvoiceNo(raw: string): string {
  return normaliseCiSearchTerm(raw);
}

/** One ACTIVE raw line of the OBD (import_raw_line_items, lineStatus 'active'). */
export interface ActiveLine {
  rawLineItemId: number;
  lineId: number;
  skuCodeRaw: string;
  /** SAP's delivery quantity, in tins. */
  unitQty: number;
}

/** One line on one invoice: how many tins of which raw line. */
export interface InvoiceLineInput {
  rawLineItemId: number;
  qty: number;
}

/** One invoice of a split, in seq order: index 0 is seq 1 (SAP's). */
export interface SplitInvoiceInput {
  invoiceNo: string;
  lines: InvoiceLineInput[];
}

function lineName(l: ActiveLine): string {
  return `line ${l.lineId} (${l.skuCodeRaw})`;
}

/**
 * Every reason this split cannot be saved, in plain English. [] = valid.
 *
 * `invoices` is in seq order and its numbers must ALREADY be normalised (the
 * route runs normaliseInvoiceNo first); `sapInvoiceNo` is the seq-1 row's number.
 */
export function validateSplit(
  activeLines: ActiveLine[],
  invoices: SplitInvoiceInput[],
  sapInvoiceNo: string | null,
): string[] {
  const errors: string[] = [];

  if (sapInvoiceNo === null) {
    errors.push("Wait for the SAP invoice — this bill has no invoice number from SAP yet");
    return errors;
  }
  if (invoices.length < MIN_INVOICES) {
    errors.push("A split needs at least 2 invoices — the SAP invoice and one more");
  }
  if (invoices.length > MAX_INVOICES) {
    errors.push(`At most ${MAX_INVOICES} invoices on one bill`);
  }
  if (invoices.length > 0 && invoices[0].invoiceNo !== sapInvoiceNo) {
    errors.push(`Invoice 1 must be the SAP invoice ${sapInvoiceNo}, unchanged`);
  }

  // Numbers: present, the right shape (typed ones), unique within this OBD.
  const seen = new Set<string>();
  invoices.forEach((inv, i) => {
    const label = `Invoice ${i + 1}`;
    if (inv.invoiceNo.trim() === "") {
      errors.push(`${label} has no invoice number`);
      return;
    }
    if (i > 0 && !INVOICE_NO_SHAPE.test(inv.invoiceNo)) {
      errors.push(`${label}: "${inv.invoiceNo}" is not an invoice number (I and 9 digits)`);
    }
    if (seen.has(inv.invoiceNo)) {
      errors.push(`${inv.invoiceNo} is entered twice`);
    }
    seen.add(inv.invoiceNo);
  });

  // Lines: each invoice has some; every qty a whole number > 0; every line is
  // an active line of THIS OBD, once per invoice.
  const activeById = new Map(activeLines.map((l) => [l.rawLineItemId, l]));
  const placed = new Map<number, number>();
  invoices.forEach((inv, i) => {
    const label = inv.invoiceNo.trim() === "" ? `Invoice ${i + 1}` : inv.invoiceNo;
    if (inv.lines.length === 0) {
      errors.push(`${label} has no items ticked`);
      return;
    }
    const onThis = new Set<number>();
    for (const l of inv.lines) {
      const line = activeById.get(l.rawLineItemId);
      if (!line) {
        errors.push(`${label}: item ${l.rawLineItemId} is not a line of this bill`);
        continue;
      }
      if (onThis.has(l.rawLineItemId)) {
        errors.push(`${label}: ${lineName(line)} is listed twice`);
        continue;
      }
      onThis.add(l.rawLineItemId);
      if (!Number.isInteger(l.qty) || l.qty <= 0) {
        errors.push(`${label}: ${lineName(line)} needs a whole number of tins above 0`);
        continue;
      }
      placed.set(l.rawLineItemId, (placed.get(l.rawLineItemId) ?? 0) + l.qty);
    }
  });

  // Every active line placed EXACTLY. A line SAP shipped 0 tins of cannot be
  // placed (qty > 0), so it is exempt rather than unplaceable.
  for (const line of activeLines) {
    if (line.unitQty <= 0) continue;
    const got = placed.get(line.rawLineItemId) ?? 0;
    if (got < line.unitQty) {
      errors.push(`${lineName(line)}: ${line.unitQty - got} of ${line.unitQty} tins not placed on any invoice`);
    } else if (got > line.unitQty) {
      errors.push(`${lineName(line)}: ${got} tins placed but the bill has only ${line.unitQty}`);
    }
  }

  return errors;
}

/** A saved line row, as read back. */
export interface SavedLine {
  rawLineItemId: number;
  qty: number;
}

/**
 * True when a SAVED split no longer matches the OBD: a saved line is not active
 * any more, an active line is not covered, or the tins no longer add up — i.e.
 * a re-import changed the bill after the split was recorded. Also true for a
 * half-written save (rows without lines). An unsplit OBD (no saved lines) is
 * never stale. REPORT ONLY — nothing here, or in the route, auto-fixes it.
 */
export function detectStale(activeLines: ActiveLine[], savedLines: SavedLine[]): boolean {
  if (savedLines.length === 0) return false;
  const activeById = new Map(activeLines.map((l) => [l.rawLineItemId, l]));
  const placed = new Map<number, number>();
  for (const s of savedLines) {
    if (!activeById.has(s.rawLineItemId)) return true;
    placed.set(s.rawLineItemId, (placed.get(s.rawLineItemId) ?? 0) + s.qty);
  }
  for (const line of activeLines) {
    if (line.unitQty <= 0) continue;
    if ((placed.get(line.rawLineItemId) ?? 0) !== line.unitQty) return true;
  }
  return false;
}

/** The bill facts the refusal reads. */
export interface AddInvoicesBill {
  isRemoved: boolean;
  workflowStage: string;
  /** The seq-1 row's number (falls back to orders.invoiceNo). */
  sapInvoiceNo: string | null;
}

/**
 * Why invoices cannot be added / edited / undone on this bill, or null.
 * Being on a trip is ALLOWED — Phase 2 records only.
 */
export function addInvoicesRefusal(bill: AddInvoicesBill): string | null {
  if (bill.isRemoved) return "This bill has been removed";
  if (bill.workflowStage === CANCELLED_STAGE) return "This bill is cancelled";
  if (bill.workflowStage === DISPATCHED) return "This bill has already been dispatched";
  if (bill.workflowStage === CLOSED_STAGE) return "This bill is closed";
  if (bill.sapInvoiceNo === null) return "Wait for the SAP invoice — this bill has no invoice number from SAP yet";
  return null;
}
