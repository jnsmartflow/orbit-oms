"use client";

// Floor Control — the detail panel (design §10, mockup 02-detail-panel.html).
// 472px, slides from the right. Opens from any row or card, in any tab.
//
// Four zones, three fixed (design §10.2): 3-line header · action row · tabs |
// SCROLLING body | prev/next. The context-primary action changes with the SOURCE
// the panel was opened from (design §10.3); Change ship-to and Update slot never
// move so his hand learns one place.
//
// REUSE, never fork:
//   - Change ship-to → components/floor/ship-to-editor.tsx (GET
//     /api/floor/ship-to-search, its default) + the override write on POST
//     /api/floor/ship-to. Both are Floor's own as of the Support retirement
//     step 2/8; neither uses $transaction. The editor is shared with the Tint
//     Manager since 2026-10-01 (it passes its own search route).
//   - Update slot / release → components/floor/dispatch-slot-picker.tsx +
//     the existing /api/floor routes.
// Every write goes through floor-page's reportWrite() handlers, so a failure
// surfaces — never a swallowed response.

import { useState, useEffect, useCallback, useRef } from "react";
import { Building2, Truck, X } from "lucide-react";
// TINT / BASE -- one owner for the word (components/picking/card-atoms.tsx).
import { ColourWorkBadge } from "@/components/picking/card-atoms";
import { HandBadge } from "@/components/shared/hand-badge";
import type { DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import { SlotPickerButton } from "@/components/floor/slot-picker-button";
import { ShipToEditor } from "@/components/floor/ship-to-editor";
import { TINT_ROOM_REFUSAL } from "@/lib/floor/off-floor";
import { DetailItems } from "./detail-items";
import { DetailDetails } from "./detail-details";
import { DetailActivity } from "./detail-activity";
import { ON_HOLD_PILL_CLS } from "./status-pill";
import {
  DuplicateSoTag,
  DUP_SO_SOFT_BAR,
  DUP_SO_SOFT_SURFACE,
} from "@/components/shared/duplicate-so-tag";
import type { FloorDetail, FloorDetailSource, FloorPicker } from "@/lib/floor/types";

// The slot-chip / Release launcher is components/floor/slot-picker-button.tsx
// since 2026-10-01 (Tint Manager tabs build step 7) — this file's private copy
// was moved there and is imported below; the Tint Manager uses the same one.

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="shrink-0 text-gray-400">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-gray-400">
      <path d="M16 3l5 5L8 21H3v-5L16 3z" />
    </svg>
  );
}

type Tab = "items" | "details" | "activity";

// Action handlers — each does the write + reportWrite + board reload inside
// floor-page; the panel just calls the right one per source, then refetches.
export interface DetailActions {
  onRelease: (orderId: number, date: string, windowId: number) => Promise<void>;
  onChangeShipTo: (orderId: number, customerId: number) => Promise<void>;
  onUpdateSlot: (orderId: number, date: string, windowId: number) => Promise<void>;
  onReassign: (orderId: number, pickerId: number) => Promise<void>;
  onRestore: (orderId: number) => Promise<void>;
  onHold: (orderId: number) => Promise<void>;
  onCancel: (orderId: number) => Promise<void>;
  onUnassign: (orderId: number) => Promise<void>;
  /** Hand (dealer collects) on / off — POST /api/floor/actions hand | unhand. */
  onHand: (orderId: number, set: boolean) => Promise<void>;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", " ·");
}

/** Direct Loading's header pill (2026-10-03) — the `direct` ink token, the time
 *  in the board's own Done format (24h IST, floor-table.tsx `hhmm`). Asked by
 *  BOTH the history and the floor branches below, before their Done arm. */
