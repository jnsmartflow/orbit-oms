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
//   - Change ship-to → components/shared/ship-to-modal.tsx (2026-10-19, the
//     shared Billing + Floor modal: GET /api/floor/ship-to-search, POST
//     /api/floor/ship-to multipart). Replaced the inline
//     components/floor/ship-to-editor.tsx HERE only — the Tint Manager still
//     uses that editor.
//   - Update slot / release → components/floor/dispatch-slot-picker.tsx +
//     the existing /api/floor routes.
// Every write goes through floor-page's reportWrite() handlers, so a failure
// surfaces — never a swallowed response.

import { useState, useEffect, useCallback, useRef } from "react";
import { Building2, Pause, Truck, X } from "lucide-react";
// TINT / BASE -- one owner for the word (components/picking/card-atoms.tsx).
import { ColourWorkBadge } from "@/components/picking/card-atoms";
import { HandBadge } from "@/components/shared/hand-badge";
import { SampleBadge } from "@/components/shared/sample-badge";
import { ChallanBadge } from "@/components/shared/challan-badge";
import { ObdBadge } from "@/components/shared/obd-badge";
import type { DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import { SlotPickerButton } from "@/components/floor/slot-picker-button";
import { ShipToModal } from "@/components/shared/ship-to-modal";
import { ShipToCopiesPin } from "@/components/shared/ship-to-copies-pin";
import { TINT_ROOM_REFUSAL } from "@/lib/floor/off-floor";
import { DetailItems } from "./detail-items";
// The Items tab's old "Invoices" section (detail-invoices.tsx, c7fef916) is no
// longer mounted since Add invoices Phase 4 commit 3: a split OBD's panel opens
// SCOPED to one invoice, and Add / Edit invoices moved into the ··· menu. The
// file is kept (CORE §3 — never delete a file).
import { DetailDetails } from "./detail-details";
import { DetailActivity } from "./detail-activity";
import { InvoiceCountChip, InvoicePartChip } from "./bill-ref-cells";
import { activityForInvoice, otherInvoices, scopeItems, walkIndex, type DetailKey } from "@/lib/floor/detail-scope";
import type { FloorInvoiceRow } from "@/lib/floor/invoice-rows";
import type { SplitView } from "@/lib/order-invoices/split";
import { ON_HOLD_PILL_CLS, pillMeta, rowStatus } from "./status-pill";
import { tintPhaseOf } from "@/lib/floor/tint-phase";
import {
  DuplicateSoTag,
  DUP_SO_SOFT_BAR,
  DUP_SO_SOFT_SURFACE,
} from "@/components/shared/duplicate-so-tag";
import type { FloorDetail, FloorDetailLine, FloorDetailSource, FloorPicker } from "@/lib/floor/types";

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
  /** After the shared ship-to modal saved (it does the write itself, for
   *  dealer / typed / reset) — floor-page reloads the board. */
  onShipToSaved: () => Promise<void>;
  onUpdateSlot: (orderId: number, date: string, windowId: number) => Promise<void>;
  onReassign: (orderId: number, pickerId: number) => Promise<void>;
  onRestore: (orderId: number) => Promise<void>;
  onHold: (orderId: number) => Promise<void>;
  onCancel: (orderId: number) => Promise<void>;
  onUnassign: (orderId: number) => Promise<void>;
  /** Hand (dealer collects) on / off — POST /api/floor/actions hand | unhand. */
  onHand: (orderId: number, set: boolean) => Promise<void>;
  /** SAMPLE on / off — POST /api/floor/actions sample | unsample (2026-10-24). */
  onSample: (orderId: number, set: boolean) => Promise<void>;
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
): { label: string; cls: string; truck?: true; pause?: true } {
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
    // THE TINT ROOM (2026-10-28) — this arm used to fall straight to grey
    // "Waiting", so a bill on the mixer (or paused) opened from the Floor tab
    // read as untouched. Same rule as the row's pill: tintPhaseOf (with the
    // "Base — No Tint" override getFloorBoard applies) → rowStatus → pillMeta,
    // which owns the paused override. Nothing above this line changes.
    // 2026-10-28: paused now has its own pill — do not revert to plain Tinting.
    const tintSt = rowStatus({
      isAssigned: false,
      isDone: false,
      isChecked: false,
      tintPhase: d.colourWork === "base" ? null : tintPhaseOf(d.orderType, d.workflowStage),
    });
    if (tintSt !== "waiting") {
      const m = pillMeta(tintSt, d.tint?.pause ?? null);
      return m.paused ? { label: m.label, cls: m.cls, pause: true } : { label: m.label, cls: m.cls };
    }
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
  canAddInvoices = false,
  invoicesRefreshKey = 0,
  onEditInvoices,
  invoiceSeq = null,
  invoiceRows = [],
  invoiceCount = 1,
  onScopeInvoice,
  list,
  windows,
  pickers,
  actions,
  onClose,
  onNavigate,
  changeSignal,
  trip = null,
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
  /**
   * ADD INVOICES (2026-10-10): `floor_add_invoices` canEdit, resolved on the
   * server like canEdit. Draws Add / Edit invoices in the ··· menu (Phase 4
   * commit 3; was the Items tab's Invoices section) — hidden without it, and on
   * a history panel (UI §10). The route re-checks.
   */
  canAddInvoices?: boolean;
  /** Bumped by floor-page after an Add invoices save / undo. */
  invoicesRefreshKey?: number;
  /** Opens floor-page's Add invoices modal on this bill. */
  onEditInvoices?: (orderId: number, obdNumber: string) => void;
  /**
   * ADD INVOICES Phase 4 commit 3 — THE SCOPE. The invoice (order_invoices seq)
   * this panel is open on, ALREADY RESOLVED by floor-page (lib/floor/
   * detail-scope.ts resolveScope): non-null only for a split OBD opened from the
   * Floor tab, and only while that invoice still exists. null = the OBD view,
   * exactly as before.
   */
  invoiceSeq?: number | null;
  /** The OBD's invoices off the loaded board row (FloorBoardRow.invoiceRows) —
   *  number, date, litres, kg + exact flag, stale. [] when unsplit. */
  invoiceRows?: FloorInvoiceRow[];
  /** How many invoices the OBD carries — the OBD view's "n invoices" (On hold,
   *  Cancel & CI, History). On hold and Cancel & CI draw per invoice since 6.1 /
   *  6.3; History still shows the OBD whole (an open item). 1 = unsplit. */
  invoiceCount?: number;
  /** "Other invoices: 716 · 714 · 715" — re-scope the panel to another invoice. */
  onScopeInvoice?: (seq: number) => void;
  /** Prev / Next — invoice rows in board order (detailWalk). */
  list: DetailKey[];
  windows: DispatchWindow[];
  pickers: FloorPicker[];
  actions: DetailActions;
  onClose: () => void;
  onNavigate: (key: DetailKey) => void;
  /**
   * Live feed (7b) only — undefined with the feed off, and then nothing below
   * runs. Bumped by floor-page each time THIS bill shows up in the change feed.
   * The panel re-reads the bill quietly and, only if it really differs from
   * what is on screen, shows a slim "Changed — Reload" bar. It never swaps the
   * data by itself: the operator may be mid-read or mid-action.
   */
  changeSignal?: number;
  /**
   * The trip the bill is on, from its board row (2026-10-24) — null when on
   * none. Set → the ship-to modal saves through that trip's route and the bill
   * moves to the new shop's stop instead of being refused (owner D2).
   */
  trip?: { tripId: number; tripNumber: string } | null;
}) {
  const [detail, setDetail] = useState<FloorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [shipToOpen, setShipToOpen] = useState(false);
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

  // ── THE SCOPED INVOICE (Add invoices Phase 4 commit 3) ─────────────────────
  // `scope` = the board row's invoice entry (number, date, litres, kg, stale);
  // the Items tab also needs WHICH lines are on it, which only the split view
  // carries (GET /api/floor/orders/[orderId]/invoices — the Add invoices modal's
  // own read). Read when scoped, again after a save / undo or a live change.
  const scope = invoiceSeq !== null ? invoiceRows.find((r) => r.seq === invoiceSeq) ?? null : null;
  const [splitView, setSplitView] = useState<SplitView | null>(null);
  const scoped = scope !== null;
  useEffect(() => {
    if (!scoped) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/floor/orders/${orderId}/invoices`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as SplitView | null;
        if (!cancelled) setSplitView(res.ok && body && Array.isArray(body.invoices) ? body : null);
      } catch {
        if (!cancelled) setSplitView(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, scoped, invoicesRefreshKey, changeSignal]);
  useEffect(() => {
    setSplitView(null);
  }, [orderId]);

  // Reset per-bill UI when the panel walks to another bill.
  useEffect(() => {
    setTab("items");
    setShipToOpen(false);
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

  // Walks invoice rows in board order (716 → 713 → 714 → 715 → next bill).
  const index = walkIndex(list, { orderId, invoiceSeq: scope ? scope.seq : null });
  const prevKey = index > 0 ? list[index - 1] : null;
  const nextKey = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

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
            trip={trip}
            canAddInvoices={canAddInvoices && onEditInvoices !== undefined}
            onEditInvoices={onEditInvoices}
            scope={scope}
            scopeK={scope ? invoiceRows.indexOf(scope) + 1 : 0}
            invoiceRows={invoiceRows}
            invoiceCount={invoiceCount}
            splitView={splitView}
            onScopeInvoice={onScopeInvoice}
            tab={tab}
            setTab={setTab}
            windows={windows}
            pickers={pickers}
            actions={actions}
            busy={busy}
            run={run}
            shipToOpen={shipToOpen}
            setShipToOpen={setShipToOpen}
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
            disabled={prevKey === null}
            onClick={() => prevKey !== null && onNavigate(prevKey)}
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
            disabled={nextKey === null}
            onClick={() => nextKey !== null && onNavigate(nextKey)}
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
  trip,
  canAddInvoices,
  onEditInvoices,
  scope,
  scopeK,
  invoiceRows,
  invoiceCount,
  splitView,
  onScopeInvoice,
  tab,
  setTab,
  windows,
  pickers,
  actions,
  busy,
  run,
  shipToOpen,
  setShipToOpen,
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
  trip: { tripId: number; tripNumber: string } | null;
  canAddInvoices: boolean;
  onEditInvoices?: (orderId: number, obdNumber: string) => void;
  /** The invoice the panel is scoped to (null = the OBD view) and its k of n. */
  scope: FloorInvoiceRow | null;
  scopeK: number;
  invoiceRows: FloorInvoiceRow[];
  invoiceCount: number;
  splitView: SplitView | null;
  onScopeInvoice?: (seq: number) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  windows: DispatchWindow[];
  pickers: FloorPicker[];
  actions: DetailActions;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  shipToOpen: boolean;
  setShipToOpen: (v: boolean) => void;
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
  // ── A PAST DAY, FOR A FLOOR EDITOR (owner D1/D2, 2026-10-24) ──────────────
  // The action row comes back with ONE live control, Ship-to — it can move a
  // bill on a past day's trip to its right stop. Hold, Cancel / Raise CI and
  // Release are drawn GREY and inert, and the slot chip shows 🔒: they change
  // the bill TODAY, not the old plan. The zero-write proof above still holds:
  // the only `actions.on` reachable here is the ship-to modal's onSaved.
  const pastDay = readOnly && canEdit;
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
  // SAMPLE (2026-10-24, v27.77) — next to Hand, the same gate: Floor + Hold
  // panels, `floor` canEdit, HIDDEN otherwise (UI §10). The route refuses a
  // removed or cancelled bill and a repeat press. The mark is on the payload.
  if (canEdit && (source === "floor" || source === "hold")) {
    overflow.push(
      d.isSample
        ? { label: "Remove Sample", fn: () => actions.onSample(d.orderId, false) }
        : { label: "Mark Sample", fn: () => actions.onSample(d.orderId, true) },
    );
  }

  // ADD / EDIT INVOICES (Add invoices Phase 4 commit 3 — was the Items tab's
  // Invoices section). The same tick (`floor_add_invoices`) and the same modal
  // the Floor bar's ··· More opens (floor-page openAddInvoices); the modal shows
  // the refusals (dispatched, a CI, rows in different states). Floor and On
  // hold panels only — a cancelled bill is refused, and History never writes.
  if (canAddInvoices && (source === "floor" || source === "hold") && onEditInvoices) {
    const isSplit = invoiceCount > 1 || invoiceRows.length > 1;
    overflow.push({ label: isSplit ? "Edit invoices" : "Add invoices", fn: async () => onEditInvoices(d.orderId, d.obdNumber) });
  }

  // THE SCOPED INVOICE's Items: only its lines (by raw line id), its tins and
  // litres; "lines changed in SAP" when the split no longer matches SAP's lines.
  const scopedInvoice = scope && splitView ? splitView.invoices.find((i) => i.seq === scope.seq) ?? null : null;
  const scopedItems: { lines: FloorDetailLine[]; missing: number } | null = scopedInvoice
    ? scopeItems(d.lines, scopedInvoice.lines)
    : null;
  const scopedStale = scope !== null && (scope.stale || (scopedItems?.missing ?? 0) > 0);
  const shownActivity = scope ? activityForInvoice(d.activity, scope.id) : d.activity;
  const itemsCount = scope ? scopedItems?.lines.length ?? 0 : d.lines.length;

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
          {scope ? (
            // SCOPED TO ONE INVOICE: the invoice leads, "k/n" beside it; the OBD
            // number moves to the line under it.
            <span className="font-mono text-[19px] font-bold leading-none tracking-[-0.02em] text-gray-900">
              {scope.invoiceNo}
              <span className="align-[3px]">
                <InvoicePartChip k={scopeK} n={invoiceRows.length} />
              </span>
            </span>
          ) : (
            <>
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
            </>
          )}
          <div className="ml-auto flex items-center gap-2 self-center">
            {/* Slot chip — moved up beside the date; a chip with a pencil so it
                reads as editable. Opens the reused picker. Deleted the old grey
                "Slot" label. Hidden on cancelled (no dispatch slot to set), and
                on history — this chip WRITES (actions.onUpdateSlot →
                /api/floor/actions change-slot), and re-slotting a bill from a
                past day would move a dispatch that has already happened. The
                slot itself still reads on the Details tab. */}
            {pastDay && (
              <span
                title="Past day — the slot changes the bill today. Use Back to Live."
                className="inline-flex h-[26px] cursor-not-allowed items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 text-[11.5px] text-gray-400"
              >
                <ClockIcon />
                <span>{slotText}</span>
                <span aria-hidden className="ml-0.5 flex items-center border-l border-gray-200 pl-1.5 text-[10px]">🔒</span>
              </span>
            )}
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
        {scope && (
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <span className="font-mono text-[12.5px] font-semibold text-gray-700">{d.obdNumber}</span>
            <span className="text-[11px] tabular-nums text-gray-400">{fmtDateTime(d.obdDateTime)}</span>
          </div>
        )}
        {d.shipToText !== null ? (
          // TYPED SHIP-TO (v27.73, 2026-10-19) — the desk may show "As per
          // challan" as the name (design §5). No code: it is not a dealer. The
          // second line carries Floor's own ship-to-changed wording (the
          // board's "→ ship-to changed", brand-800), the TYPED area, who it is
          // billed to, and the violet 📎 when copies show on this bill.
          <>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[16px] font-bold text-gray-900">{d.shipToText}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px]">
              <span className="text-brand-800">→ ship-to changed</span>
              {d.typedAreaName && (
                <span className="text-gray-500">
                  · {d.typedAreaName}
                  {d.typedAreaDeliveryType ? ` · ${d.typedAreaDeliveryType}` : ""}
                </span>
              )}
              {(d.billToName ?? d.customerName) && (
                <span className="text-gray-500">· billed to {d.billToName ?? d.customerName}</span>
              )}
              <ShipToCopiesPin orderId={d.orderId} count={d.shipToCopyCount} />
            </div>
          </>
        ) : (
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
        )}
        {/* Tags carry treatment facts only (design §10.2): status, key, urgent, site, tint.
            All five are ordinary light pills and render unchanged on the soft
            wash — no flipping, no special case — only the duplicate tag is
            added, leading the row. */}
        <div className="my-3 flex flex-wrap items-center gap-1.5">
          {hasDuplicateSo && <DuplicateSoTag variant="soft" />}
          {/* CHALLAN (2026-10-07) — off the detail payload (lib/floor/order-detail.ts),
              so it shows whichever tab or history row the panel was opened from. */}
          {d.isChallanOrder && <ChallanBadge />}
          {d.isObdImport && <ObdBadge />}
          <span className={`inline-flex items-center rounded-[4px] px-2.5 py-1 text-[10.5px] font-semibold ${status.cls}`}>
            {status.truck && <Truck size={11} strokeWidth={2.4} className="mr-1 shrink-0" />}
            {status.pause && <Pause size={11} strokeWidth={3} className="mr-1 shrink-0" />}
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
          {/* SAMPLE (2026-10-24) — beside HAND, off the detail payload. */}
          {d.isSample && <SampleBadge />}
          {/* A split OBD seen as a whole (On hold, Cancel & CI, History). */}
          {!scope && invoiceCount > 1 && <InvoiceCountChip n={invoiceCount} className="" />}
        </div>
      </div>

      {/* ── Action row (fixed) ───────────────────────────────────────────────
          SUPPRESSED WHOLESALE on a history-sourced panel. One gate rather than
          five: the row is the only host of Release, Restore, Ship-to,
          Assign/Reassign and the ⋯ (Hold / Cancel / Unassign) menu, and
          `setShipToOpen(true)` — the ONLY trigger for the ship-to modal — is a
          button inside it, and the modal itself is mounted inside it, so both
          become unreachable too. Removing the container is what makes the
          zero-write claim hold by construction; gating each control would leave
          the next control added here silently reachable from a past day. The
          panel keeps its header, tabs, Details / Items / Activity and Prev/Next. */}
      {readOnly && !pastDay ? null : (
        <>
        <div className="flex items-center gap-2 border-y border-gray-200 bg-gray-50 px-4 py-2.5">
          {/* THE SHARED SHIP-TO MODAL (free-text ship-to P3, 2026-10-19) —
              replaced the inline ShipToEditor here (the Tint Manager keeps that
              one). Dealer / typed name / As per challan / Reset all save inside
              the modal (POST /api/floor/ship-to, multipart) for THIS BILL ONLY;
              a refusal (on a trip, a Billing copy) is shown in the modal. It is
              portalled at z-[120], above this z-[110] panel, and its Esc stops
              at the modal. After a save: board reload + this panel's refetch. */}
          {shipToOpen && (
            <ShipToModal
              desk="floor"
              ownerId={d.orderId}
              refLabel={`OBD ${d.obdNumber}`}
              current={{
                name: d.shipToText ?? d.shipToName,
                code: d.shipToText !== null ? null : d.shipToCode,
                area: d.shipToText !== null ? d.typedAreaName : d.area,
                deliveryType: d.shipToText !== null ? d.typedAreaDeliveryType : d.deliveryType,
                isChanged: d.isShipToOverride || d.shipToText !== null,
                typedText: d.shipToText,
                typedAreaId: d.shipToAreaId,
                billedToName: d.billToName ?? d.customerName,
                billedToCode: d.billToCode ?? d.customerCode,
              }}
              customerAreaId={d.customerAreaId}
              trip={trip}
              onClose={() => setShipToOpen(false)}
              onSaved={() => void run(() => actions.onShipToSaved())}
            />
          )}
          {/* Release (rail / hold) — teal primary; opens the reused picker and only
              then releases (a held/rail bill has no slot, so this is the slot step
              too). Wiring unchanged. */}
          {/* 6.1 fix — scoped to a HELD invoice of a split OBD (On hold): its
              Release takes THAT invoice off hold (floor-page → releaseRows); the
              OBD keeps its slot, so there is no slot step. */}
          {source === "hold" && scope !== null && invoiceRows.length >= 2 && (
            <button
              type="button"
              onClick={() => run(() => actions.onRelease(d.orderId, "", 0))}
              title={`Take ${scope.invoiceNo ?? "this invoice"} off hold — the other invoices stay as they are`}
              className="inline-flex h-[34px] items-center gap-1.5 rounded-md border border-brand-600 bg-brand-600 px-3.5 text-[12px] font-semibold text-white enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              Release invoice
            </button>
          )}
          {(source === "rail" || (source === "hold" && !(scope !== null && invoiceRows.length >= 2))) && (
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
              (Release/Restore own the teal). Never disappears. Opens the shared
              ship-to modal (mounted at the top of this row). */}
          <button
            type="button"
            onClick={() => setShipToOpen(true)}
            className={
              source === "floor" || pastDay
                ? "inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-md border border-brand-600 bg-brand-600 px-3.5 text-[12px] font-semibold text-white hover:bg-brand-700"
                : "inline-flex h-[34px] items-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-3.5 text-[12px] font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
            }
          >
            {(source === "floor" || pastDay) && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
                <circle cx="12" cy="10" r="2.4" />
              </svg>
            )}
            Ship-to
          </button>

          {/* PAST DAY (2026-10-24): the bill's own actions, drawn grey and inert
              — no handler is attached, so nothing here can write. */}
          {pastDay &&
            ["Hold", "Cancel / Raise CI…", "Release"].map((label) => (
              <span key={label} title="Past day — this changes the bill today" className="inline-flex">
                <button
                  type="button"
                  disabled
                  className="inline-flex h-[34px] cursor-not-allowed items-center whitespace-nowrap rounded-md border border-gray-200 bg-gray-100 px-3 text-[12px] font-medium text-gray-400"
                >
                  {label}
                </button>
              </span>
            ))}

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
        {pastDay && (
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11.5px] text-gray-500">
            Past day: Hold, Cancel, Release and Slot change this bill today. Use{" "}
            <b className="font-semibold text-brand-700">Back to Live</b> for them.
          </div>
        )}
        </>
      )}

      {/* ── Tabs (fixed) ────────────────────────────────────────────────────── */}
      <div className="flex gap-5 border-b border-gray-200 px-5">
        {([
          ["items", `Items ${itemsCount}`],
          ["details", "Details"],
          ["activity", `Activity ${shownActivity.length}`],
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
        {tab === "items" &&
          (scope === null ? (
            <DetailItems lines={d.lines} totalLitres={d.totalLitres} />
          ) : (
            <>
              {scopedStale && (
                <div className="border-b border-[#f0f0f0] bg-warn-bg px-5 py-2 text-[11.5px] text-warn-text">
                  Lines changed in SAP — re-check invoices
                </div>
              )}
              {scopedItems === null ? (
                <div className="px-5 py-10 text-center text-[11.5px] text-gray-400">Loading this invoice…</div>
              ) : (
                <DetailItems
                  lines={scopedItems.lines}
                  totalLitres={scopedItems.lines.reduce((sum, l) => sum + l.litres, 0)}
                  kg={{ kg: scope.kg, exact: scope.kgExact }}
                />
              )}
            </>
          ))}
        {tab === "details" &&
          (scope === null ? (
            <DetailDetails d={d} />
          ) : (
            <DetailDetails
              d={d}
              invoice={{ invoiceNo: scope.invoiceNo, invoiceDate: scope.invoiceDate }}
              others={otherInvoices(invoiceRows, scope.seq)}
              onPickInvoice={onScopeInvoice}
            />
          ))}
        {tab === "activity" && <DetailActivity d={scope ? { ...d, activity: shownActivity } : d} />}
      </div>
    </>
  );
}
