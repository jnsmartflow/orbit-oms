"use client";

import { cn } from "@/lib/utils";
import type { SupportOrder } from "@/components/support/support-orders-table";

// ── Shared GRID percentage strings ───────────────────────────────────────────
// Percentages are content-blind: they resolve against the container's own
// width, never against cell content. That's what lets every independent grid
// instance (the header row, and every body row — each its own separate
// `display:grid` div, not one shared grid container) resolve to identical
// pixel track widths, so columns never drift row-to-row or vs. the header.
//
// Main board: checkbox·OBD·Customer·Ship-To·Age·Route·Vol·Article·Status·Slot·Priority
export const SUPPORT_GRID_COLUMNS = "3% 9% 19% 11% 5% 9% 5% 9% 9% 13% 8%";
// Hold: no Status column; Action moves to the trailing edge. OBD matches the
// main board's 9% (Hold's OBD cell has no Overdue badge — Hold Since already
// carries the age signal that matters here); the freed 1% goes to Customer
// (20% vs the main board's 19%). Hold Since gets 6% vs the main board's Age
// at 5% (two-word header, see support-hold-table.tsx).
// checkbox·OBD·Customer·Ship-To·HoldSince·Route·Vol·Article·Slot·Priority·Action
export const SUPPORT_HOLD_GRID_COLUMNS = "3% 9% 20% 11% 6% 9% 5% 9% 13% 7% 8%";

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

// ── Group-by (SMU / Route) — pure data grouping, shared by both boards ───────
// No entanglement with done-group collapse or footprintType: grouping only
// ever runs over the already-filtered pending/hold list each board builds
// itself; the done-group split (main board) happens before this, separately.
export type GroupBy = "smu" | "route" | "none";

export interface OrderGroup {
  groupName: string;
  orders: SupportOrder[];
}

export function getSmuGroup(order: SupportOrder): string {
  return order.smu || "Unknown SMU";
}

export function groupOrders(orders: SupportOrder[], groupBy: GroupBy): OrderGroup[] {
  if (groupBy === "none") return [{ groupName: "All Orders", orders }];
  const map = new Map<string, SupportOrder[]>();
  for (const o of orders) {
    let key: string;
    if (groupBy === "smu") key = getSmuGroup(o);
    else key = o.customer?.area?.primaryRoute?.name ?? "Unassigned";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }
  return Array.from(map.entries()).map(([groupName, orders]) => ({ groupName, orders }));
}

// ── Priority label ────────────────────────────────────────────────────────────
export function getPriLabel(val: string): string {
  if (val === "1") return "P1";
  if (val === "2") return "P2";
  if (val === "4") return "P3";
  return "FIFO";
}

// ── Stacked Vol cell — volume value + raw materialType sub-line, both right-aligned ──
// Caller supplies the grid-item wrapper div (className="px-3.5 text-right");
// this renders just the two stacked lines.
export function VolCell({
  importVolume,
  materialType,
  muted,
}: {
  importVolume: number | null;
  materialType: string | null | undefined;
  muted: boolean;
}) {
  return (
    <>
      <p className={cn("font-mono font-semibold text-xs tabular-nums text-right", muted ? "text-gray-400" : "text-gray-700")}>
        {importVolume != null ? Math.round(importVolume) : "—"}
      </p>
      <span className="text-[10px] text-gray-400 text-right block">
        {materialType ?? "—"}
      </span>
    </>
  );
}

// ── Customer cell — name + code, with optional Missing/tinting badges ────────
// Caller supplies the grid-item wrapper div (className="min-w-0 px-3.5");
// this renders the inner name/code structure.
export function CustomerCell({
  customerName,
  fallbackName,
  shipToCustomerId,
  customerMissing,
  hasTinting,
  muted,
  showBadges,
  onMissing,
}: {
  customerName: string | null | undefined;
  fallbackName: string | null | undefined;
  shipToCustomerId: string;
  customerMissing: boolean;
  hasTinting: boolean | undefined;
  muted: boolean;
  showBadges: boolean;
  onMissing: (v: { open: boolean; shipToCustomerId: string | null; shipToCustomerName: string | null }) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-1 min-w-0">
        <p
          className={cn("text-xs font-medium truncate", muted ? "text-gray-500" : "text-gray-700")}
          title={customerName ?? fallbackName ?? undefined}
        >
          {customerName ?? fallbackName ?? "—"}
        </p>
        {showBadges && customerMissing && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMissing({ open: true, shipToCustomerId, shipToCustomerName: fallbackName ?? null }); }}
            className="text-[9px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded transition-colors flex-shrink-0"
          >
            ⚠ Missing
          </button>
        )}
        {showBadges && hasTinting && (
          <span className="text-[10px] text-purple-500 flex-shrink-0">🎨</span>
        )}
      </div>
      <p className={cn("text-[10px] truncate", muted ? "text-gray-300" : "text-gray-400")}>
        {shipToCustomerId}
      </p>
    </>
  );
}
