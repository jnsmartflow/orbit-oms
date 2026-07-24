"use client";

// Floor Control — the right pane below the Floor/On-hold/Cancelled tabs.
// Read-only this step. Composes: Live/History date bar → slot tabs → body
// (flat table · slot bands on All · route rows on By-route) → Upcoming strip,
// plus the carry-over banner and the day-finished / empty states.
//
// The spine (lib/picking/sort.ts) is REUSED, never copied, and applied to the
// LEAF group on screen (design §7.9): inside each slot band on All, across the
// cutoff on a flat slot tab, inside each route on By-route.

import { useState, type ReactNode } from "react";
import { sortPickingQueue } from "@/lib/picking/sort";
import { FloorTabs, type SlotTabKey } from "./floor-tabs";
import { FloorTable } from "./floor-table";
import { SlotBand } from "./slot-band";
import { RouteRow } from "./route-row";
import { CarryoverBanner } from "./carryover-banner";
import { UpcomingStrip } from "./upcoming-strip";
import { countByStatus, sumLitres } from "./status-pill";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardResult, FloorBoardRow } from "@/lib/floor/types";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function istTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
function fmtHistLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WD[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
}
function asStr(v: string | Date | null): string | null {
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return null;
}
function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}
const sort = (rows: FloorBoardRow[]) => sortPickingQueue(rows) as FloorBoardRow[];

