// lib/floor/rows.ts — LIVE FEED 7a: the Floor rows for a list of order ids.
//
// Design of record: docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md §G.1
// Served by: POST /api/floor/rows. Proven by: scripts/parity-floor-rows.ts.
//
// 🔴 NO SECOND ROW BUILDER. Each id goes through the SAME three feed functions
// the full load uses — getFloorBoard / getFloorHold / getFloorCancelled — with
// their `onlyIds` option, i.e. the same predicate (floorBoardWhere, the hold
// predicate, the cancel membership reads), the same hide exclusion, the same
// include tree, enrichment and mapping. A patched row therefore cannot differ
// from the row a full load would build (FLOOR §10: never re-declare a predicate).
//
// For each asked-for id: `tab` says which feed it is on NOW ('board' | 'hold' |
// 'cancelled'), or null with row null when it is on none of them — it has left
// Floor (dispatched, removed, hidden, another day's cancel, …). The three sets
// are disjoint by their predicates (board: dispatch or undecided; hold:
// dispatchStatus 'hold'; cancelled: workflowStage 'cancelled' with a CI or a
// cancel log today); if an id ever matched two, board wins, then hold.
//
// Extras the client needs to keep derived state right after a patch (none of
// them is a row):
//   · soFlags  — the duplicate-SO answer for every SO of the asked-for ids.
//                A twin appearing or leaving flips `hasDuplicateSo` on rows
//                that did not change themselves; the client applies this to
//                EVERY row sharing that SO.
//   · tripIds  — the trips the asked-for bills are on NOW (the client adds the
//                trips they were on before, which it already knows) → refresh
//                those trip cards.
//   · pickers  — the roster with on-hand counts, exactly as the board returns
//                it; any assign / done / unassign moves those counts.
//   · date     — the board's anchor day (IST). If it is not the day the client
//                loaded, the client must do a full load instead of merging.
//   · partnersByInvoice — (2026-10-08) EVERY bill on each asked-for bill's
//                invoice, with its place now (lib/floor/invoice-pairs.ts). A
//                bill going on hold, dispatched, removed or hidden changes what
//                its PARTNER's row says; the client applies this to every board
//                row carrying that invoice (applyInvoicePartners), exactly as it
//                applies soFlags. Built by the SAME read the full board uses
//                (getInvoicePartnerMap), so the two cannot disagree.
//
// SELECT-only, sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { getHideExclusion } from "@/lib/hide/visibility";
import { getTodayIST } from "@/lib/dates";
// Floor's Same-SO answer (2026-10-08) — Picking's rule minus one-invoice groups.
import { getFloorBoard, getFloorCancelled, getFloorDuplicateSoNumbers, getFloorHold, getFloorPickers, getInvoicePartnerMap } from "@/lib/floor/queries";
import type { InvoicePartner } from "@/lib/floor/invoice-pairs";
import type { FloorBoardRow, FloorCancelledRow, FloorHoldRow, FloorPicker } from "@/lib/floor/types";

export const FLOOR_ROWS_MAX_IDS = 300;

export type FloorRowTab = "board" | "hold" | "cancelled";

export interface FloorRowPatch {
  id: number;
  tab: FloorRowTab | null;
  row: FloorBoardRow | FloorHoldRow | FloorCancelledRow | null;
}

export interface FloorRowsResult {
  date: string;
  rows: FloorRowPatch[];
  soFlags: Record<string, boolean>;
  tripIds: number[];
  pickers: FloorPicker[];
  /** invoiceNo → every visible bill on it (self included; [] = none left). */
  partnersByInvoice: Record<string, InvoicePartner[]>;
}

export async function getFloorRowsByIds(ids: number[]): Promise<FloorRowsResult> {
  const unique = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0)));

  if (unique.length === 0) {
    return { date: getTodayIST(), rows: [], soFlags: {}, tripIds: [], pickers: await getFloorPickers(), partnersByInvoice: {} };
  }

  const hide = await getHideExclusion();
  const board = await getFloorBoard({ mode: "live", scope: "All", hideExclusion: hide, onlyIds: unique });
  const hold = await getFloorHold("All", hide, unique);
  const cancelled = await getFloorCancelled("All", hide, unique);

  const found = new Map<number, FloorRowPatch>();
  for (const r of cancelled) found.set(r.orderId, { id: r.orderId, tab: "cancelled", row: r });
  for (const r of hold) found.set(r.orderId, { id: r.orderId, tab: "hold", row: r });
  for (const r of board.rows) found.set(r.orderId, { id: r.orderId, tab: "board", row: r });

  const rows: FloorRowPatch[] = unique.map((id) => found.get(id) ?? { id, tab: null, row: null });

  // The asked-for bills' SO, trip pointer and invoice — one small read,
  // whatever tab (or none) each is on now. No isRemoved / hide filter: a bill
  // that LEFT Floor (removed, hidden, dispatched) still names its invoice here,
  // which is how its partner's row learns it has gone.
  const facts = await prisma.orders.findMany({
    where: { id: { in: unique } },
    select: { id: true, soNumber: true, tripDropId: true, invoiceNo: true },
  });

  const soNumbers = Array.from(
    new Set(facts.map((f) => f.soNumber).filter((s): s is string => s !== null && s.trim() !== "")),
  );
  const duplicates = soNumbers.length > 0 ? await getFloorDuplicateSoNumbers(soNumbers) : new Set<string>();
  const soFlags: Record<string, boolean> = {};
  for (const so of soNumbers) soFlags[so] = duplicates.has(so);

  const dropIds = Array.from(new Set(facts.map((f) => f.tripDropId).filter((d): d is number => d !== null)));
  const drops =
    dropIds.length > 0
      ? await prisma.trip_drops.findMany({ where: { id: { in: dropIds } }, select: { tripId: true } })
      : [];
  const tripIds = Array.from(new Set(drops.map((d) => d.tripId)));

  const pickers = await getFloorPickers();

  // Invoice partners — the full board's own read, for these bills' invoices.
  const partnerMap = await getInvoicePartnerMap(facts.map((f) => f.invoiceNo), hide);
  const partnersByInvoice: Record<string, InvoicePartner[]> = {};
  for (const [inv, list] of Array.from(partnerMap.entries())) partnersByInvoice[inv] = list;

  return { date: board.date, rows, soFlags, tripIds, pickers, partnersByInvoice };
}
