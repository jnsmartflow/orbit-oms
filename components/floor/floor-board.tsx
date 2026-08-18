"use client";

// Floor Control — the right pane below the Floor/On-hold/Cancelled tabs.
// Read-only this step. Composes: Live/History date bar → slot tabs → body
// (flat table · slot bands on All · route rows on By-route) → Upcoming strip,
// plus the carry-over banner and the day-finished / empty states.
//
// The spine (lib/picking/sort.ts) is REUSED, never copied, and applied to the
// LEAF group on screen (design §7.9): inside each slot band on All, across the
// cutoff on a flat slot tab, inside each route on By-route.

import { useEffect, useState, type ReactNode } from "react";
import { sortPickingQueue } from "@/lib/picking/sort";
import { FLOOR_SPINE } from "@/lib/floor/sort";
import { FloorTabs, type SlotTabKey } from "./floor-tabs";
import { FloorTable } from "./floor-table";
import { SlotBand } from "./slot-band";
import { RouteRow } from "./route-row";
import { GroupRow } from "./group-row";
import { PickerCard, pickerCardStatus } from "./picker-card";
import { buildPickGroups, buildOilGroups } from "@/lib/floor/grouping";
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
  assignContextName,
  contextMode,
  onPickPicker,
  onAssignGroup,
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
  mode: "flat" | "route" | "picker" | "group";
  // Assign context (2026-08-11) — the picker the operator drilled into from the
  // By-picker grid, or null for the ordinary board. null is the untouched path:
  // every derivation below short-circuits to exactly what it did before.
  assignContext: number | null;
  /** The context picker's display name, for the By-group header button. */
  assignContextName: string | null;
  contextMode: "pending" | "current";
  /** One-press assign of a whole bundle. Only wired in group mode, and only
   *  offered when there IS a context picker to assign to. */
  onAssignGroup: (orderIds: number[], pickerId: number) => void;
  // Fired by a picker card. floor-page owns what it means (set context, switch
  // to By route) — this component only reports the tap, plus which reading to
  // open on. `initialMode` is derived from pickerCardStatus(), the SAME rule
  // that already picked the card's colour: a picker holding bills opens on what
  // is in his hands, a free one on what he could be given. Since that rule now
  // keys on `withPicker` ALONE, a picker with only needs-check bills is Free and
  // lands on "pending" — which is the useful answer: his hands are empty.
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
  // By-group expand state — a SET OF MAIN BILL orderIds, not row indices.
  //
  // ⚠ THIS IS THE REFRESH MITIGATION, and it is why the key matters. With no
  // selection and no panel open there is no pause rule (CLAUDE_FLOOR §5), so a
  // 15s marker change re-runs load() and re-renders the bundles. The engine is
  // deterministic, but its INPUT changes whenever any bill moves, so bundles can
  // reorder. Keying on position ("index 0 is open") would silently move the open
  // group to whatever floated to the top; keying on the main bill's orderId
  // keeps the operator looking at the bundle he was actually reading.
  //
  //   null           = not seeded yet for this visit to group mode
  //   Set(mainIds)   = exactly these are expanded
  //
  // A group whose main is gone simply disappears — no placeholder, no toast; a
  // bill leaving the board is correct behaviour and must stay visible as such.
  // Genuinely new bundles arrive collapsed because their id is not in the set.
  // NOT one-open-at-a-time like the route rows: a bundle is a short list the
  // operator compares against others, so closing one to open the next fights him.
  const [openMains, setOpenMains] = useState<Set<number> | null>(null);

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
  // THE waiting slice — nobody's yet, which is exactly the set that can be
  // handed to somebody. ONE declaration, read by BOTH the assign context's
  // pending reading and the By-group view, so the two surfaces can never answer
  // "what is waiting" differently.
  const waitingRows = dueRows.filter((r) => rowStatus(r) === "waiting");
  const viewRows = !inContext
    ? dueRows
    : contextPending
      ? waitingRows
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
  //
  // By group hides them for a DIFFERENT and stronger reason: grouping spans slots
  // and dates on purpose, so a slot filter would cut most bundles in half. There
  // is no date or slot term anywhere in that view — the header strip below says
  // so in plain English, and each row carries its own Slot column instead.
  const showSlotTabs = mode !== "picker" && mode !== "group" && !(inContext && !contextPending);

  // ── By group — computed ONLY in group mode, so no other view pays for it ────
  //
  // Candidates are the waiting rows above, paired with the distinct skuCodeRaw
  // list the board payload already carries (floor.waitingSkus, built by
  // getFloorBoard from the same predicate). A waiting row with no payload entry
  // gets an empty array and the engine drops it to `ungrouped` — the zero-SKU
  // guard in lib/floor/grouping.ts, which is load-bearing: the empty set is a
  // subset of everything and such a bill would otherwise ride free with anyone.
  const groupData = (() => {
    if (mode !== "group") return null;
    const skusById = new Map(floor.waitingSkus.map((w) => [w.orderId, w.skus] as const));
    const rowById = new Map(waitingRows.map((r) => [r.orderId, r] as const));
    const candidates = waitingRows.map((r) => ({
      orderId: r.orderId,
      obdNumber: r.obdNumber,
      skus: skusById.get(r.orderId) ?? [],
    }));

    // ⚠️ ORDER OF PLAY, non-negotiable and owned by the engine's contract:
    // Rule 1 runs FIRST over the whole waiting pool, Rule 2 only over what it
    // left. A bill can never be in both, and Rule 1 always wins a contested one.
    const { groups: freeGroups, ungrouped: afterFree } = buildPickGroups(candidates);

    // Rule 2's oil-paint set — the union of the per-bill subsets the board
    // payload already carries. `floor.oilSkus` is an EMPTY ARRAY when
    // RULE2_ENABLED is false (lib/floor/queries.ts), so `oilSkus` is empty, no
    // bill can reach a 50% oil share, and buildOilGroups returns nothing: the
    // whole second half of this view disappears with one const, no branch here.
    const oilSkus = new Set<string>();
    for (const entry of floor.oilSkus) {
      for (const code of entry.skus) oilSkus.add(code);
    }
    // The one client-side signal for "is the trial on". `floor.oilSkus` is []
    // with the flag off and one entry per waiting bill with it on — so a
    // non-empty array can only mean the server ran the fetch. The one overlap
    // (flag ON but not a single waiting bill has an active line) also yields
    // zero groups of EITHER kind, so dropping the clause there says nothing
    // false. Used ONLY to decide whether the header mentions oil at all.
    const rule2On = floor.oilSkus.length > 0;

    const leftover = new Set(afterFree);
    const { groups: oilGroups, ungrouped } = buildOilGroups(
      candidates.filter((c) => leftover.has(c.orderId)),
      oilSkus,
    );

    const skuCountById = new Map(Array.from(skusById.entries()).map(([id, s]) => [id, s.length]));
    return { freeGroups, oilGroups, oilSkus, rule2On, ungrouped, rowById, skuCountById };
  })();

  // Seeding + toggling for the expand set above. Both effects are no-ops outside
  // group mode, so no other view is affected by their presence.
  // The bundle that opens on first entry: the best FREE one, falling back to the
  // best oil one on a day with no free bundles at all. Free first because it is
  // the one that costs the operator nothing — the seed should not teach him to
  // start with the bundle that has a price. Still keyed on a MAIN BILL orderId,
  // which is unique across both kinds (a bill can be in only one group), so the
  // whole persistence mechanism below is unchanged.
  const topGroupId = groupData?.freeGroups[0]?.id ?? groupData?.oilGroups[0]?.id;
  useEffect(() => {
    if (mode !== "group") setOpenMains(null);
  }, [mode]);
  useEffect(() => {
    // First entry to group mode: the top bundle expanded, the rest collapsed.
    if (mode === "group" && openMains === null && topGroupId !== undefined) {
      setOpenMains(new Set([topGroupId]));
    }
  }, [mode, openMains, topGroupId]);

  const groupIsOpen = (id: number) => (openMains === null ? id === topGroupId : openMains.has(id));
  const toggleGroup = (id: number) =>
    setOpenMains((prev) => {
      const base = prev ?? (topGroupId !== undefined ? new Set([topGroupId]) : new Set<number>());
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bandOpen = (key: string) => openBands[key] ?? true; // default open (mockup)
  const toggleBand = (key: string) => setOpenBands((m) => ({ ...m, [key]: !bandOpen(key) }));

  // ── Date bar ────────────────────────────────────────────────────────────
  //
  // Live-strip counts. Deliberately over `dueRows` — the SAME array the Floor
  // tab badge counts (floor-page.tsx derives `total` from it), so the two
  // numbers in the strip always sum to the number in the badge beside them.
  // Upcoming rows are in neither: they are future-dated work with their own
  // strip at the foot of the board.
  //
  // WHY THIS REPLACED A SENTENCE: the strip used to read "everything not yet
  // checked, whenever it was due", which describes only arm 1 of
  // floorLiveBaseWhere (CLAUDE_FLOOR §3). Arm 2 also puts everything CHECKED
  // TODAY on the board — on 2026-08-17 that was 97 of 104 rows — so the copy
  // promised a set roughly a fifteenth the size of the count next to it. The
  // split states both arms instead of describing one.
  //
  // `countByStatus` is the shared helper (status-pill.tsx), not a hand-written
  // stage test: four stage meanings, one owner. Its `done` bucket IS
  // pick_checked, and on the live board a pick_checked row can only be there
  // via arm 2 — i.e. it was checked today — so "checked today" is exact, not an
  // approximation.
  const liveCounts = countByStatus(dueRows);
  const stillOpen = liveCounts.total - liveCounts.done;

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
      <span className="text-[10.5px] text-gray-400">
        {stillOpen} still open &middot; {liveCounts.done} checked today
      </span>
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
            // ⚠ THE STATS ARE `held`, NOT `g.rows` (2026-08-15). Everything the
            // card states as a NUMBER — picks, litres, articles, routes — is his
            // current physical workload, so it must come from withPicker rows
            // alone. g.rows also carries bills he has already put down
            // (needsCheck, awaiting a supervisor) and finished ones (done);
            // counting either inflates an idle picker into a loaded one, the
            // same defect the STATUS colour was fixed for a round earlier.
            // `counts` still spans all his rows on purpose: it feeds the
            // four-segment bar and the "{n} to check" tag, which are the one
            // place that pile is allowed to appear.
            const held = g.rows.filter((r) => rowStatus(r) === "withPicker");
            const oldestMinutes = oldestWithPickerMinutes(g.rows, nowMs);
            const status = pickerCardStatus(counts, oldestMinutes);
            return (
              <PickerCard
                key={g.pickerId}
                name={g.name}
                counts={counts}
                litres={sumLitres(held)}
                articles={formatArticleBreakdown(held.map((r) => r.articleTag))}
                routes={distinctRoutes(held)}
                oldestMinutes={oldestMinutes}
                onClick={() => onPickPicker(g.pickerId, status === "free" ? "pending" : "current")}
              />
            );
          })}
        </div>
      );
  } else if (mode === "group" && groupData) {
    // ⚠ SITS ABOVE the `slotTab === "all"` check, for the same reason the picker
    // grid does: switching slot tabs must not change these bundles at all.
    // Search and filter DO still apply (waitingRows descends from the filtered
    // set) — those narrow "which bills are we talking about", a fair question to
    // ask of a bundle; the slot tab narrows "which window", which is the one
    // question grouping exists to ignore.
    // `oilSkus` is deliberately NOT taken here any more — the oil row no longer
    // needs the set (its only consumer was the removed per-step arithmetic). It
    // still lives on groupData for the engine call above.
    const { freeGroups, oilGroups, ungrouped, rowById, skuCountById } = groupData;
    const ungroupedRows = ungrouped
      .map((id) => rowById.get(id))
      .filter((r): r is FloorBoardRow => r !== undefined);

    // Rule 1: main first, then riders in the engine's order.
    // Rule 2: the members in the engine's packing order — no main, no riders.
    const rowsFor = (ids: { orderId: number }[]) =>
      ids.map((m) => rowById.get(m.orderId)).filter((r): r is FloorBoardRow => r !== undefined);

    // Present only when a picker is already chosen. Without one the header
    // button stays "Select all {n}" and the assign bar does the assigning,
    // exactly as before. Identical for both kinds — no new write path.
    const groupAssignTo =
      assignContext !== null && assignContextName
        ? { id: assignContext, name: assignContextName }
        : null;

    body =
      waitingRows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <div className="text-[28px] leading-none text-gray-300">○</div>
          <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Nothing waiting to group</h4>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
            Every bill on the floor is already with someone. Release more from the rail, or check
            back after the next import.
          </p>
        </div>
      ) : (
        <>
          {/* ORDER ON SCREEN — free bundles, then oil paint bundles, then the
              bills that ride with nobody. Within each kind the engine's own
              order is kept untouched (best-first by its own arithmetic).
              Free leads because it is unconditionally the better deal: the
              operator should exhaust the ones that cost him nothing before he
              is asked to weigh one that does. */}
          {freeGroups.map((g) => {
            const members = rowsFor([g.main, ...g.riders]);
            if (members.length === 0) return null;
            return (
              <GroupRow
                key={g.id}
                variant="free"
                group={g}
                rows={members}
                skuCountById={skuCountById}
                nowMs={nowMs}
                open={groupIsOpen(g.id)}
                onToggle={() => toggleGroup(g.id)}
                tableVariant={variant}
                assignTo={groupAssignTo}
                onAssignGroup={onAssignGroup}
                {...selProps}
              />
            );
          })}

          {/* Oil paint bundles. Empty array when RULE2_ENABLED is false, so this
              renders NOTHING — no header, no divider, no spacing: with the flag
              off the screen is byte-identical to what it is today. */}
          {oilGroups.map((g) => {
            const members = rowsFor(g.members);
            if (members.length === 0) return null;
            return (
              <GroupRow
                key={g.id}
                variant="oil"
                group={g}
                rows={members}
                skuCountById={skuCountById}
                nowMs={nowMs}
                open={groupIsOpen(g.id)}
                onToggle={() => toggleGroup(g.id)}
                tableVariant={variant}
                assignTo={groupAssignTo}
                onAssignGroup={onAssignGroup}
                {...selProps}
              />
            );
          })}

          {ungroupedRows.length > 0 && (
            <>
              {/* Not hidden, not dimmed — these are ordinary waiting bills that
                  simply share nothing, and the operator still has to send them. */}
              <div className="border-b border-[#f0f0f0] bg-[#fafafa] px-3.5 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#6b7280]">
                  SINGLE PICKS &middot; {ungroupedRows.length} bill{ungroupedRows.length === 1 ? "" : "s"}
                </div>
                <div className="text-[10.5px] text-gray-400">
                  Nothing else waiting shares their items
                </div>
              </div>
              <FloorTable rows={ungroupedRows} nowMs={nowMs} variant={variant} showSlot {...selProps} />
            </>
          )}
        </>
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

      {/* By group — the strip that stands where the slot tabs would be. It has
          one job: say out loud that this view is waiting-only and slot-blind,
          because both of those look like bugs to anyone who has not been told. */}
      {mode === "group" && groupData && (
        <div className="border-b border-gray-200 bg-[#fcfcfd] px-3.5 py-2.5">
          <div className="text-[11.5px] text-gray-700">
            Waiting only &mdash; bills with no picker yet, grouped so one man fetches once
          </div>
          {/* THE COUNT LINE — the same three words as the pills and the ungrouped
              header, so nothing on this screen calls one thing by two names.
              The "mostly same" clause shows even at ZERO: it teaches the operator
              that a second kind exists on the days it produces none, which is
              most days, rather than letting him meet it by surprise on the one
              day it fires.
              ⚠ WITH RULE2_ENABLED FALSE THE CLAUSE IS DROPPED ENTIRELY, not shown
              as zero — the feature does not exist then, and naming something that
              cannot appear is worse than saying nothing. This used to revert the
              WHOLE line to the pre-Rule-2 wording ("{g} groups found") to keep a
              flag-off screen byte-identical to old HEAD; that promise is retired,
              because this commit relabels Rule 1's own pill and the ungrouped
              header too, so a flag-off screen is deliberately not the old screen
              any more. What the flag still guarantees is unchanged and is the
              part that matters: no second engine pass, no catalog fetch, no
              groups, no clause. */}
          <div className="mt-0.5 text-[11.5px] font-semibold text-gray-900">
            {waitingRows.length} waiting &middot; {groupData.freeGroups.length} same material
            {groupData.rule2On && <> &middot; {groupData.oilGroups.length} mostly same</>}
          </div>
          <p className="mt-1.5 max-w-[760px] text-[10.5px] leading-relaxed text-gray-400">
            All dispatch times together. Grouping ignores the slot on purpose &mdash; an evening bill
            needing the same material is fetched now, while the picker is already at that shelf.
            Each row still shows its own time.
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {body}
        {/* No Upcoming strip under the picker grid: an upcoming bill is unassigned
            by definition, so it belongs to nobody and would read as a fifth
            un-owned card's worth of work hanging off the bottom of a roster.
            Suppressed under By group for the opposite reason — that view states
            it ignores dispatch dates, and a future-dated strip contradicts it. */}
        {!allDone && mode !== "picker" && mode !== "group" && upcomingRows.length > 0 && (
          <UpcomingStrip rows={sort(upcomingRows)} nowMs={nowMs} />
        )}
      </div>
    </div>
  );
}
