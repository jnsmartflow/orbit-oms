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
import { FLOOR_SPINE } from "@/lib/floor/sort";
import { FloorTabs, type SlotTabKey } from "./floor-tabs";
import { FloorTable } from "./floor-table";
import { SlotBand } from "./slot-band";
import { RouteRow } from "./route-row";
import { PickerCard, pickerCardStatus } from "./picker-card";
import { formatArticleBreakdown } from "@/lib/floor/format";
import { CarryoverBanner } from "./carryover-banner";
import { UpcomingStrip } from "./upcoming-strip";
import { countByStatus, rowStatus, sumLitres } from "./status-pill";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardResult, FloorBoardRow, FloorPicker } from "@/lib/floor/types";

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
const sort = (rows: FloorBoardRow[]) => sortPickingQueue(rows, FLOOR_SPINE) as FloorBoardRow[];

// ── By picker — grouping + per-picker arithmetic ─────────────────────────────
//
// One entry per ACTIVE picker, plus a trailing entry for any picker who holds
// rows but is no longer on the roster (deactivated mid-shift) — his bills must
// never become invisible just because his account was switched off.
//
// ORDER IS FIXED (roster order, which the server already returns name-ascending,
// then orphans by name). Deliberately NOT worst-first like the route groups:
// Floor drops `byAssigned` from FLOOR_SPINE precisely so rows hold their place
// instead of jumping when their status changes (CLAUDE_FLOOR §3), and a grid of
// cards that re-sorts itself the moment a timer crosses 30m is that same defect
// at card scale — the operator loses the person he was looking at.
interface PickerGroup {
  pickerId: number;
  name: string;
  rows: FloorBoardRow[];
}

function buildPickerGroups(rows: FloorBoardRow[], pickers: FloorPicker[]): PickerGroup[] {
  const byPickerId = new Map<number, FloorBoardRow[]>();
  for (const r of rows) {
    // A Waiting row has no pick_assignments row at all, so pickerId is null and
    // it belongs to nobody. It is counted by the slot/route views, not here.
    if (r.pickerId === null) continue;
    const arr = byPickerId.get(r.pickerId) ?? [];
    arr.push(r);
    byPickerId.set(r.pickerId, arr);
  }

  // Roster first — seeded even at zero rows, so a picker with nothing on him
  // shows a "Free" card rather than silently missing from the grid.
  const groups: PickerGroup[] = pickers.map((p) => ({
    pickerId: p.id,
    name: p.name,
    rows: byPickerId.get(p.id) ?? [],
  }));

  // Orphans — a pickerId carrying rows that the active roster does not list.
  const rostered = new Set(pickers.map((p) => p.id));
  const orphans: PickerGroup[] = [];
  for (const [pickerId, gr] of Array.from(byPickerId.entries())) {
    if (rostered.has(pickerId)) continue;
    orphans.push({
      pickerId,
      name: gr.find((r) => r.assignedToName)?.assignedToName ?? `Picker #${pickerId}`,
      rows: gr,
    });
  }
  orphans.sort((a, b) => a.name.localeCompare(b.name, "en"));

  return [...groups, ...orphans];
}

/** Minutes since the OLDEST assignment this picker is STILL holding.
 *  withPicker rows only — a bill he has already marked done stopped being his
 *  clock the moment he put it down. null when he is holding nothing. */
function oldestWithPickerMinutes(rows: FloorBoardRow[], nowMs: number): number | null {
  let oldest: number | null = null;
  for (const r of rows) {
    if (rowStatus(r) !== "withPicker") continue;
    const iso = asStr(r.assignedAt);
    if (!iso) continue;
    const at = new Date(iso).getTime();
    if (Number.isNaN(at)) continue;
    const mins = Math.max(0, Math.floor((nowMs - at) / 60000));
    if (oldest === null || mins > oldest) oldest = mins;
  }
  return oldest;
}

function distinctRoutes(rows: FloorBoardRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.route) set.add(r.route);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "en"));
}

