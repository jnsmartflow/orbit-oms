"use client";

// Tint Manager — the header search's SOURCES (2026-10-02, round 2 step 2).
//
// One small ADAPTER per source turns that tab's rows into search items: the
// `Searchable` views (lib/tint/search.ts → lib/floor/search.ts, the one
// matcher), the dropdown row (bill-to · ship-to · one context bit · pill) and
// where opening it goes. DATA-DRIVEN on purpose: the page hands in the lists it
// already holds (today's — or, from round 2 step 3, a history day's), and
// nothing here fetches.
//
// ⚠ UNFILTERED lists. The header filters never hide a search result (owner):
// the page passes the full rail / board / tab rows, not the filtered ones.
//
// Sources, in tab order (the dropdown's group order):
//   Needs assignment (rail) · Tint · Base · TI · Hold · CI · Delete.
// A sampling number is matched where a row carries one — no loaded row does
// today (Tint jobs' TI rows are not on the board payload; TI-tab bills are the
// ones still OWING one), so codes cover customer codes only.

import type { FloorBoardRow, FloorCancelledRow } from "@/lib/floor/types";
import type { ParsedSearch, Searchable } from "@/lib/floor/search";
import type { PickDeleteDecidedRow } from "@/lib/billing/pick-delete-types";
import { StatusPill as FloorStatusPill, ON_HOLD_PILL_CLS, rowStatus } from "@/components/floor/status-pill";
import { matchesViews, obdHighlight, searchViews } from "@/lib/tint/search";
import { StatusPill } from "./board-bits";
import { slotLabel } from "./board-slot-cell";
import { siteNameOf } from "./rows";
import type { BoardTab } from "./board-tabs";
import type { SearchResultGroup, SearchResultRow } from "./search-dropdown";
import type { BasePendingOrder, BoardGroup, TintHoldRow, TintOrder } from "./types";

/** Where opening a result goes. */
export interface SearchTarget {
  /** The tab to switch to (null = stay; the rail is on every tab). */
  tab:         BoardTab | null;
  /** Select this rail card (Needs assignment). */
  railId?:     number;
  /** The detail panel to open, where that tab has one. */
  panelKey?:   string;
  /** The row to scroll to + flash (its data-search-key). */
  flashKey?:   string;
  /** Show every operator on the Tint tab (the row may be under another focus). */
  clearFocus?: boolean;
}

export interface SearchItem extends SearchResultRow {
  views:  Searchable[];
  target: SearchTarget | null;
}

export interface SearchSource {
  key:   string;
  label: string;
  items: SearchItem[];
}

export interface SearchInputs {
  rail:    TintOrder[];
  groups:  BoardGroup[];
  base:    FloorBoardRow[] | null;
  ti:      BasePendingOrder[];
  /** null when the person cannot see the tab — the group is left out. */
  hold:    TintHoldRow[] | null;
  ci:      FloorCancelledRow[] | null;
  deleted: PickDeleteDecidedRow[] | null;
}

const GREY_PILL = "inline-flex items-center rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]";
const pill = (cls: string, label: string) => <span className={cls}>{label}</span>;
const due = (date: string | null, windowTime: string | null) => (date ? `Due ${slotLabel(date, windowTime)}` : "No due date");

