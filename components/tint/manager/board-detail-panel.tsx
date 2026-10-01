"use client";

// Tint Manager — the detail panel, in FLOOR'S FRAME (rewritten 2026-10-01, tabs
// build step 7 — plan §A, owner decision 6, mockup "dp").
//
// 472px slide-in · ‹ Previous / Next › walking the list it was opened from
// (rail, table or Hold tab) with "n of N" · header = the ship-to SITE
// (override-first) + "billed to …" + an identity line: OBD · date · slot chip ·
// status pill · Hold / Hand chips · action row = ONE brand button per state
// (waiting → Assign ▾, assigned → Re-assign ▾, held → Release) + Change ship-to
// + ⋯ (the bottom bar's More items, same ticks) · tabs Items / Details /
// Activity.
//
// WHY NOT FLOOR'S DetailPanel COMPONENT (plan §A): it fetches /api/floor/order
// on the `floor` tick, its actions are picker / Release-with-slot ones, its
// states are Floor's sources, and this panel's tabs are per-user ticks. What IS
// reused: the PAYLOAD (GET /api/tint/manager/order/[id] → lib/floor/
// order-detail.ts, the same builder Floor's route calls), the three tab BODIES
// (DetailItems / DetailDetails / DetailActivity), SlotPickerButton and
// ShipToEditor.
//
// KEPT from the old panel: the per-user tab ticks (tint_panel_items / _details /
// _activity — a tab without its tick is never drawn AND never mounted, so it
// never fetches; CLAUDE_TINT §1.2), the customer-missing banner + interceptor
// (the page runs it), Remove OBD on a waiting bill, Send back's two-step
// confirm, the pause / skip history links, OrderAuditHistory, and the
// "Changed elsewhere · Reload" bar.
//
// ⚠ LAYERING: the panel stays at z-[49]/z-[50] (not Floor's z-[110]) so the
// portalled operator menu (z-60), the slot picker (z-400) and this page's
// z-50 modals rendered after it (pause / skip history, Remove OBD, the
// customer-missing sheet) still open ABOVE it.
// ⚠ NO KEY LISTENER — tint-manager-content.tsx is the single Esc owner.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, History, Loader2, Pause, Scissors, SkipForward, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrderAuditHistory } from "@/components/shared/order-audit-history";
import { HandBadge } from "@/components/shared/hand-badge";
import { DetailItems } from "@/components/floor/detail-items";
import { DetailDetails } from "@/components/floor/detail-details";
import { DetailActivity } from "@/components/floor/detail-activity";
import { ON_HOLD_PILL_CLS } from "@/components/floor/status-pill";
import { SlotPickerButton } from "@/components/floor/slot-picker-button";
import { ShipToEditor } from "@/components/floor/ship-to-editor";
import type { DispatchSlotValue, DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import type { FloorDetail } from "@/lib/floor/types";
import { humaniseReason } from "@/lib/tint/pause-reasons";
import { OperatorAvatar, OperatorMenu, StatusPill, istDateTime } from "./board-bits";
import { slotLabel, slotValueOf } from "./board-slot-cell";
import { useTintManagerAccess } from "./tint-manager-access-provider";
import type { BoardRow, BoardRowStatus, Operator, TintHoldRow, TintOrder } from "./types";

export type PanelTarget =
  | { kind: "pending"; order: TintOrder }
  | { kind: "row"; row: BoardRow }
  | { kind: "hold"; hold: TintHoldRow };

type Tab = "items" | "details" | "activity";

/** Display order. Only the tabs the person holds a tick for are drawn. */
const TAB_ORDER: readonly Tab[] = ["items", "details", "activity"];

/** Everything the panel can ask the page to do. The page owns every write. */
export interface TintPanelActions {
  onAssign:          (order: TintOrder, operatorId: number) => void;
  onBaseBypass:      (order: TintOrder) => void;
  onReassignOrder:   (row: BoardRow, operatorId: number) => void;
  onReassignSplit:   (row: BoardRow, operatorId: number) => void;
  onSendBack:        (row: BoardRow) => void;
  onRemove:          (order: TintOrder) => void;
  onResolveMissing:  (order: TintOrder) => void;
  onOpenPauseHistory: (orderId: number, obdNumber: string, siteName: string) => void;
  onOpenSkipHistory:  (orderId: number, obdNumber: string, siteName: string) => void;
  onSetSlot:     (orderId: number, v: DispatchSlotValue) => void;
  onHold:        (orderId: number) => void;
  onReleaseHold: (orderId: number) => void;
  onHand:        (orderId: number, set: boolean) => void;
  /** null clears the redirect. Resolves true when it saved. */
  onShipTo:      (orderId: number, customerId: number | null) => Promise<boolean>;
  onCancel:      (bill: PanelBill) => void;
  onStopCancel:  (bill: PanelBill & { operatorName: string; status: string }) => void;
  onRaiseCi:     (bill: PanelBill) => void;
}

/** The bill as the cancel / CI forms need it. */
export interface PanelBill {
  orderId: number;
  obdNumber: string;
  siteName: string;
  litres: number | null;
}

const TINT_ROOM = ["tint_assigned", "tinting_in_progress"];

/** The board status a bill's stage maps to, or null for "waiting" / off the board. */
function stageStatus(d: FloorDetail): BoardRowStatus | "waiting" | "cancelled" {
  if (d.workflowStage === "cancelled") return "cancelled";
  if (d.workflowStage === "pending_tint_assignment") return "waiting";
  if (d.workflowStage === "tint_assigned") return "assigned";
  if (d.workflowStage === "tinting_in_progress") return d.tint?.status === "paused" ? "paused" : "tinting_in_progress";
  return "tinting_done";
}

export function BoardDetailPanel({
  target, operators, position, busy, error, canRemove, windows, reloadSignal, actions,
  onClose, onPrev, onNext, changedElsewhere = false, onReloadChanged, openShipToSignal = 0,
}: {
  target:    PanelTarget;
  operators: Operator[];
  /** "n of N" in the list the panel was opened from. */
  position:  { index: number; total: number };
  busy:      boolean;
  /** Server message from a rejected write, shown verbatim. */
  error:     string | null;
  /** tint_cancel — Remove OBD on a waiting bill. */
  canRemove: boolean;
  windows:   DispatchWindow[];
  /** Bumped by the page after a board reload — the panel re-reads its bill. */
  reloadSignal: number;
  actions:   TintPanelActions;
  onClose:   () => void;
  onPrev:    () => void;
  onNext:    () => void;
  /** Live feed only — this bill changed elsewhere; a quiet bar offers Reload. */
  changedElsewhere?: boolean;
  onReloadChanged?: () => void;
  /** Bumped by the page when the bottom bar's "Change ship-to" opens this
   *  panel — the shared ShipToEditor opens straight away. */
  openShipToSignal?: number;
}) {
  const access = useTintManagerAccess();
  const visibleTabs = TAB_ORDER.filter((t) =>
    t === "items"   ? access.canPanelItems
    : t === "details" ? access.canPanelDetails
    : access.canPanelActivity,
  );
  const firstTab: Tab | null = visibleTabs[0] ?? null;
  const [tab, setTab] = useState<Tab | null>(firstTab);
  const activeTab: Tab | null = tab !== null && visibleTabs.includes(tab) ? tab : firstTab;

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmSendBack, setConfirmSendBack] = useState(false);
  const [editingShipTo, setEditingShipTo] = useState(false);
  const [shipBusy, setShipBusy] = useState(false);

  // ── Who is this ─────────────────────────────────────────────────────────
  const order: TintOrder | undefined =
    target.kind === "pending" ? target.order : target.kind === "row" ? target.row.order : undefined;
  const row = target.kind === "row" ? target.row : null;
  const orderId =
    target.kind === "pending" ? target.order.id : target.kind === "row" ? target.row.orderId : target.hold.orderId;
  const targetKey = target.kind === "pending" ? `pending-${orderId}` : target.kind === "row" ? target.row.key : `hold-${orderId}`;
  const isHand =
    target.kind === "pending" ? target.order.handAt != null
    : target.kind === "row" ? target.row.isHand
    : target.hold.isHand;

  // ── The bill's payload — the SAME builder Floor's panel reads ──────────
  const [detail, setDetail] = useState<FloorDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/tint/manager/order/${orderId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(((await res.json()) as { detail: FloorDetail }).detail);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [orderId]);
  useEffect(() => { setDetail(null); }, [orderId]);
  useEffect(() => { void load(); }, [load, reloadSignal]);

  // Prev/Next swaps the target while this stays mounted — reset transient UI so
  // nothing armed rides along to the next bill.
  useEffect(() => {
    setConfirmSendBack(false);
    setMenuAnchor(null);
    setMoreOpen(false);
    setEditingShipTo(false);
    setTab(firstTab);
  }, [targetKey, firstTab]);
  // The bar's "Change ship-to" — open the editor (after the reset above).
  useEffect(() => {
    if (openShipToSignal > 0 && access.canShipTo) setEditingShipTo(true);
  }, [openShipToSignal, access.canShipTo]);

  const d = detail;
  const status = d ? stageStatus(d) : null;
  const held = d?.dispatchStatus === "hold";
  const inTintRoom = d ? TINT_ROOM.includes(d.workflowStage) : false;
  const siteName = d ? d.shipToName : target.kind === "row" ? target.row.siteName : target.kind === "hold" ? target.hold.dealerName : "—";
  const bill: PanelBill = {
    orderId,
    obdNumber: d?.obdNumber ?? (target.kind === "pending" ? target.order.obdNumber : target.kind === "row" ? target.row.obdNumber : target.hold.obdNumber),
    siteName,
    litres: d?.totalLitres ?? null,
  };
  const operatorName = d?.tint?.operatorName ?? row?.operatorName ?? "the operator";

  // ── The ONE brand button for this state (CLAUDE_UI §10) ────────────────
  function primary() {
    if (!d) return null;
    if (held && access.canHold) {
      return (
        <button type="button" disabled={busy} onClick={() => actions.onReleaseHold(orderId)} className={BRAND_BTN}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          Release
        </button>
      );
    }
    if (target.kind === "pending" && access.canEdit) {
      return (
        <button type="button" disabled={busy} onClick={(e) => setMenuAnchor((a) => (a ? null : e.currentTarget))} className={BRAND_BTN}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          Assign ▾
        </button>
      );
    }
    if (row && row.status === "assigned" && access.canEdit) {
      return (
        <button type="button" disabled={busy} onClick={(e) => setMenuAnchor((a) => (a ? null : e.currentTarget))} className={BRAND_BTN}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          Re-assign ▾
        </button>
      );
    }
    if (row && (row.status === "tinting_in_progress" || row.status === "paused")) {
      // Locked — grey, never a faded brand (UI §10). The server 400s it too.
      return (
        <button
          type="button"
          disabled
          title={row.status === "paused"
            ? "A paused job belongs to its operator until they resume or finish it."
            : "The operator has started — moving it now would orphan their time and progress."}
          className={GREY_BTN}
        >
          {row.status === "paused" ? "Locked while paused" : "Locked — tinting"}
        </button>
      );
    }
    return null;
  }

  // ── ⋯ — the bar's More items, same ticks (board-bottom-bar.tsx) ─────────
  type Item = { key: string; label: string; danger?: boolean; disabled?: string; fn: () => void };
  const items: Item[] = [];
  if (d) {
    if (row && row.status === "assigned" && access.canEdit) {
      items.push({ key: "send-back", label: "Send back to pending", fn: () => setConfirmSendBack(true) });
    }
    // Held → Release is the brand primary above, so ⋯ offers Hold only when not held.
    if (access.canHold && !held) items.push({ key: "hold", label: "Hold", fn: () => actions.onHold(orderId) });
    if (access.canHand) {
      items.push({ key: "hand", label: isHand ? "Clear Hand" : "Hand — dealer collects", fn: () => actions.onHand(orderId, !isHand) });
    }
    if (access.canCancel && d.workflowStage !== "cancelled") {
      items.push(
        inTintRoom
          ? { key: "stop", label: "Stop & cancel", danger: true, fn: () => actions.onStopCancel({ ...bill, operatorName, status: status ?? "" }) }
          : { key: "cancel", label: "Cancel bill", danger: true, fn: () => actions.onCancel(bill) },
      );
    }
    if (access.canCi && d.workflowStage !== "cancelled") {
      items.push({ key: "ci", label: "Raise CI (cancels)", danger: true, fn: () => actions.onRaiseCi(bill) });
    }
    if (target.kind === "pending" && canRemove) {
      items.push({ key: "remove", label: "Remove OBD", fn: () => actions.onRemove(target.order) });
    }
  }

  const slotValue = d ? slotValueOf(d.dispatchTargetDate, d.dispatchWindowId, d.dispatchWindowTime) : null;
  const slotText = d?.dispatchTargetDate ? slotLabel(d.dispatchTargetDate, d.dispatchWindowTime) : "No slot";
  const canSlotHere = access.canSlot && d !== null && d.workflowStage !== "cancelled";

  async function saveShipTo(customerId: number | null) {
    setShipBusy(true);
    try {
      const ok = await actions.onShipTo(orderId, customerId);
      if (ok) { setEditingShipTo(false); await load(); }
    } finally {
      setShipBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[49]" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 z-[50] flex w-[472px] flex-col bg-white shadow-[-14px_0_40px_rgba(17,24,39,0.10)]">
        {changedElsewhere && (
          <div role="status" className="flex items-center gap-2 border-b border-gray-200 bg-[#fcfcfd] px-5 py-1.5 text-[11.5px] text-gray-600">
            Changed elsewhere
            <button type="button" disabled={busy} onClick={() => onReloadChanged?.()} className="ml-auto font-semibold text-brand-600 disabled:opacity-40">
              Reload
            </button>
          </div>
        )}

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="px-5 pt-3.5 pb-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-bold text-gray-900" title={siteName}>{siteName}</p>
              <p className="mt-0.5 truncate text-[12px] text-gray-500">billed to {d?.billToName ?? "—"}</p>
              {d?.isShipToOverride && d.customerName && (
                // Floor's ORIGINAL → REDIRECT pair (CLAUDE_FLOOR §4.9).
                <p className="mt-0.5 truncate text-[11px] text-brand-800" title={`${d.customerName} → ship to ${d.shipToName}`}>
                  {d.customerName}<span className="mx-1 opacity-60">→</span><b className="font-semibold">{d.shipToName}</b>
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Close">
              <X size={15} />
            </button>
          </div>

          {/* Identity line: OBD · date · slot chip · status · Hold / Hand */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="font-mono text-[13px] font-semibold text-gray-900">{bill.obdNumber}</span>
            <span className="text-[11px] tabular-nums text-gray-400">{istDateTime(d?.obdDateTime ?? null)}</span>
            {d && (canSlotHere ? (
              <SlotPickerButton
                value={slotValue}
                onPick={(v) => actions.onSetSlot(orderId, v)}
                windows={windows}
                disabled={busy || windows.length === 0}
                popoverDir="down"
                popoverAlign="left"
                className={cn(
                  "inline-flex h-[24px] items-center rounded-md border bg-white px-2 text-[11px] transition-colors hover:border-gray-400 hover:bg-gray-50",
                  slotValue ? "border-gray-300 text-gray-700" : "border-dashed border-gray-300 text-gray-400",
                )}
              >
                {slotText}
              </SlotPickerButton>
            ) : (
              <span className="text-[11px] text-gray-500">{slotText}</span>
            ))}
            {status === "waiting" && (
              <span className="rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]">Waiting</span>
            )}
            {status === "cancelled" && (
              <span className="rounded-[4px] bg-[#fef2f2] px-2 py-[2px] text-[10px] font-semibold text-[#b91c1c]">Cancelled</span>
            )}
            {status && status !== "waiting" && status !== "cancelled" && (
              <StatusPill status={status} at={row?.statusAt ?? null} pauseCount={row?.pauseCount ?? 0} />
            )}
            {held && <span className={`rounded-[4px] px-2 py-[2px] text-[10px] font-semibold ${ON_HOLD_PILL_CLS}`}>⚑ Hold</span>}
            {isHand && <HandBadge />}
            {row?.type === "split" && (
              <span className="inline-flex items-center gap-1 rounded-[3px] bg-warn-bg px-[5px] py-px text-[9.5px] font-bold text-warn-text">
                <Scissors size={8} /> Split #{row.splitNumber}
              </span>
            )}
            {d?.isKeyCustomer && <span title="Key customer" style={{ color: "#f59e0b" }}>★</span>}
            {d?.priorityLevel === 1 && <span title="Urgent" style={{ color: "#ef4444" }}>⚡</span>}
          </div>

          {target.kind === "pending" && target.order.customerMissing && (
            <button
              type="button"
              onClick={() => actions.onResolveMissing(target.order)}
              className="mt-2.5 flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-left text-[11px] text-amber-800 transition-colors hover:bg-amber-100"
            >
              <AlertCircle size={13} className="mt-[1px] flex-shrink-0" />
              <span>Customer master data is missing. Resolve it before assigning — click to open.</span>
            </button>
          )}
        </div>

        {/* ── Action row — or the ship-to editor, or the send-back confirm ── */}
        {editingShipTo ? (
          <ShipToEditor
            busy={shipBusy}
            searchUrl="/api/tint/manager/ship-to-search"
            onCancel={() => setEditingShipTo(false)}
            onPick={(customerId) => { void saveShipTo(customerId); }}
            onClear={d?.isShipToOverride ? () => { void saveShipTo(null); } : undefined}
          />
        ) : confirmSendBack && row ? (
          <div className="border-y border-gray-200 bg-gray-50 px-4 py-2.5">
            <p className="mb-2 text-[11.5px] text-gray-700">
              Send {row.type === "split" ? `split #${row.splitNumber}` : "this bill"} back to the rail?{" "}
              <span className="text-gray-500">
                {row.operatorName.split(" ")[0]} loses it from their queue and it becomes unassigned again.
                {row.type === "split" && " The split's line allocation is released."}
              </span>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmSendBack(false)} className={NEUTRAL_BTN}>Back</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setConfirmSendBack(false); actions.onSendBack(row); }}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-md bg-amber-600 px-3.5 text-[12px] font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                <Undo2 size={12} /> Yes, send back
              </button>
            </div>
          </div>
        ) : (
          <div className="relative flex items-center gap-2 border-y border-gray-200 bg-gray-50 px-4 py-2.5">
            {primary()}
            {access.canShipTo && d && d.workflowStage !== "cancelled" && (
              <button type="button" onClick={() => setEditingShipTo(true)} className={NEUTRAL_BTN}>Ship-to</button>
            )}
            {items.length > 0 && (
              <div className="relative ml-auto">
                <button
                  type="button"
                  onClick={() => setMoreOpen((o) => !o)}
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-gray-300 bg-white text-[14px] leading-none text-gray-500 hover:bg-gray-50"
                  title="More"
                >
                  ⋯
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                    <div className="absolute right-0 z-20 mt-1 w-[190px] overflow-hidden rounded-[8px] border border-gray-200 bg-white shadow-lg">
                      {items.map((it) => (
                        <button
                          key={it.key}
                          type="button"
                          disabled={busy}
                          onClick={() => { setMoreOpen(false); it.fn(); }}
                          className={cn(
                            "block w-full px-3 py-2 text-left text-[11.5px] hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400",
                            it.danger ? "text-danger-text" : "text-gray-700",
                          )}
                        >
                          {it.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {menuAnchor && target.kind === "pending" && (
              <OperatorMenu
                anchor={menuAnchor}
                operators={operators}
                onClose={() => setMenuAnchor(null)}
                onPick={(opId) => { setMenuAnchor(null); actions.onAssign(target.order, opId); }}
                extraAction={{
                  label: "Base — No Tint",
                  hint:  "No tinting needed — close this bill without an operator",
                  onPick: () => { setMenuAnchor(null); actions.onBaseBypass(target.order); },
                }}
              />
            )}
            {menuAnchor && row && (
              <OperatorMenu
                anchor={menuAnchor}
                label="Move to"
                operators={operators}
                currentId={row.operatorId}
                onClose={() => setMenuAnchor(null)}
                onPick={(opId) => {
                  setMenuAnchor(null);
                  if (row.type === "split") actions.onReassignSplit(row, opId);
                  else actions.onReassignOrder(row, opId);
                }}
              />
            )}
          </div>
        )}
        {error && (
          <p className="mx-4 mt-2 rounded-md border border-danger-bd bg-danger-bg px-2 py-1.5 text-[11px] text-danger-text">{error}</p>
        )}

        {/* ── Tabs — only those this person holds a tick for ──────────────── */}
        {visibleTabs.length > 1 && (
          <div className="flex gap-5 border-b border-gray-200 px-5">
            {visibleTabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`border-b-2 py-[11px] text-[12px] capitalize ${
                  activeTab === t ? "border-gray-900 font-bold text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "items" && d ? `Items ${d.lines.length}` : t === "activity" && d ? `Activity ${d.activity.length}` : t}
              </button>
            ))}
          </div>
        )}

        {/* ── Body (scrolls) ─────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === null && <p className="px-5 py-4 text-[11.5px] text-gray-400">No access to job details</p>}
          {activeTab !== null && !d && (
            <p className="px-5 py-4 text-[11.5px] text-gray-400">{loadError ? `Couldn’t load this bill. ${loadError}` : "Loading…"}</p>
          )}

          {d && activeTab === "items" && (
            <>
              {row?.type === "split" && (
                <p className="px-5 pt-3 text-[11px] text-gray-500">Split #{row.splitNumber} — the whole bill&apos;s lines are shown.</p>
              )}
              <DetailItems lines={d.lines} totalLitres={d.totalLitres} />
            </>
          )}

          {d && activeTab === "details" && (
            <>
              <DetailDetails d={d} />
              <div className="px-5 pb-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.05em] text-gray-400">Audit history</p>
                <OrderAuditHistory orderId={orderId} isOpen />
              </div>
            </>
          )}

          {d && activeTab === "activity" && (
            <div>
              {/* The operator box — the tint facts the shared payload carries. */}
              <div className="px-5 pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.05em] text-gray-400">Tint</p>
                {d.tint?.operatorName ? (
                  <div className="mb-3 rounded-lg border border-tint-bd bg-tint-bg px-3 py-2.5 text-[11.5px] text-tint-700">
                    <div className="flex items-center gap-2">
                      <OperatorAvatar name={d.tint.operatorName} done={status === "tinting_done"} size={26} />
                      <span className="flex-1 truncate text-[12px] font-semibold text-gray-900">{d.tint.operatorName}</span>
                      {status && status !== "waiting" && status !== "cancelled" && (
                        <StatusPill status={status} at={null} pauseCount={0} />
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      <span>Assigned <b className="text-gray-900">{istDateTime(d.tint.assignedAt)}</b></span>
                      <span>Started <b className="text-gray-900">{istDateTime(d.tint.startedAt)}</b></span>
                      {d.tint.completedAt && <span>Done <b className="text-gray-900">{istDateTime(d.tint.completedAt)}</b></span>}
                      {d.tint.hasSplits && <span>Shades <b className="text-gray-900">{d.tint.shadesDone}/{d.tint.shadesTotal}</b></span>}
                    </div>
                  </div>
                ) : (
                  <p className="mb-3 text-[11.5px] text-gray-400">Not assigned yet — no tint activity.</p>
                )}

                {/* Pause / skip — READ-ONLY here; those live on the operator's screen. */}
                {order?.pauseSummary && order.pauseSummary.count > 0 && (
                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
                    <p className="text-[10.5px] font-semibold text-amber-800">
                      Paused {order.pauseSummary.count}× · last {istDateTime(order.pauseSummary.lastPausedAt)}
                    </p>
                    <p className="text-[10.5px] text-amber-700">
                      {order.pauseSummary.lastPausedBy} · {humaniseReason(order.pauseSummary.lastReason)}
                    </p>
                    <button
                      type="button"
                      onClick={() => actions.onOpenPauseHistory(orderId, bill.obdNumber, siteName)}
                      className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-amber-800 underline hover:text-amber-900"
                    >
                      <Pause size={9} /> View full pause history →
                    </button>
                  </div>
                )}
                {order?.skipSummary && order.skipSummary.count > 0 && (
                  <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
                    <p className="text-[10.5px] font-semibold text-gray-700">
                      Skipped {order.skipSummary.count}× · last {istDateTime(order.skipSummary.lastSkippedAt)}
                    </p>
                    <p className="text-[10.5px] text-gray-500">
                      {order.skipSummary.lastSkippedBy} · {order.skipSummary.lastReason}
                    </p>
                    <button
                      type="button"
                      onClick={() => actions.onOpenSkipHistory(orderId, bill.obdNumber, siteName)}
                      className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-gray-600 underline hover:text-gray-900"
                    >
                      <SkipForward size={9} /> View full skip history →
                    </button>
                  </div>
                )}
                {order && !order.pauseSummary?.count && !order.skipSummary?.count && (
                  <p className="mb-2 inline-flex items-center gap-1.5 text-[11.5px] text-gray-400">
                    <History size={11} /> No pauses or skips on this job.
                  </p>
                )}
              </div>
              <DetailActivity d={d} />
            </div>
          )}
        </div>

        {/* ── Prev / Next — pinned; walks the list the panel was opened from ── */}
        <div className="flex items-center gap-2 border-t border-gray-200 bg-white px-5 py-2.5 text-[11.5px] shadow-[0_-4px_14px_rgba(17,24,39,0.05)]">
          <button
            type="button"
            disabled={position.index <= 0}
            onClick={onPrev}
            className="rounded-[6px] border border-gray-200 px-3 py-[6px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
          >
            ‹ Previous
          </button>
          <span className="mx-auto text-[11px] text-gray-400">
            {position.index >= 0 ? position.index + 1 : "—"} of {position.total} in this list
          </span>
          <button
            type="button"
            disabled={position.index < 0 || position.index >= position.total - 1}
            onClick={onNext}
            className="rounded-[6px] border border-gray-200 px-3 py-[6px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      </aside>
    </>
  );
}

// Floor's panel button classes (components/floor/detail-panel.tsx), copied.
const BRAND_BTN =
  "inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-md border border-brand-600 bg-brand-600 px-3.5 text-[12px] font-semibold text-white enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400";
const NEUTRAL_BTN =
  "inline-flex h-[34px] items-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-3.5 text-[12px] font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50";
const GREY_BTN =
  "inline-flex h-[34px] items-center whitespace-nowrap rounded-md border border-gray-200 bg-gray-100 px-3.5 text-[12px] font-semibold text-gray-400 cursor-not-allowed";