export function FloorBoard({
  floor,
  pickers,
  slotTab,
  onSlotTab,
  mode,
  assignContext,
  contextMode,
  onPickPicker,
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
  // Active picker roster — the By-picker grid seeds from this so a picker with
  // zero rows still gets a "Free" card. Scope-independent (getFloorPickers has
  // no delivery-type filter), so the page passes the unscoped list.
  pickers: FloorPicker[];
  slotTab: SlotTabKey;
  onSlotTab: (key: SlotTabKey) => void;
  mode: "flat" | "route" | "picker";
  // Assign context (2026-08-11) — the picker the operator drilled into from the
  // By-picker grid, or null for the ordinary board. null is the untouched path:
  // every derivation below short-circuits to exactly what it did before.
  assignContext: number | null;
  contextMode: "pending" | "current";
  // Fired by a picker card. floor-page owns what it means (set context, switch
  // to By route) — this component only reports the tap, plus which reading to
  // open on. `initialMode` is derived from pickerCardStatus(), the SAME rule
  // that already picked the card's colour: a busy or checking picker opens on
  // what he is holding, a free one on what he could be given.
  onPickPicker: (pickerId: number, initialMode: "pending" | "current") => void;
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

  const dueRows = rows.filter((r) => r.zone !== "upcoming");
  // ── Assign context — the ONE place the board narrows to a single picker ────
  //
  // `assignContext === null` is the ordinary board and is short-circuited on the
  // first line: `viewRows` IS `dueRows`, so Flat, By route, the slot bands and
  // every count below behave exactly as they did before this existed.
  //
  // Membership uses rowStatus() (status-pill.tsx) rather than a hand-written
  // stage test, for the same reason the picker cards do: four stage meanings,
  // one owner.
  //   pending → status "waiting" (= pending_picking): nobody's yet, which is
  //             precisely the set the operator is deciding to hand over.
  //   current → this picker's rows that are still live work. Done/checked bills
  //             are excluded: they are his history, not what is in his hands.
  const inContext = assignContext !== null;
  const contextPending = inContext && contextMode === "pending";
  const viewRows = !inContext
    ? dueRows
    : contextPending
      ? dueRows.filter((r) => rowStatus(r) === "waiting")
      : dueRows.filter((r) => {
          if (r.pickerId !== assignContext) return false;
          const st = rowStatus(r);
          return st === "withPicker" || st === "needsCheck";
        });

  // Selection/urgent/detail wiring forwarded to every leaf table (live only —
  // the table ignores them on history/upcoming variants).
  //
  // The "what he's holding" reading drops onToggleRow/onToggleAll/selection, and
  // that ALONE makes the table read-only: floor-table's `interactive` now also
  // tests for a wired onToggleRow, so no checkbox column and no `#` column
  // render. ⚡ and ⋯ stay passed so neither becomes a dead button — "read only"
  // here means "you cannot select and assign from this list", not "no controls".
  const selProps =
    inContext && !contextPending
      ? { onMarkUrgent, onOpenDetail }
      : { selection, onToggleRow, onToggleAll, onMarkUrgent, onOpenDetail };

  // Upcoming is unassigned future-dated work — it belongs to no picker and is
  // not part of either context reading, so the strip is suppressed there.
  const upcomingRows = isHistory || inContext ? [] : rows.filter((r) => r.zone === "upcoming");

  // Whole-floor "everything done" (live only): every due bill is pick_checked.
  // Suppressed in context: that celebration is a statement about the WHOLE
  // floor, and it would hijack a view that was asked a narrower question.
  const allDone = !isHistory && !inContext && dueRows.length > 0 && dueRows.every((r) => r.isChecked);

  const tabRows = slotTab === "all" ? viewRows : viewRows.filter((r) => r.windowTime === slotTab);
  // The same slice WITHOUT the context's status filter. Outside context it is
  // identical to tabRows (viewRows IS dueRows there). In the pending view it is
  // the route UNIVERSE: By-route lists every route on the tab, each carrying its
  // real progress, and only the rows inside a route narrow to waiting.
  const tabRowsAll = slotTab === "all" ? dueRows : dueRows.filter((r) => r.windowTime === slotTab);
  const carried = isHistory ? [] : tabRows.filter((r) => (r.ageDays ?? 0) > 0);

  // The slot tab is meaningless in the two PERSON-scoped views — the picker grid
  // shows each picker's whole load, and "what he's holding" is everything in his
  // hands whatever window it is due. Hide the tabs there rather than leave a
  // control that filters nothing. (The picker grid rendered them dead until now.)
  const showSlotTabs = mode !== "picker" && !(inContext && !contextPending);

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

  if (mode === "picker") {
    // ⚠ THE ONE VIEW THAT IGNORES THE SLOT TAB — deliberate, not an oversight.
    // Reads `dueRows`, NOT `tabRows`. A picker does not work one dispatch window
    // at a time; his card has to show his whole load or it understates what is
    // on him. That is also why this branch sits ABOVE the `slotTab === "all"`
    // check below: switching slot tabs must not change these cards at all.
    // Search and filter DO still apply (dueRows comes from the filtered set) —
    // those narrow "which bills are we talking about", which is a real question
    // to ask of a picker; the slot tab narrows "which window", which is not.
    const groups = buildPickerGroups(dueRows, pickers);
    body =
      groups.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <div className="text-[28px] leading-none text-gray-300">○</div>
          <h4 className="mt-2 text-[13px] font-semibold text-gray-900">No active pickers</h4>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
            Nobody holds the picker role right now, so there is nothing to show here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 p-4">
          {groups.map((g) => {
            // Computed ONCE per group: the card renders from these and the
            // click derives its landing view from the same status, so the
            // colour the operator tapped and the list he lands on can never
            // tell him different things.
            const counts = countByStatus(g.rows);
            const oldestMinutes = oldestWithPickerMinutes(g.rows, nowMs);
            const status = pickerCardStatus(counts, oldestMinutes);
            return (
              <PickerCard
                key={g.pickerId}
                name={g.name}
                counts={counts}
                litres={sumLitres(g.rows)}
                articles={formatArticleBreakdown(g.rows.map((r) => r.articleTag))}
                routes={distinctRoutes(g.rows)}
                oldestMinutes={oldestMinutes}
                onClick={() => onPickPicker(g.pickerId, status === "free" ? "pending" : "current")}
              />
            );
          })}
        </div>
      );
  } else if (allDone) {
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
  } else if (viewRows.length === 0) {
    // In context the empty state describes the CONTEXT's question, not the
    // floor's — "Nothing on the floor yet" would be a lie with 30 bills sitting
    // under other pickers. The banner above already names the person.
    const heading = inContext
      ? contextPending
        ? "Nothing waiting to hand over"
        : "Nothing in this picker's hands"
      : isHistory
        ? `Nothing was dispatched for ${histDate ? fmtHistLabel(histDate) : "that day"}`
        : "Nothing on the floor yet";
    const detail = inContext
      ? contextPending
        ? "Every bill on the floor is already with someone. Release more from the rail, or check back after the next import."
        : "Nothing is currently being picked or waiting to be checked by this picker."
      : isHistory
        ? "No bill carried a dispatch slot for this day."
        : "Released bills appear here and update themselves as they're picked.";
    body = (
      <div className="px-5 py-14 text-center">
        <div className="text-[28px] leading-none text-gray-300">○</div>
        <h4 className="mt-2 text-[13px] font-semibold text-gray-900">{heading}</h4>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">{detail}</p>
      </div>
    );
  } else if (inContext && !contextPending) {
    // "What he's holding" is ALWAYS the flat table, whatever the Flat/By route
    // toggle says: it is one person's short list, and route blocks would add a
    // layer of chrome over three rows. It also ignores the slot tab (the tabs
    // are hidden above) — his load is a property of him, not of a window, and
    // the banner's count is floor-wide, so slot-filtering here would make the
    // two disagree.
    body = <FloorTable rows={sort(viewRows)} nowMs={nowMs} variant={variant} {...selProps} />;
  } else if (slotTab === "all") {
    const noSlot = sort(viewRows.filter((r) => r.windowId === null));
    body = (
      <>
        {carried.length > 0 && <CarryoverBanner rows={carried} />}
        {floor.windows.map((w) => {
          const g = sort(viewRows.filter((r) => r.windowId === w.id));
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
    //
    // Grouped over tabRowsAll, NOT tabRows: outside context they are the same
    // array, and in the pending view this is what keeps every route on screen.
    // A route whose waiting pile is empty is a real answer ("Adajan is covered")
    // and dropping it would silently shorten the operator's map of the floor.
    const map = new Map<string, FloorBoardRow[]>();
    for (const r of tabRowsAll) {
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
            // Outside context these are the same rows, so `listRows` is a
            // no-op; in the pending view the bar summarises the whole route
            // while the table lists only what can be handed over.
            listRows={inContext && contextPending ? sort(gr.filter((r) => rowStatus(r) === "waiting")) : undefined}
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
      {/* Counts follow `viewRows`, so a slot tab reading "12" in context opens
          to 12 rows. Outside context viewRows IS dueRows — unchanged. Hidden
          entirely in the two person-scoped views (see showSlotTabs above). */}
      {showSlotTabs && <FloorTabs windows={floor.windows} dueRows={viewRows} active={slotTab} onSelect={onSlotTab} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {body}
        {/* No Upcoming strip under the picker grid: an upcoming bill is unassigned
            by definition, so it belongs to nobody and would read as a fifth
            un-owned card's worth of work hanging off the bottom of a roster. */}
        {!allDone && mode !== "picker" && upcomingRows.length > 0 && <UpcomingStrip rows={sort(upcomingRows)} nowMs={nowMs} />}
      </div>
    </div>
  );
}