export function FloorBoard({
  floor,
  slotTab,
  onSlotTab,
  mode,
  histDate,
  onEnterHistory,
  onExitHistory,
  onStepHistory,
  selection,
  onToggleRow,
  onToggleAll,
  onMarkUrgent,
  onOpenDetail,
}: {
  floor: FloorBoardResult;
  slotTab: SlotTabKey;
  onSlotTab: (key: SlotTabKey) => void;
  mode: "flat" | "route";
  histDate: string | null;
  onEnterHistory: () => void;
  onExitHistory: () => void;
  onStepHistory: (delta: number) => void;
  selection: FloorSelection;
  onToggleRow: (id: number) => void;
  onToggleAll: (rows: FloorBoardRow[]) => void;
  onMarkUrgent: (id: number) => void;
  onOpenDetail: (id: number) => void;
}) {
  const [openBands, setOpenBands] = useState<Record<string, boolean>>({});
  const [openRoute, setOpenRoute] = useState<string | null>(null);

  const isHistory = floor.mode === "history";
  const variant = isHistory ? "history" : "live";
  const rows = floor.rows;
  const nowMs = Date.now();

  // Selection/urgent/detail wiring forwarded to every leaf table (live only —
  // the table ignores them on history/upcoming variants).
  const selProps = { selection, onToggleRow, onToggleAll, onMarkUrgent, onOpenDetail };

  const dueRows = rows.filter((r) => r.zone !== "upcoming");
  const upcomingRows = isHistory ? [] : rows.filter((r) => r.zone === "upcoming");

  // Whole-floor "everything done" (live only): every due bill is pick_checked.
  const allDone = !isHistory && dueRows.length > 0 && dueRows.every((r) => r.isChecked);

  const tabRows = slotTab === "all" ? dueRows : dueRows.filter((r) => r.windowTime === slotTab);
  const carried = isHistory ? [] : tabRows.filter((r) => (r.ageDays ?? 0) > 0);

  const bandOpen = (key: string) => openBands[key] ?? true; // default open (mockup)
  const toggleBand = (key: string) => setOpenBands((m) => ({ ...m, [key]: !bandOpen(key) }));

  // ── Date bar ────────────────────────────────────────────────────────────
  const yesterdayIso = addDaysIso(istTodayIso(), -1);
  const forwardDisabled = (histDate ?? "") >= yesterdayIso;
  const navCls = "flex h-6 w-6 items-center justify-center rounded-[5px] border border-gray-200 bg-white text-gray-500 disabled:opacity-40";

  const dateBar = isHistory ? (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-[#f9fafb] px-3.5 py-[7px] text-[11.5px]">
      <button type="button" className={navCls} onClick={() => onStepHistory(-1)}>
        ‹
      </button>
      <span className="font-semibold">{histDate ? fmtHistLabel(histDate) : ""}</span>
      <button type="button" className={navCls} disabled={forwardDisabled} onClick={() => !forwardDisabled && onStepHistory(1)}>
        ›
      </button>
      <span className="ml-2 text-[10.5px] text-gray-400">past day — read only</span>
      <button type="button" className="ml-auto text-[10.5px] font-semibold text-teal-600" onClick={onExitHistory}>
        Back to Live ›
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-[#fcfcfd] px-3.5 py-[7px] text-[11.5px]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#10b981]" />
      <span className="font-semibold">Live</span>
      <span className="text-[10.5px] text-gray-400">everything not yet checked, whenever it was due</span>
      <button type="button" className="ml-auto text-[10.5px] font-semibold text-teal-600" onClick={onEnterHistory}>
        History ›
      </button>
    </div>
  );

  // ── Body ────────────────────────────────────────────────────────────────
  let body: ReactNode;

  if (allDone) {
    const litres = sumLitres(dueRows);
    const lastMs = Math.max(...dueRows.map((r) => { const s = asStr(r.checkedAt); return s ? new Date(s).getTime() : 0; }));
    body = (
      <div className="px-5 py-14 text-center">
        <div className="text-[28px] leading-none text-[#22c55e]">✓</div>
        <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Everything on the floor is done.</h4>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
          {dueRows.length} bills · {litres} L · all checked.
          {lastMs > 0 && (
            <>
              <br />
              Last one closed at {hhmm(lastMs)}.
            </>
          )}
        </p>
      </div>
    );
  } else if (dueRows.length === 0) {
    body = (
      <div className="px-5 py-14 text-center">
        <div className="text-[28px] leading-none text-gray-300">○</div>
        <h4 className="mt-2 text-[13px] font-semibold text-gray-900">
          {isHistory ? `Nothing was dispatched for ${histDate ? fmtHistLabel(histDate) : "that day"}` : "Nothing on the floor yet"}
        </h4>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
          {isHistory ? "No bill carried a dispatch slot for this day." : "Released bills appear here and update themselves as they're picked."}
        </p>
      </div>
    );
  } else if (slotTab === "all") {
    const noSlot = sort(dueRows.filter((r) => r.windowId === null));
    body = (
      <>
        {carried.length > 0 && <CarryoverBanner rows={carried} />}
        {floor.windows.map((w) => {
          const g = sort(dueRows.filter((r) => r.windowId === w.id));
          if (g.length === 0) return null;
          return (
            <SlotBand
              key={w.id}
              label={w.windowTime}
              rows={g}
              nowMs={nowMs}
              open={bandOpen(w.windowTime)}
              onToggle={() => toggleBand(w.windowTime)}
              variant={variant}
              {...selProps}
            />
          );
        })}
        {noSlot.length > 0 && (
          <SlotBand label="No slot" rows={noSlot} nowMs={nowMs} open={bandOpen("No slot")} onToggle={() => toggleBand("No slot")} variant={variant} {...selProps} />
        )}
      </>
    );
  } else if (mode === "route") {
    // Group by route, worst-first (least complete on top, larger on tie) — §7.2.
    const map = new Map<string, FloorBoardRow[]>();
    for (const r of tabRows) {
      const k = r.route ?? "No route";
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    const groups = Array.from(map.entries()).sort((a, b) => {
      const ca = countByStatus(a[1]);
      const cb = countByStatus(b[1]);
      const pa = ca.total ? ca.done / ca.total : 1;
      const pb = cb.total ? cb.done / cb.total : 1;
      if (pa !== pb) return pa - pb;
      return b[1].length - a[1].length;
    });
    body = (
      <>
        {carried.length > 0 && <CarryoverBanner rows={carried} />}
        {groups.map(([name, gr]) => (
          <RouteRow
            key={name}
            name={name}
            rows={sort(gr)}
            nowMs={nowMs}
            open={openRoute === name}
            onToggle={() => setOpenRoute((cur) => (cur === name ? null : name))}
            variant={variant}
            {...selProps}
          />
        ))}
      </>
    );
  } else {
    body = (
      <>
        {carried.length > 0 && <CarryoverBanner rows={carried} />}
        <FloorTable rows={sort(tabRows)} nowMs={nowMs} variant={variant} {...selProps} />
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dateBar}
      <FloorTabs windows={floor.windows} dueRows={dueRows} active={slotTab} onSelect={onSlotTab} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {body}
        {!allDone && upcomingRows.length > 0 && <UpcomingStrip rows={sort(upcomingRows)} nowMs={nowMs} />}
      </div>
    </div>
  );
}