function directLoadedStatus(d: FloorDetail): { label: string; cls: string; truck: true } | null {
  if (!d.isChecked || d.isDispatched || d.directLoadedAt === null) return null;
  const t = new Date(d.directLoadedAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
  return { label: `Direct Loading · ${t}`, cls: "bg-direct text-direct-text", truck: true };
}

function headerStatus(
  d: FloorDetail,
  source: FloorDetailSource,
): { label: string; cls: string; truck?: true } {
  // HISTORY FIRST, and specifically ABOVE the `d.dispatchStatus === "hold"`
  // line below — that term reads the bill's CURRENT status, so without this a
  // bill put on hold last week would render "On hold" inside the record of a
  // day on which it was picked and checked. A past day's header must describe
  // what happened THAT DAY, from the work facts (isChecked / isDone /
  // isAssigned), and must never be rewritten by something that happened after.
  //
  // Same rule already canonised for the Billing day-record in
  // lib/billing/picking-where.ts ("a later hold must not retroactively erase
  // the fact that the bill was checked that day"). The labels deliberately
  // match the `"floor"` ladder below so one bill reads the same in both views.
  //
  // The stage facts themselves are safe to read here, but the SET IS WIDER THAN
  // IT WAS (corrected 2026-09-11). This comment used to say the history
  // predicate "admits only PICKING_ACTIVE_STAGES, so a row that reaches this
  // panel is at pending_picking / pick_assigned / pick_done / pick_checked" and
  // that `pick_checked` is terminal. Both halves are now wrong: history reads
  // FLOOR_HISTORY_STAGES (lib/floor/queries.ts), which spreads that array and
  // adds `dispatched` — so a fifth stage reaches this panel and it, not
  // `pick_checked`, is the terminal one. Still never cancelled.
  //
  // 🔴 THE DISPATCHED TEST COMES FIRST, for the same reason it does in
  // rowStatus: getFloorBoard sets `isChecked` true for a shipped bill too (it
  // was checked on its way out), so a checked-first order would label every
  // shipped bill "Done" and this arm would never run.
  if (source === "history") {
    if (d.isDispatched) return { label: "Dispatched", cls: "bg-[#e2e8f0] text-[#334155]" };
    const direct = directLoadedStatus(d);
    if (direct) return direct;
    if (d.isChecked) return { label: "Done", cls: "bg-[#dcfce7] text-[#15803d]" };
    if (d.isDone) return { label: "Needs check", cls: "bg-[#fef3c7] text-[#b45309]" };
    if (d.isAssigned) return { label: "With picker", cls: "bg-tint-bg text-tint-700" };
    return { label: "Not completed", cls: "bg-[#f3f4f6] text-[#6b7280]" };
  }
  if (source === "cancelled") return { label: "Cancelled", cls: "bg-[#fef2f2] text-[#b91c1c]" };
  if (source === "hold" || d.dispatchStatus === "hold") return { label: "On hold", cls: ON_HOLD_PILL_CLS };
  if (source === "floor") {
    const direct = directLoadedStatus(d);
    if (direct) return direct;
    if (d.isChecked) return { label: "Done", cls: "bg-[#dcfce7] text-[#15803d]" };
    if (d.isDone) return { label: "Needs check", cls: "bg-[#fef3c7] text-[#b45309]" };
    if (d.isAssigned) return { label: "With picker", cls: "bg-tint-bg text-tint-700" };
    return { label: "Waiting", cls: "bg-[#f3f4f6] text-[#6b7280]" };
  }
  // rail
  if (d.workflowStage === "pending_tint_assignment") return { label: "Tint · Pending", cls: "bg-tint-bg text-tint-700" };
  if (d.workflowStage === "tint_assigned") return { label: "Tint · Assigned", cls: "bg-tint-bg text-tint-700" };
  if (d.workflowStage === "tinting_in_progress") return { label: "Tint · Mixing", cls: "bg-tint-bg text-tint-700" };
  return { label: "Waiting for you", cls: "bg-[#f3f4f6] text-[#6b7280]" };
}

export function DetailPanel({
  orderId,
  source,
  hasDuplicateSo = false,
  withBillingCiNumber = null,
  isHand = false,
  canEdit = false,
  list,
  windows,
  pickers,
  actions,
  onClose,
  onNavigate,
  changeSignal,
}: {
  orderId: number;
  source: FloorDetailSource;
  /**
   * Passed DOWN from the already-loaded board row (floor-page.tsx) — NOT
   * fetched. `/api/floor/order/[orderId]` deliberately does not carry this
   * field: the boolean already exists on the row the panel was opened from, and
   * adding it to the detail payload would make the same fact answerable from
   * two places that could disagree.
   *
   * False for Hold- and Cancelled-sourced panels — those feeds do not compute
   * the flag at all (known gap, see components/shared/duplicate-so-tag.tsx).
   */
  hasDuplicateSo?: boolean;
  /**
   * Set when this panel was opened on a CI row of the Cancel & CI tab
   * (2026-09-22) — the bill's return is with billing. Restore is replaced by a
   * line saying so; the actions route refuses it anyway. Passed down from the
   * loaded row, like `hasDuplicateSo`.
   */
  withBillingCiNumber?: string | null;
  /**
   * Hand — the dealer collects (2026-09-24). Passed down from the loaded row
   * (board / Hold / Cancel & CI all carry `isHand`), like `hasDuplicateSo`.
   */
  isHand?: boolean;
  /**
   * `floor` canEdit, resolved on the server (app/(floor)/floor/page.tsx).
   * Gates the Hand toggle — HIDDEN without it, never disabled (UI §10).
   */
  canEdit?: boolean;
  list: number[];
  windows: DispatchWindow[];
  pickers: FloorPicker[];
  actions: DetailActions;
  onClose: () => void;
  onNavigate: (orderId: number) => void;
  /**
   * Live feed (7b) only — undefined with the feed off, and then nothing below
   * runs. Bumped by floor-page each time THIS bill shows up in the change feed.
   * The panel re-reads the bill quietly and, only if it really differs from
   * what is on screen, shows a slim "Changed — Reload" bar. It never swaps the
   * data by itself: the operator may be mid-read or mid-action.
   */
  changeSignal?: number;
}) {
  const [detail, setDetail] = useState<FloorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [editingShipTo, setEditingShipTo] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerId, setPickerId] = useState<number | "">("");

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/floor/order/${orderId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setDetail(json.detail as FloorDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  // ── "Changed elsewhere" (live feed 7b) ──────────────────────────────────────
  // A quiet re-read on each signal; the bar shows only when the bill really
  // differs from the one on screen (the panel's own write refetches first, so
  // its echo in the feed compares equal and raises nothing). Cleared whenever
  // the shown bill changes — Reload, a refetch after an action, or Prev/Next.
  const [changedDetail, setChangedDetail] = useState<FloorDetail | null>(null);
  const shownDetailRef = useRef<FloorDetail | null>(detail);
  shownDetailRef.current = detail;
  useEffect(() => {
    setChangedDetail(null);
  }, [orderId, detail]);
  useEffect(() => {
    if (!changeSignal) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/floor/order/${orderId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const fresh = ((await res.json()) as { detail: FloorDetail }).detail;
        if (cancelled || !shownDetailRef.current) return;
        if (JSON.stringify(fresh) !== JSON.stringify(shownDetailRef.current)) setChangedDetail(fresh);
      } catch {
        /* no bar — the next change tries again */
      }
    })();
    return () => {
      cancelled = true;
    };
    // orderId is read, not a trigger: a new bill resets the signal to 0 upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeSignal]);

  // Reset per-bill UI when the panel walks to another bill.
  useEffect(() => {
    setTab("items");
    setEditingShipTo(false);
    setMenuOpen(false);
    setPickerId("");
  }, [orderId]);

  // NOTE: Esc is owned by floor-page (single gated listener — panel-close vs
  // selection-clear); the panel no longer registers its own Esc handler. onClose
  // is still driven by the ✕ button and the backdrop click.

  // Run a write, then refetch this panel's detail (the board reload happens
  // inside the handler). `busy` guards against a double-fire mid-write.
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        await fetchDetail();
      } finally {
        setBusy(false);
      }
    },
    [busy, fetchDetail],
  );

  const index = list.indexOf(orderId);
  const prevId = index > 0 ? list[index - 1] : null;
  const nextId = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

  return (
    <div className="fixed inset-0 z-[110]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-[472px] flex-col bg-white shadow-[-14px_0_40px_rgba(17,24,39,0.10)]">
        {changedDetail && (
          <div role="status" className="flex items-center gap-2 border-b border-gray-200 bg-[#fcfcfd] px-5 py-1.5 text-[11.5px] text-gray-600">
            Changed elsewhere
            <button
              type="button"
              disabled={busy}
              onClick={() => setDetail(changedDetail)}
              className="ml-auto font-semibold text-brand-600 disabled:opacity-40"
            >
              Reload
            </button>
          </div>
        )}
        {loading && !detail ? (
          <div className="flex flex-1 items-center justify-center text-[11.5px] text-gray-400">Loading…</div>
        ) : error && !detail ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-[12px] text-gray-500">Couldn&rsquo;t load this bill. {error}</div>
            <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-[11.5px] text-gray-600">
              Close
            </button>
          </div>
        ) : detail ? (
          <PanelBody
            d={detail}
            source={source}
            hasDuplicateSo={hasDuplicateSo}
            withBillingCiNumber={withBillingCiNumber}
            isHand={isHand}
            canEdit={canEdit}
            tab={tab}
            setTab={setTab}
            windows={windows}
            pickers={pickers}
            actions={actions}
            busy={busy}
            run={run}
            editingShipTo={editingShipTo}
            setEditingShipTo={setEditingShipTo}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            pickerId={pickerId}
            setPickerId={setPickerId}
            onClose={onClose}
          />
        ) : null}

        {/* Prev / Next — pinned, never scrolls (design §10.5). */}
        <div className="flex items-center gap-2 border-t border-gray-200 bg-white px-5 py-2.5 text-[11.5px] shadow-[0_-4px_14px_rgba(17,24,39,0.05)]">
          <button
            type="button"
            disabled={prevId === null}
            onClick={() => prevId !== null && onNavigate(prevId)}
            className="rounded-[6px] border border-gray-200 px-3 py-[6px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
          >
            ‹ Previous
          </button>
          {list.length > 1 && (
            <span className="mx-auto text-[11px] text-gray-400">
              {index >= 0 ? index + 1 : "—"} of {list.length} in this list
            </span>
          )}
          <button
            type="button"
            disabled={nextId === null}
            onClick={() => nextId !== null && onNavigate(nextId)}
            className={`rounded-[6px] border border-gray-200 px-3 py-[6px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40 ${list.length > 1 ? "" : "ml-auto"}`}
          >
            Next ›
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── Body (only rendered once detail is loaded) ───────────────────────────────

