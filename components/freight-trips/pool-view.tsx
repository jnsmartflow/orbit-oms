"use client";

// Freight Trips — the Held bills pool. Floor's held set (via /api/freight-trips/pool,
// which is getFloorHold) minus bills already on an active freight trip.
//
// CARDS ARE THE ONLY VIEW (owner, 2026-10-02 — the Flat table and the header
// toggle are gone): one card per delivery type (./route-cards.tsx; mockup
// docs/mockups/freight-trips/held-cards.html).
//
// A click opens the DRILL-IN, the look of Floor's By route open card
// (components/floor/route-cards.tsx Chip + OpenPanel — COPIED, never imported):
//   - a strip of CLUB TABS for that delivery type — "{club}" over "{kg} kg ·
//     {stops} stops"; the selected tab is brand-filled with a ✕ (= back to the
//     cards); "Esc to go back to cards" at the right;
//   - the selected club's bills in ROUTE SECTIONS — "{route}  {stops} stops ·
//     {kg} kg" (+ "+N Hand · kg — not counted"), a select-all, then the SHARED
//     held-bills table (components/floor/hold-table.tsx, as-is). Rows by invoice
//     date OLDEST first, no invoice last (then OBD date); Hand bills after.
// A card HEAD opens the first club tab; a card ROW opens that club.
//
// Selection lives in the page, so ticks survive tab switches and going back.

import { useEffect, useMemo, useState } from "react";
import { HoldTable } from "@/components/floor/hold-table";
import { isAllIdsSelected, toggleAllIds, toggleOne, type FloorSelection } from "@/lib/floor/selection";
import type { FloorRouteClub, FloorScope } from "@/lib/floor/types";
import type { FreightPoolRow } from "@/lib/freight-trips/pool";
import {
  buildHeldCards,
  drillTabs,
  HeldCardGrid,
  kgText,
  stopCount,
  type ClubRow,
  type DrillTarget,
  type RouteSection,
} from "./route-cards";

/** Invoice date oldest first; no invoice last (by OBD date). Stable on OBD number. */
function byInvoiceDate(a: FreightPoolRow, b: FreightPoolRow): number {
  const ai = a.invoiceDate ?? "";
  const bi = b.invoiceDate ?? "";
  if (ai !== bi) {
    if (ai === "") return 1;
    if (bi === "") return -1;
    return ai < bi ? -1 : 1;
  }
  const ao = a.obdDateTime ?? "";
  const bo = b.obdDateTime ?? "";
  if (ao !== bo) return ao < bo ? -1 : 1;
  return a.obdNumber.localeCompare(b.obdNumber);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function PoolView({
  rows,
  allRows,
  clubs,
  scope,
  loading,
  error,
  selection,
  onSelection,
  selectable,
}: {
  /** The pool in the active scope. */
  rows: FreightPoolRow[];
  /** The whole pool — read only for a club member that draws from another type. */
  allRows: FreightPoolRow[];
  clubs: FloorRouteClub[];
  scope: FloorScope;
  loading: boolean;
  error: string | null;
  selection: FloorSelection;
  onSelection: (next: FloorSelection) => void;
  selectable: boolean;
}) {
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const now = useMemo(() => new Date(), [rows]);

  // One card per delivery type (the chip in effect decides which), + No route.
  const model = useMemo(() => buildHeldCards(scope, clubs, rows, allRows), [scope, clubs, rows, allRows]);
  // Re-derived from the CURRENT model, so a club that emptied drops out of the tabs.
  const open = useMemo(() => (drill ? drillTabs(model, drill) : null), [drill, model]);

  // A chip change re-scopes the cards: the open view would describe the old scope.
  useEffect(() => setDrill(null), [scope]);

  // Esc → back to the cards. Scoped to THIS view (live only while it is open),
  // and it yields to any freight overlay (drawer, confirm) — those carry
  // `data-freight-overlay` and own Esc while they are up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[data-freight-overlay]")) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      setDrill(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (loading && rows.length === 0) {
    return <div className="px-5 py-14 text-center text-[11.5px] text-ink-400">Loading held bills…</div>;
  }
  if (error) {
    return <div className="px-5 py-14 text-center text-[11.5px] text-ink-400">Couldn&rsquo;t load held bills. {error}</div>;
  }

  if (open && drill) {
    return (
      <div className="px-3.5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {open.tabs.map((t) => (
            <ClubTab
              key={t.key}
              club={t}
              isOpen={t.key === open.selected.key}
              onClick={() =>
                t.key === open.selected.key
                  ? setDrill(null)
                  : drill.kind === "type" && setDrill({ kind: "type", type: drill.type, clubKey: t.key })
              }
            />
          ))}
          <span className="ml-auto whitespace-nowrap pl-3 text-[12px] text-ink-400">Esc to go back to cards</span>
        </div>
        <div className="mt-3 overflow-hidden rounded-[11px] border border-ink-100 bg-white">
          {open.selected.routes.map((s, i) => (
            <RouteBlock
              key={s.key}
              section={s}
              first={i === 0}
              now={now}
              selectable={selectable}
              selection={selection}
              onSelection={onSelection}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      {model.cards.length === 0 && model.noRoute.length === 0 ? (
        <div className="px-5 py-12 text-center text-[11.5px] text-ink-400">No held bills for this delivery type.</div>
      ) : (
        <HeldCardGrid model={model} onOpen={setDrill} />
      )}
    </div>
  );
}

/** Floor's open-card chip: a 190px box, name over "kg · stops"; open = brand + ✕. */
function ClubTab({ club, isOpen, onClick }: { club: ClubRow; isOpen: boolean; onClick: () => void }) {
  const cls = isOpen ? "border-brand-600 bg-brand-600 text-white" : "border-ink-100 bg-white text-ink-900 hover:border-ink-200";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isOpen}
      title={isOpen ? "Back to cards" : undefined}
      className={`flex w-[190px] items-center gap-2 rounded-[14px] border px-5 py-3 text-left ${cls}`}
    >
      <span className="block min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{club.name}</span>
        <span className={`block whitespace-nowrap text-[13px] tabular-nums ${isOpen ? "text-white/80" : "text-ink-400"}`}>
          {club.rows.length === 0 ? "Hand only" : `${kgText(club.rows)} kg · ${plural(stopCount(club.rows), "stop", "stops")}`}
        </span>
      </span>
      {isOpen && (
        <span className="shrink-0 text-[15px] leading-none" aria-label="Close">
          &#x2715;
        </span>
      )}
    </button>
  );
}