export function buildSearchSources(i: SearchInputs): SearchSource[] {
  const out: SearchSource[] = [];

  // ── Needs assignment (the rail) ─────────────────────────────────────────────
  out.push({
    key: "rail", label: "Needs assignment",
    items: i.rail.map((o) => {
      const s = siteNameOf(o, o.shipToOverrideName);
      return {
        key: `rail-${o.id}`, obd: o.obdNumber, highlight: null, openable: true,
        billTo: o.billToName, shipTo: s.site,
        context: due(o.dispatchTargetDate, o.dispatchWindowTime),
        pill: pill(GREY_PILL, "Waiting"),
        views: searchViews({
          obdNumber: o.obdNumber, invoiceNo: o.invoiceNo, soNumber: o.soNumber, shipTo: s.site,
          route: o.route, inMaster: !o.customerMissing,
          names: [o.billToName, s.original], codes: [o.shipToCustomerId, o.billToCode],
        }),
        target: { tab: null, railId: o.id, panelKey: `pending-${o.id}`, flashKey: `rail-${o.id}` },
      };
    }),
  });

  // ── Tint (the board's rows — orders and splits) ─────────────────────────────
  out.push({
    key: "tint", label: "Tint",
    items: i.groups.flatMap((g) => g.rows).map((r) => ({
      key: `tint-${r.key}`, obd: r.obdNumber, highlight: null, openable: true,
      billTo: r.billToName, shipTo: r.siteName,
      context: r.operatorName,
      pill: <StatusPill status={r.status} at={r.statusAt} pauseCount={r.pauseCount} />,
      views: searchViews({
        obdNumber: r.obdNumber, invoiceNo: r.invoiceNo, soNumber: r.soNumber, shipTo: r.siteName,
        route: r.route, inMaster: !r.customerMissing,
        names: [r.billToName, r.originalSiteName], codes: [r.order?.shipToCustomerId, r.order?.billToCode],
      }),
      target: { tab: "tinting", panelKey: r.key, flashKey: r.key, clearFocus: true },
    })),
  });

  // ── Base (Floor's rows, narrowed) ───────────────────────────────────────────
  out.push({
    key: "base", label: "Base",
    items: (i.base ?? []).map((r) => ({
      key: `base-${r.orderId}`, obd: r.obdNumber, highlight: null, openable: true,
      billTo: r.billToName, shipTo: r.dealerName,
      context: r.tripNumber ? `On trip ${r.tripNumber}` : due(r.dispatchTargetDate, r.windowTime),
      pill: <FloorStatusPill status={rowStatus(r)} heldBack={false} />,
      views: searchViews({
        obdNumber: r.obdNumber, invoiceNo: r.invoiceNo, soNumber: r.soNumber, shipTo: r.dealerName,
        route: r.route, inMaster: r.dealerInMaster, names: [r.billToName, r.customerName],
      }),
      target: { tab: "base", panelKey: `base-${r.orderId}`, flashKey: `base-${r.orderId}` },
    })),
  });

  // ── TI (Base — No Tint bills still owing TI) ────────────────────────────────
  out.push({
    key: "ti", label: "TI",
    items: i.ti.map((o) => {
      const owed = o.totalTintingLines - o.coveredLines;
      return {
        key: `ti-${o.tintAssignmentId}`, obd: o.obdNumber, highlight: null, openable: true,
        billTo: o.billToName, shipTo: o.shipToName,
        context: `TI owed · ${owed} ${owed === 1 ? "line" : "lines"}`,
        pill: pill("inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700", `TI ${o.coveredLines}/${o.totalTintingLines}`),
        views: searchViews({
          obdNumber: o.obdNumber, invoiceNo: o.invoiceNo, shipTo: o.shipToName, route: o.route,
          names: [o.billToName, o.originalSiteName], codes: [o.shipToCode, o.billToCode],
        }),
        target: { tab: "ti", flashKey: `ti-${o.tintAssignmentId}` },
      };
    }),
  });

  // ── Hold ────────────────────────────────────────────────────────────────────
  if (i.hold !== null) {
    out.push({
      key: "hold", label: "Hold",
      items: i.hold.map((r) => ({
        key: `hold-${r.orderId}`, obd: r.obdNumber, highlight: null, openable: true,
        billTo: r.billToName, shipTo: r.dealerName,
        context: due(r.dispatchTargetDate, r.dispatchWindowTime),
        pill: pill(`inline-flex items-center rounded-[4px] px-2 py-[2px] text-[10px] font-semibold ${ON_HOLD_PILL_CLS}`, "On hold"),
        views: searchViews({
          obdNumber: r.obdNumber, invoiceNo: r.invoiceNo, soNumber: r.soNumber, shipTo: r.dealerName,
          route: r.route, inMaster: r.dealerInMaster, names: [r.billToName, r.originalSiteName],
        }),
        target: { tab: "hold", panelKey: `hold-${r.orderId}`, flashKey: `hold-${r.orderId}` },
      })),
    });
  }

  // ── CI (today's cancels + CIs) ──────────────────────────────────────────────
  if (i.ci !== null) {
    out.push({
      key: "ci", label: "CI",
      items: i.ci.map((r) => ({
        key: `ci-${r.orderId}`, obd: r.obdNumber, highlight: null, openable: true,
        billTo: r.billToName, shipTo: r.dealerName,
        context: r.reason,
        pill: pill(GREY_PILL, r.ciNumber ? "CI live" : "Cancelled"),
        views: searchViews({
          obdNumber: r.obdNumber, invoiceNo: r.invoiceNo, soNumber: r.soNumber, shipTo: r.dealerName,
          route: r.route, inMaster: r.dealerInMaster, names: [r.billToName], codes: [r.ciNumber],
        }),
        target: { tab: "ci", flashKey: `ci-${r.orderId}` },
      })),
    });
  }

  // ── Delete (this month's pick-delete decisions — one item per OBD) ─────────
  if (i.deleted !== null) {
    out.push({
      key: "delete", label: "Delete",
      items: i.deleted.flatMap((d) => d.obdNumbers.map((obd) => ({
        key: `del-${d.id}-${obd}`, obd, highlight: null, openable: true,
        billTo: d.customerName, shipTo: null,
        context: `SO ${d.soNumber}`,
        pill: pill(GREY_PILL, d.kind === "pick_delete" ? "Deleted" : "All OK"),
        views: searchViews({ obdNumber: obd, soNumber: d.soNumber, names: [d.customerName] }),
        // Billing's history table renders its own rows — the tab opens, no row flash.
        target: { tab: "pick" },
      }))),
    });
  }

  return out;
}

/** The client groups for a parsed search: matching items only, highlight set,
 *  empty groups kept (the dropdown hides them). */
export function matchSources(sources: SearchSource[], parsed: ParsedSearch): Array<SearchResultGroup & { rows: SearchItem[] }> {
  return sources.map((s) => ({
    key:   s.key,
    label: s.label,
    rows:  s.items
      .filter((it) => matchesViews(it.views, parsed))
      .map((it) => ({ ...it, highlight: obdHighlight(it.obd, parsed) })),
  }));
}
