"use client";

// Freight Trips — the Held bills pool. Floor's held set (via /api/freight-trips/pool,
// which is getFloorHold) minus bills already on an active freight trip.
//
//   By route (default) — one SECTION per delivery type (Local · Upcountry ·
//     IGT · Cross, + "No delivery type" when any), each Floor-style route cards
//     (./route-cards.tsx). A click on a card (whole club) or a route line opens
//     the DRILL-IN: those bills grouped by INVOICE DATE, oldest first, each date
//     a band with its own select-all, then the SHARED held-bills table
//     (components/floor/hold-table.tsx, imported as-is). "No invoice yet" last.
//   Flat — one HoldTable, invoice date oldest first, no-invoice last.
//
// Selection lives in the page, so ticks survive cards ↔ drill-in ↔ Flat.

import { useMemo, useState } from "react";
import { HoldTable } from "@/components/floor/hold-table";
import { formatLitres } from "@/components/floor/status-pill";
import { formatDateIST } from "@/lib/floor/format";
import { inScope } from "@/lib/floor/scope";
import { isAllIdsSelected, toggleAllIds, toggleOne, type FloorSelection } from "@/lib/floor/selection";
import type { FloorRouteClub, FloorScope } from "@/lib/floor/types";
import type { FreightPoolRow } from "@/lib/freight-trips/pool";
import {
  buildFreightCards,
  FreightCardGrid,
  kgText,
  litresOf,
  sectionTypes,
  type DrillTarget,
  type FreightCard,
} from "./route-cards";

type Pivot = "route" | "flat";
type SectionScope = Exclude<FloorScope, "All">;

const SECTIONS: { key: SectionScope; label: string }[] = [
  { key: "Local", label: "Local" },
  { key: "Upcountry", label: "Upcountry" },
  { key: "IGT / Cross", label: "IGT · Cross" },
];
const NO_TYPE_KEY = "none";

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