/** One route of the open club: Floor's section header, a select-all, the shared table. */
function RouteBlock({
  section: s,
  first,
  now,
  selectable,
  selection,
  onSelection,
}: {
  section: RouteSection;
  first: boolean;
  now: Date;
  selectable: boolean;
  selection: FloorSelection;
  onSelection: (next: FloorSelection) => void;
}) {
  const list = useMemo(() => [...[...s.rows].sort(byInvoiceDate), ...[...s.hand].sort(byInvoiceDate)], [s]);
  const allOn = isAllIdsSelected(selection, list);
  return (
    <div className={first ? "" : "border-t border-ink-100"}>
      <div className="flex flex-wrap items-baseline gap-[9px] border-b border-ink-100 bg-ink-25 px-3.5 py-[9px]">
        {selectable && (
          <input
            type="checkbox"
            aria-label={`Select all held bills on ${s.name}`}
            className="h-[13px] w-[13px] cursor-pointer self-center accent-brand-600"
            checked={allOn}
            onChange={() => onSelection(toggleAllIds(selection, list))}
          />
        )}
        <span className="text-[13.5px] font-bold text-ink-900">{s.name}</span>
        {s.reachLabel && <span className="text-[11px] text-ink-400">{s.reachLabel}</span>}
        <span className="text-[12px] tabular-nums text-ink-400">
          {s.rows.length > 0 ? (
            <>
              {plural(stopCount(s.rows), "stop", "stops")} &middot; {kgText(s.rows)} kg
            </>
          ) : (
            "Hand only"
          )}
          {s.hand.length > 0 && (
            <span className="ml-[9px] font-semibold text-data-brown">
              +{s.hand.length} Hand · {kgText(s.hand)} kg — not counted
            </span>
          )}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1080px]">
          <HoldTable
            rows={list}
            now={now}
            selectable={selectable}
            selection={selection}
            onToggleRow={(id) => onSelection(toggleOne(selection, id))}
            onToggleAll={(rs) => onSelection(toggleAllIds(selection, rs))}
          />
        </div>
      </div>
    </div>
  );
}