function PanelBody({
  d,
  source,
  hasDuplicateSo,
  withBillingCiNumber,
  isHand,
  canEdit,
  tab,
  setTab,
  windows,
  pickers,
  actions,
  busy,
  run,
  editingShipTo,
  setEditingShipTo,
  menuOpen,
  setMenuOpen,
  pickerId,
  setPickerId,
  onClose,
}: {
  d: FloorDetail;
  source: FloorDetailSource;
  hasDuplicateSo: boolean;
  withBillingCiNumber: string | null;
  isHand: boolean;
  canEdit: boolean;
  tab: Tab;
  setTab: (t: Tab) => void;
  windows: DispatchWindow[];
  pickers: FloorPicker[];
  actions: DetailActions;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  editingShipTo: boolean;
  setEditingShipTo: (v: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  pickerId: number | "";
  setPickerId: (v: number | "") => void;
  onClose: () => void;
}) {
  const status = headerStatus(d, source);
  // THE read-only gate. ONE boolean derived from the existing source vocabulary
  // — the same shape as `interactive` in floor-table.tsx (derived from
  // FloorTableVariant), deliberately not a new prop or a third concept.
  //
  // It guards the TWO places a write can still be reached on a source this file
  // does not name explicitly: the header slot chip (gated by NEGATION,
  // `source !== "cancelled"`) and the whole action row (the Ship-to button in
  // it is ungated — "Never disappears"). Everything else — Release, Restore,
  // Assign/Reassign, and the ⋯ Hold/Cancel/Unassign menu — is gated as
  // `source === "floor" | "rail" | "hold" | "cancelled"` and so excludes
  // "history" on its own.
  //
  // ⚠ Grep `actions.on` in this file: every hit must sit inside one of those
  // two guarded regions. That is the whole zero-write proof, and it is one
  // grep — keep it that way.
  const readOnly = source === "history";
  const canReassign = source === "floor" && !d.isDone && !d.isChecked;
  const railReleasable = source === "rail" && d.workflowStage === "pending_support";

  // ── TINT LOCK (2026-09-08, widened same day) ────────────────────────────────────────
  // The SAME lock rail-card.tsx puts on its Hold / ✕ pair — this menu was the
  // same hole one click away, since the panel opens straight off a rail card.
  // Read the block above `tintLocked` in rail-card.tsx for the live incidents
  // and for why the rule is "tinting NOT FINISHED" rather than "an operator is
  // attached" (Floor's Restore always writes 'pending_support', so cancelling a
  // bill even at pending_tint_assignment strands it past the tint stage). Only
  // the SOURCE of the state differs; keep the two seams identical.
  //
  // The card reads TintState.stage, which getFloorRail derives from
  // orders.workflowStage (lib/floor/queries.ts:531). This payload has no
  // TintState, so it derives the same answer from the same underlying facts,
  // which it already carries: `workflowStage` and `isTint`
  // (app/api/floor/order/[orderId]/route.ts:142/150). NO new API field — the
  // three stages below are exactly the ones queries.ts maps to "waiting",
  // "assigned" and "mixing", and 'paused' folds into 'tinting_in_progress' here
  // for the same reason it does there: pause/resume write the assignment row
  // only and never the order's stage (CLAUDE_TINT §5). The one stage left out is
  // 'pending_support' — "ready", where tinting is done and the floor must still
  // be able to hold, cancel or release. DO NOT WIDEN PAST THIS.
  //
  // RAIL ONLY, deliberately. A floor-sourced bill is past tinting, and the
  // "hold" source's Cancel (below) and Unassign are untouched.
  const tintLocked =
    source === "rail" &&
    d.isTint &&
    (d.workflowStage === "pending_tint_assignment" ||
      d.workflowStage === "tint_assigned" ||
      d.workflowStage === "tinting_in_progress");
  // ⚠ INERT since the rail retired (no opener passes "rail" — CLAUDE_FLOOR §4.7).
  // The wording follows the routes' own refusal (lib/floor/off-floor.ts
  // TINT_ROOM_REFUSAL, 2026-10-01): the Tint Manager's Stop & cancel exists now.
  const tintLockReason = !tintLocked ? undefined : TINT_ROOM_REFUSAL;

  // Overflow (⋯) actions per source — only the ones with real routes.
  // `disabledReason` set ⇒ the item renders visible but greyed and inert, with
  // the reason on a span wrapper (a disabled button shows no title of its own).
  const overflow: Array<{ label: string; danger?: boolean; disabledReason?: string; fn: () => Promise<void> }> = [];
  if (source === "floor" && d.isAssigned) overflow.push({ label: "Unassign", fn: () => actions.onUnassign(d.orderId) });
  // "Cancel / Raise CI…" opens the floor's one off-floor form on this bill
  // (floor-page.tsx → off-floor-dialog.tsx, 2026-09-22); the refusals — trip,
  // tint room, dispatched — are that form's and the routes', not this menu's.
  if (source === "floor" || source === "rail") {
    overflow.push({ label: "Hold", disabledReason: tintLockReason, fn: () => actions.onHold(d.orderId) });
    overflow.push({ label: "Cancel / Raise CI…", danger: true, disabledReason: tintLockReason, fn: () => actions.onCancel(d.orderId) });
  }
  if (source === "hold") overflow.push({ label: "Cancel / Raise CI…", danger: true, fn: () => actions.onCancel(d.orderId) });
  // HAND — the dealer collects (2026-09-24, design §4). Floor + Hold panels, and
  // only for a `floor` canEdit holder: HIDDEN otherwise, never disabled (UI §10).
  // The route owns the refusals (dispatched / cancelled / on a trip).
  if (canEdit && (source === "floor" || source === "hold")) {
    overflow.push(
      isHand
        ? { label: "Clear Hand", fn: () => actions.onHand(d.orderId, false) }
        : { label: "Mark Hand (dealer collects)", fn: () => actions.onHand(d.orderId, true) },
    );
  }

  const currentSlotValue =
    d.dispatchTargetDate && d.dispatchWindowId && d.dispatchWindowTime
      ? { date: d.dispatchTargetDate, dispatchWindowId: d.dispatchWindowId, windowTime: d.dispatchWindowTime }
      : null;
  // Slot chip label (line 1): "DD-MM · HH:MM" or a dashed "No slot".
  const slotText = currentSlotValue
    ? `${currentSlotValue.date.slice(8, 10)}-${currentSlotValue.date.slice(5, 7)} · ${currentSlotValue.windowTime}`
    : "No slot";

  return (
    <>
      {/* ── Header (fixed) ─────────────────────────────────────────────────── */}
      {/* On a duplicate-SO bill the header block takes the SOFT treatment —
          a red-50 wash and a 3px red-500 left accent — so the flag survives from
          the row into the screen the operator uses to compare the two bills, in
          the same language the row and the rail card now speak. `pb-0.5` only
          there: the tag row needs a hair of breathing room under the wash edge.
          The accent is an INSET SHADOW, so it costs no layout and cannot shift
          the header. Every heading, code and tag below keeps its ordinary
          colour — there is no fill left for them to vanish into. */}
      <div
        className={"px-5 pt-3.5 " + (hasDuplicateSo ? "pb-0.5" : "")}
        style={
          hasDuplicateSo
            ? { background: DUP_SO_SOFT_SURFACE, boxShadow: DUP_SO_SOFT_BAR }
            : undefined
        }
      >
        <div className="flex items-baseline gap-2.5">
          <span
            className={"font-mono text-[19px] font-bold leading-none tracking-[-0.02em] " + "text-gray-900"}
          >
            {d.obdNumber}
          </span>
          <span
            className={"text-[11px] tabular-nums " + "text-gray-400"}
          >
            {fmtDateTime(d.obdDateTime)}
          </span>
          <div className="ml-auto flex items-center gap-2 self-center">
            {/* Slot chip — moved up beside the date; a chip with a pencil so it
                reads as editable. Opens the reused picker. Deleted the old grey
                "Slot" label. Hidden on cancelled (no dispatch slot to set), and
                on history — this chip WRITES (actions.onUpdateSlot →
                /api/floor/actions change-slot), and re-slotting a bill from a
                past day would move a dispatch that has already happened. The
                slot itself still reads on the Details tab. */}
            {source !== "cancelled" && !readOnly && (
              <SlotPickerButton
                value={currentSlotValue}
                onPick={(v) => run(() => actions.onUpdateSlot(d.orderId, v.date, v.dispatchWindowId))}
                windows={windows}
                popoverDir="down"
                popoverAlign="right"
                className={
                  hasDuplicateSo
                    ? // White alpha wash so the chip stays legible on the fill
                      // without reading as a filled primary control.
                      `inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors border-white/45 bg-white/20 text-white ${
                        currentSlotValue ? "" : "border-dashed"
                      }`
                    : `inline-flex h-[26px] items-center gap-1.5 rounded-md border bg-white px-2 text-[11.5px] transition-colors hover:border-gray-400 hover:bg-gray-50 ${
                        currentSlotValue ? "border-gray-300 text-gray-700" : "border-dashed border-gray-300 text-gray-400"
                      }`
                }
              >
                <ClockIcon />
                <span>{slotText}</span>
                <span className={"ml-0.5 flex items-center border-l pl-1.5 " + (hasDuplicateSo ? "border-white/40" : "border-gray-200")}>
                  <PencilIcon />
                </span>
              </SlotPickerButton>
            )}
            <button
              type="button"
              onClick={onClose}
              className={hasDuplicateSo ? "text-white/80 hover:text-white" : "text-gray-400 hover:text-gray-600"}
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={"text-[16px] font-bold " + "text-gray-900"}
          >
            {d.shipToName}
          </span>
          {d.shipToCode && (
            <span
              className={"font-mono text-[11.5px] " + "text-gray-400"}
            >
              {d.shipToCode}
            </span>
          )}
        </div>
        {/* Tags carry treatment facts only (design §10.2): status, key, urgent, site, tint.
            All five are ordinary light pills and render unchanged on the soft
            wash — no flipping, no special case — only the duplicate tag is
            added, leading the row. */}
        <div className="my-3 flex flex-wrap items-center gap-1.5">
          {hasDuplicateSo && <DuplicateSoTag variant="soft" />}
          <span className={`inline-flex items-center rounded-[4px] px-2.5 py-1 text-[10.5px] font-semibold ${status.cls}`}>
            {status.truck && <Truck size={11} strokeWidth={2.4} className="mr-1 shrink-0" />}
            {status.label}
          </span>
          {d.isKeyCustomer && <span className="rounded-[4px] bg-[#fffbeb] px-2 py-[3px] text-[10px] font-semibold text-[#b45309]">★ Key</span>}
          {d.priorityLevel === 1 && <span className="rounded-[4px] bg-[#fef2f2] px-2 py-[3px] text-[10px] font-semibold text-[#b91c1c]">⚡ Urgent</span>}
          {d.isSite && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#f8fafc] px-2 py-[3px] text-[10px] font-semibold text-[#475569]">
              <Building2 size={11} /> Site
            </span>
          )}
          {/* TINT / BASE, replacing a "Droplet + Tint" chip that keyed on
              `orderType` and so labelled a bill closed as "Base — No Tint" a
              tint bill. Self-guarding: it renders nothing outside the two
              project divisions, exactly as the chip rendered nothing on a plain
              bill, so this row is unchanged on every other panel. */}
          <ColourWorkBadge work={d.colourWork} />
          {/* HAND — the dealer collects (2026-09-24), beside TINT / BASE. */}
          {isHand && <HandBadge />}
        </div>
      </div>

      {/* ── Action row (fixed) — or the ship-to editor when editing ────────────
          SUPPRESSED WHOLESALE on a history-sourced panel. One gate rather than
          five: the row is the only host of Release, Restore, Ship-to,
          Assign/Reassign and the ⋯ (Hold / Cancel / Unassign) menu, and
          `setEditingShipTo(true)` — the ONLY trigger for the ShipToEditor — is
          a button inside it, so the editor branch above becomes unreachable
          too. Removing the container is what makes the zero-write claim hold by
          construction; gating each control would leave the next control added
          here silently reachable from a past day. The panel keeps its header,
          tabs, Details / Items / Activity and Prev/Next. */}
      {readOnly ? null : editingShipTo ? (
        <ShipToEditor
          busy={busy}
          onCancel={() => setEditingShipTo(false)}
          onPick={(customerId) =>
            run(async () => {
              await actions.onChangeShipTo(d.orderId, customerId);
              setEditingShipTo(false);
            })
          }
        />
      ) : (
        <div className="flex items-center gap-2 border-y border-gray-200 bg-gray-50 px-4 py-2.5">
          {/* Release (rail / hold) — teal primary; opens the reused picker and only
              then releases (a held/rail bill has no slot, so this is the slot step
              too). Wiring unchanged. */}
          {(source === "rail" || source === "hold") && (
            <div className="flex items-center gap-1.5">
              <SlotPickerButton
                value={null}
                onPick={(v) => run(() => actions.onRelease(d.orderId, v.date, v.dispatchWindowId))}
                windows={windows}
                disabled={source === "rail" && !railReleasable}
                popoverDir="down"
                popoverAlign="left"
                className="inline-flex h-[34px] items-center gap-1.5 rounded-md border border-brand-600 bg-brand-600 px-3.5 text-[12px] font-semibold text-white enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                Release
              </SlotPickerButton>
              {source === "rail" && !railReleasable && <span className="text-[10px] text-gray-400">shade not ready</span>}
            </div>
          )}

          {/* Restore (cancelled) — brand primary. Not on a bill whose CI is with
              billing (2026-09-22): the line below takes its place. */}
          {source === "cancelled" && withBillingCiNumber !== null && (
            <span className="inline-flex h-[34px] items-center text-[12px] text-gray-500">
              Return {withBillingCiNumber} is with billing
            </span>
          )}
          {source === "cancelled" && withBillingCiNumber === null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => actions.onRestore(d.orderId))}
              className="inline-flex h-[34px] items-center rounded-md border border-brand-600 bg-brand-600 px-3.5 text-[12px] font-semibold text-white enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
            >
              Restore to decisions
            </button>
          )}

          {/* Change ship-to — teal on floor (its real job there), neutral elsewhere
              (Release/Restore own the teal). Never disappears. Search + PATCH owned
              by Support (§4.18); caller only. */}
          <button
            type="button"
            onClick={() => setEditingShipTo(true)}
            className={
              source === "floor"
                ? "inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-md border border-brand-600 bg-brand-600 px-3.5 text-[12px] font-semibold text-white hover:bg-brand-700"
                : "inline-flex h-[34px] items-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-3.5 text-[12px] font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
            }
          >
            {source === "floor" && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
                <circle cx="12" cy="10" r="2.4" />
              </svg>
            )}
            Ship-to
          </button>

          {/* Assign / Reassign (floor waiting or assigned) — neutral joined unit. */}
          {canReassign && (
            <div className="flex h-[34px] items-stretch">
              <select
                value={pickerId}
                onChange={(e) => setPickerId(e.target.value === "" ? "" : Number(e.target.value))}
                className="h-[34px] min-w-[126px] cursor-pointer rounded-l-md border border-r-0 border-gray-300 bg-white pl-2.5 pr-6 text-[12px] text-gray-700"
              >
                <option value="">{d.isAssigned ? "Reassign to…" : "Assign to…"}</option>
                {pickers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.onHand === 0 ? " - free" : ` - ${p.onHand} on hand`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pickerId === "" || busy}
                onClick={() => pickerId !== "" && run(() => actions.onReassign(d.orderId, pickerId))}
                className="h-[34px] rounded-r-md border border-gray-300 bg-white px-3 text-[12px] font-semibold text-gray-700 enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
              >
                {d.isAssigned ? "Reassign" : "Assign"}
              </button>
            </div>
          )}

          {/* ⋯ overflow — contents UNCHANGED per state; pushed to the right. */}
          {overflow.length > 0 && (
            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-gray-300 bg-white text-[14px] leading-none text-gray-500 hover:bg-gray-50"
              >
                ⋯
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-[150px] overflow-hidden rounded-[8px] border border-gray-200 bg-white shadow-lg">
                    {overflow.map((o) => (
                      // The span carries the reason: a disabled button generates no
                      // mouse events in Chrome, so its own title never shows. `block`
                      // (not inline-flex as on the card) because these items are full
                      // -width rows in a stacked menu, not flex children — same
                      // wrapper trick, the menu's own geometry. A locked `danger` item
                      // also drops its red: neutral only, a blocked action is a
                      // "not yet", not an error (CLAUDE_FLOOR §8).
                      <span key={o.label} className="block" title={o.disabledReason}>
                        <button
                          type="button"
                          disabled={busy || o.disabledReason !== undefined}
                          onClick={() => {
                            setMenuOpen(false);
                            void run(o.fn);
                          }}
                          className={`block w-full px-3 py-2 text-left text-[11.5px] hover:bg-gray-50 disabled:opacity-40 ${
                            o.disabledReason !== undefined
                              ? "cursor-not-allowed text-gray-700"
                              : o.danger
                                ? "text-red-600"
                                : "text-gray-700"
                          }`}
                        >
                          {o.label}
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tabs (fixed) ────────────────────────────────────────────────────── */}
      <div className="flex gap-5 border-b border-gray-200 px-5">
        {([
          ["items", `Items ${d.lines.length}`],
          ["details", "Details"],
          ["activity", `Activity ${d.activity.length}`],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 py-[11px] text-[12px] ${tab === key ? "border-gray-900 font-bold text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Body (scrolls) ──────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "items" && <DetailItems lines={d.lines} totalLitres={d.totalLitres} />}
        {tab === "details" && <DetailDetails d={d} />}
        {tab === "activity" && <DetailActivity d={d} />}
      </div>
    </>
  );
}