interface Section {
  key: string;
  label: string;
  cards: FreightCard[];
}

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
  title,
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
  /** Overrides the header line (the add band passes its own). */
  title?: string;
}) {
  const [pivot, setPivot] = useState<Pivot>("route");
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const now = useMemo(() => new Date(), [rows]);

  const sections: Section[] = useMemo(() => {
    const shown = scope === "All" ? SECTIONS : SECTIONS.filter((s) => s.key === scope);
    const out: Section[] = shown.map((s) => {
      const sectionRows = rows.filter((r) => inScope(r.deliveryType, s.key));
      return { key: s.key, label: s.label, cards: buildFreightCards(sectionTypes(s.key), clubs, sectionRows, allRows) };
    });
    if (scope === "All") {
      const untyped = rows.filter((r) => !SECTIONS.some((s) => inScope(r.deliveryType, s.key)));
      if (untyped.length > 0) {
        out.push({ key: NO_TYPE_KEY, label: "No delivery type", cards: buildFreightCards([], [], untyped, allRows) });
      }
    }
    return out.filter((s) => s.cards.length > 0);
  }, [rows, allRows, clubs, scope]);

  const allCards = sections.flatMap((s) => s.cards);
  const lineSlots = Math.max(1, ...allCards.map((c) => c.lines.length));
  const handSlot = allCards.some((c) => c.hand.length > 0);

  // The drill-in's bills, re-derived from the CURRENT pool on every render, so a
  // bill that went onto a trip leaves the list at the next load.
  const drilled = useMemo(() => {
    if (!drill) return null;
    const card = sections.find((s) => s.key === drill.section)?.cards.find((c) => c.key === drill.cardKey);
    if (!card) return { title: "These bills", rows: [] as FreightPoolRow[] };
    const line = drill.lineKey ? card.lines.find((l) => l.key === drill.lineKey) : null;
    const list = line ? [...line.rows, ...line.hand] : [...card.rows, ...card.hand];
    return { title: line ? `${card.name} › ${line.name}` : card.name, rows: list };
  }, [drill, sections]);

  const flatRows = useMemo(() => [...rows].sort(byInvoiceDate), [rows]);
  const seg = (on: boolean) => `px-[11px] text-[11px] ${on ? "bg-white font-semibold text-ink-900" : "text-ink-500"}`;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-[15px] font-semibold text-ink-900">Held bills {rows.length}</span>
          <span className="ml-2 text-[12px] text-ink-500">{title ?? "— not on a freight trip yet"}</span>
        </div>
        <span className="ml-auto flex h-[27px] shrink-0 overflow-hidden rounded-[6px] border border-ink-100 bg-ink-50">
          <button type="button" className={seg(pivot === "route")} onClick={() => setPivot("route")}>By route</button>
          <button type="button" className={seg(pivot === "flat")} onClick={() => setPivot("flat")}>Flat</button>
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <div className="px-5 py-14 text-center text-[11.5px] text-ink-400">Loading held bills…</div>
      ) : error ? (
        <div className="px-5 py-14 text-center text-[11.5px] text-ink-400">Couldn&rsquo;t load held bills. {error}</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <h4 className="text-[13px] font-semibold text-ink-900">No held bills to plan</h4>
          <p className="mt-1.5 text-[11.5px] text-ink-400">Every held bill is already on a freight trip, or nothing is on hold.</p>
        </div>
      ) : pivot === "flat" ? (
        <TableBox>
          <HoldTable
            rows={flatRows}
            now={now}
            selectable={selectable}
            selection={selection}
            onToggleRow={(id) => onSelection(toggleOne(selection, id))}
            onToggleAll={(rs) => onSelection(toggleAllIds(selection, rs))}
          />
        </TableBox>
      ) : drilled ? (
        <div>
          <div className="flex items-center gap-3 px-4 pb-1 pt-3">
            <button type="button" onClick={() => setDrill(null)} className="text-[12.5px] font-semibold text-brand-700 hover:underline">
              ← All routes
            </button>
            <span className="truncate text-[14px] font-semibold text-ink-900">{drilled.title}</span>
            <span className="text-[12px] tabular-nums text-ink-500">
              {drilled.rows.length} bill{drilled.rows.length === 1 ? "" : "s"}
            </span>
          </div>
          {drilled.rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-[11.5px] text-ink-400">No held bills left here.</div>
          ) : (
            <InvoiceDateBands rows={drilled.rows} now={now} selectable={selectable} selection={selection} onSelection={onSelection} />
          )}
        </div>
      ) : (
        <div className="space-y-5 px-4 py-3.5">
          {sections.map((s) => (
            <section key={s.key}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">
                {s.label}
                <span className="ml-2 normal-case tracking-normal text-ink-400">
                  · {s.cards.reduce((n, c) => n + c.rows.length + c.hand.length, 0)} bills
                </span>
              </h3>
              <FreightCardGrid section={s.key} cards={s.cards} lineSlots={lineSlots} handSlot={handSlot} onOpen={setDrill} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal scroll inside the box, never the page. */
function TableBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1080px]">{children}</div>
    </div>
  );
}

/** The drill-in: one band per invoice date, oldest first; "No invoice yet" last. */
function InvoiceDateBands({
  rows,
  now,
  selectable,
  selection,
  onSelection,
}: {
  rows: FreightPoolRow[];
  now: Date;
  selectable: boolean;
  selection: FloorSelection;
  onSelection: (next: FloorSelection) => void;
}) {
  const bands = useMemo(() => {
    const byKey = new Map<string, FreightPoolRow[]>();
    for (const r of [...rows].sort(byInvoiceDate)) {
      const key = r.invoiceDate ? r.invoiceDate.slice(0, 10) : "";
      const list = byKey.get(key) ?? [];
      list.push(r);
      byKey.set(key, list);
    }
    // Insertion order is already oldest first with "" last (byInvoiceDate).
    return Array.from(byKey.entries());
  }, [rows]);

  return (
    <div>
      {bands.map(([key, list]) => {
        const allOn = isAllIdsSelected(selection, list);
        const label = key === "" ? "No invoice yet" : formatDateIST(list[0].invoiceDate);
        return (
          <div key={key || "none"} className="border-b border-ink-100">
            <div className="flex items-center gap-3 bg-ink-25 px-4 py-2">
              {selectable && (
                <input
                  type="checkbox"
                  aria-label={`Select all bills — ${label}`}
                  className="h-[13px] w-[13px] cursor-pointer accent-brand-600"
                  checked={allOn}
                  onChange={() => onSelection(toggleAllIds(selection, list))}
                />
              )}
              <span className="text-[13px] font-semibold text-ink-900">{label}</span>
              <span className="text-[12px] tabular-nums text-ink-500">
                · {list.length} bill{list.length === 1 ? "" : "s"} · {formatLitres(litresOf(list))} L · {kgText(list)} kg
              </span>
            </div>
            <TableBox>
              <HoldTable
                rows={list}
                now={now}
                selectable={selectable}
                selection={selection}
                onToggleRow={(id) => onSelection(toggleOne(selection, id))}
                onToggleAll={(rs) => onSelection(toggleAllIds(selection, rs))}
              />
            </TableBox>
          </div>
        );
      })}
    </div>
  );
}
