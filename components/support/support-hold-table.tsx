"use client";

import React, { useState, useMemo } from "react";
import { Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { CancelOrderDialog } from "@/components/support/cancel-order-dialog";
import { ShipToOverrideCell } from "@/components/support/ship-to-override-cell";
import { DispatchSlotPicker } from "@/components/support/dispatch-slot-picker";
import type { DispatchSlotValue, DispatchWindow } from "@/components/support/dispatch-slot-picker";
import type { SupportOrder } from "@/components/support/support-orders-table";
import {
  SUPPORT_HOLD_GRID_COLUMNS,
  formatArticleTag,
  getPriLabel,
  VolCell,
  CustomerCell,
  groupOrders,
} from "@/components/support/shared/table-cells";
import type { GroupBy, OrderGroup } from "@/components/support/shared/table-cells";

// ── CSS Grid constant — Hold's own percentage tracks (no Status column,
// Action moved to the trailing edge — see shared/table-cells.tsx for the
// per-column rationale, kept alongside the main board's constant so the two
// cannot drift apart unnoticed) ──────────────────────────────────────────────
const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: SUPPORT_HOLD_GRID_COLUMNS,
  gap: "0 0",
  alignItems: "center",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatHoldDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const day = d.getDate();
  const mon = d.toLocaleString("en", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} · ${hh}:${mm}`;
}

// HOLD SINCE reads heldAt (the hold-anchor date), not updatedAt — updatedAt
// gets bumped by any unrelated edit (e.g. a priority change), which would
// silently reset the "how long has this been on hold" signal to 0 days.
// heldAt is nullable on legacy rows (CLAUDE_SUPPORT.md §7 landmine); render
// "—" rather than a misleading "0d" when absent.
function getHoldDays(order: SupportOrder): number | null {
  const ref = order.heldAt;
  if (!ref) return null;
  const diffMs = Date.now() - new Date(ref).getTime();
  return Math.max(1, Math.floor(diffMs / 86400000));
}

// CustomerCell requires an onMissing callback; Hold renders it with
// showBadges=false (no wired Missing-resolution flow), so this is never
// actually invoked — a real no-op, not a placeholder for future wiring.
function noopOnMissing() {}

// ── Component ─────────────────────────────────────────────────────────────────

interface SupportHoldTableProps {
  orders: SupportOrder[];
  dispatchWindows: DispatchWindow[];
  loading: boolean;
  onRelease: (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => Promise<void>;
  onCancel: (orderId: number, reason: string, note?: string) => Promise<void>;
  onShipToOverride: (orderId: number, customerId: number | null) => Promise<void>;
}

export function SupportHoldTable({
  orders,
  dispatchWindows,
  loading,
  onRelease,
  onCancel,
  onShipToOverride,
}: SupportHoldTableProps) {
  const [selectedHold, setSelectedHold] = useState<Set<number>>(new Set());
  const [holdSlots, setHoldSlots] = useState<Map<number, DispatchSlotValue>>(new Map());
  const [bulkSlot, setBulkSlot] = useState<DispatchSlotValue | null>(null);
  const [holdBulkLoading, setHoldBulkLoading] = useState(false);
  const [holdCancelDialog, setHoldCancelDialog] = useState<{ open: boolean; orderId: number | null; obdNumber: string | null }>({
    open: false, orderId: null, obdNumber: null,
  });
  const [groupBy, setGroupBy] = useState<GroupBy>("smu");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Grouping is purely a display grouping over `orders`. Selection
  // (selectedHold) and staged slots (holdSlots) stay keyed by orderId at the
  // top level regardless of how rows are grouped/collapsed — grouping never
  // touches either Set/Map's keys, only which rows are visible under which
  // header.
  const groups: OrderGroup[] = useMemo(() => groupOrders(orders, groupBy), [orders, groupBy]);
  const showGroupHeader = groupBy !== "none";

  // Slot picks are STAGED locally only — this must never call a commit path
  // (onSingleDispatch-style). Release is the only action that writes to the
  // server, and it reads from this same Map. Copying the main board's
  // immediate-commit DispatchSlotPicker wiring here would silently
  // auto-dispatch a held order the instant a slot is picked.
  function setRowSlot(orderId: number, v: DispatchSlotValue | null) {
    setHoldSlots((prev) => {
      const next = new Map(prev);
      if (v) next.set(orderId, v);
      else next.delete(orderId);
      return next;
    });
  }

  function toggleOne(id: number) {
    setSelectedHold((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleAll() {
    if (selectedHold.size === orders.length) setSelectedHold(new Set());
    else setSelectedHold(new Set(orders.map((o) => o.id)));
  }

  function toggleGroup(name: string) {
    setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  }

  function toggleGroupSelect(ids: number[], selectAll: boolean) {
    setSelectedHold((prev) => {
      const next = new Set(prev);
      if (selectAll) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  async function handleSingleRelease(orderId: number) {
    const slot = holdSlots.get(orderId);
    if (!slot) return;
    try {
      await onRelease(orderId, { dispatchTargetDate: slot.date, dispatchWindowId: slot.dispatchWindowId });
      setRowSlot(orderId, null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Release failed");
    }
  }

  async function handleBulkRelease() {
    if (!bulkSlot) return;
    setHoldBulkLoading(true);
    try {
      const ids = Array.from(selectedHold);
      for (const id of ids) {
        await onRelease(id, { dispatchTargetDate: bulkSlot.date, dispatchWindowId: bulkSlot.dispatchWindowId });
      }
      setSelectedHold(new Set());
      setHoldSlots(new Map());
      setBulkSlot(null);
    } finally {
      setHoldBulkLoading(false);
    }
  }

  return (
    <div className="flex-1 overflow-auto pb-14">
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-400 py-16 text-center">No orders on hold</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-500">
                {orders.length} order{orders.length !== 1 ? "s" : ""} on hold — follow up to release
              </p>
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  Group by
                  <select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                    className="h-[26px] px-1.5 pr-5 text-[11px] border border-gray-200 rounded bg-white text-gray-700 focus:outline-none focus:border-gray-300 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:14px] bg-[right_2px_center] bg-no-repeat"
                  >
                    <option value="none">None</option>
                    <option value="smu">SMU</option>
                    <option value="route">Route</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {selectedHold.size === orders.length ? "Deselect All" : "Select All"}
                </button>
              </div>
            </div>

            {/* Column headers */}
            <div style={GRID} className="py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
              <div className="px-3.5 text-center">
                <Checkbox
                  checked={orders.length > 0 && selectedHold.size === orders.length}
                  onCheckedChange={toggleAll}
                />
              </div>
              <div className="px-3.5">OBD</div>
              <div className="px-3.5">Customer</div>
              <div className="px-3.5">Ship-to</div>
              <div className="px-3.5 text-center">Hold Since</div>
              <div className="px-3.5">Route</div>
              <div className="px-3.5 text-right">Vol</div>
              <div className="px-3.5 whitespace-nowrap">Article</div>
              <div className="px-3.5">Slot</div>
              <div className="px-3.5">Priority</div>
              <div className="px-3.5 text-right">Action</div>
            </div>

            {/* Groups + rows */}
            {groups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.groupName);
              const groupIds = group.orders.map((o) => o.id);
              const groupSelectedCount = groupIds.filter((id) => selectedHold.has(id)).length;
              const groupAllSelected = groupIds.length > 0 && groupSelectedCount === groupIds.length;
              const groupIndeterminate = groupSelectedCount > 0 && !groupAllSelected;

              return (
                <React.Fragment key={group.groupName}>
                  {showGroupHeader && (
                    <div
                      className="flex items-center gap-2 py-2 px-1 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => toggleGroup(group.groupName)}
                    >
                      <div data-checkbox onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={groupAllSelected}
                          indeterminate={groupIndeterminate}
                          onCheckedChange={() => toggleGroupSelect(groupIds, !groupAllSelected)}
                        />
                      </div>
                      <ChevronDown size={14} className={cn("text-gray-400 transition-transform", isCollapsed && "-rotate-90")} />
                      <span className="text-xs font-medium text-gray-700">{group.groupName}</span>
                      <span className="text-[11px] text-gray-400">{group.orders.length} pending</span>
                    </div>
                  )}
                  {!isCollapsed && group.orders.map((order) => {
                    const holdDays = getHoldDays(order);
                    const holdBadgeCls = holdDays == null
                      ? "text-gray-300 bg-gray-50"
                      : holdDays >= 2
                      ? "text-red-600 bg-red-50"
                      : "text-amber-600 bg-amber-50";
                    const delType = order.customer?.dispatchDeliveryType?.name ?? order.customer?.area?.deliveryType?.name ?? null;
                    const isSelected = selectedHold.has(order.id);
                    const slot = holdSlots.get(order.id) ?? null;

                    return (
                      <div
                        key={order.id}
                        style={GRID}
                        className={cn(
                          "py-2 border-b border-gray-50/80 hover:bg-gray-50/50 transition-colors",
                          isSelected && "bg-teal-50/20",
                        )}
                      >
                        {/* Checkbox */}
                        <div className="px-3.5 text-center" data-checkbox>
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(order.id)} />
                        </div>

                        {/* OBD — number + date/time only; no Overdue badge on this
                            board (Hold Since already carries the age signal that
                            matters for the release decision — see report) */}
                        <div className="px-3.5">
                          <p className="font-mono font-semibold text-xs tabular-nums text-gray-800">
                            {order.obdNumber}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {formatHoldDate(order.orderDateTime ?? order.obdEmailDate)}
                          </p>
                        </div>

                        {/* Customer — shared component; Missing/tinting badges suppressed
                            (Hold has no wired Missing-resolution flow to back them) */}
                        <div className="min-w-0 px-3.5">
                          <CustomerCell
                            customerName={order.customer?.customerName}
                            fallbackName={order.shipToCustomerName}
                            shipToCustomerId={order.shipToCustomerId}
                            customerMissing={order.customerMissing}
                            hasTinting={order.querySnapshot?.hasTinting}
                            muted={false}
                            showBadges={false}
                            onMissing={noopOnMissing}
                          />
                        </div>

                        {/* Ship-to — editable, same PATCH handler shape as the main board */}
                        <div className="min-w-0 px-3.5" title={order.shipToOverrideCustomer?.customerName ?? undefined}>
                          <ShipToOverrideCell
                            orderId={order.id}
                            current={
                              order.shipToOverrideCustomer
                                ? { id: order.shipToOverrideCustomer.id, customerName: order.shipToOverrideCustomer.customerName }
                                : null
                            }
                            onSave={onShipToOverride}
                          />
                        </div>

                        {/* Hold Since — reads heldAt, centre-aligned pill */}
                        <div className="px-3.5 text-center">
                          <span className={cn("text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full inline-block", holdBadgeCls)}>
                            {holdDays != null ? `${holdDays}d` : "—"}
                          </span>
                        </div>

                        {/* Route — same as main board */}
                        <div className="min-w-0 px-3.5">
                          <p className="text-xs truncate text-gray-600">
                            {order.customer?.area?.primaryRoute?.name ?? "—"}
                          </p>
                          {delType && (
                            <span className="text-[10px] truncate block text-gray-400">
                              {delType}
                            </span>
                          )}
                        </div>

                        {/* Vol — shared stacked cell; importVolume (litres), not
                            totalUnitQty (a unit count) — data source correction */}
                        <div className="px-3.5 text-right">
                          <VolCell importVolume={order.importVolume} materialType={order.materialType} muted={false} />
                        </div>

                        {/* Article — shared formatArticleTag */}
                        <div className="min-w-0 px-3.5">
                          <p
                            className="text-xs whitespace-nowrap truncate text-gray-600"
                            title={order.querySnapshot?.articleTag ?? undefined}
                          >
                            {order.querySnapshot?.articleTag != null ? formatArticleTag(order.querySnapshot.articleTag) : "—"}
                          </p>
                        </div>

                        {/* Slot — DispatchSlotPicker STAGES into holdSlots only */}
                        <div className="px-3.5">
                          <DispatchSlotPicker
                            value={slot}
                            onChange={(v) => setRowSlot(order.id, v)}
                            windows={dispatchWindows}
                          />
                        </div>

                        {/* Priority — read-only label; Hold is not where priority is edited */}
                        <div className="px-3.5">
                          <span className={cn(
                            "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border cursor-default",
                            String(order.priorityLevel) === "1" ? "bg-red-50 border-red-200 text-red-600" :
                            String(order.priorityLevel) === "2" ? "bg-amber-50 border-amber-200 text-amber-600" :
                                                                   "bg-gray-50 border-gray-200 text-gray-500",
                          )}>
                            {getPriLabel(String(order.priorityLevel))}
                          </span>
                        </div>

                        {/* Action — Release / Cancel, trailing edge, right-aligned */}
                        <div className="px-3.5 flex items-center justify-end gap-3">
                          <button
                            type="button"
                            disabled={!slot}
                            onClick={() => void handleSingleRelease(order.id)}
                            className="text-[11px] font-semibold transition-colors disabled:text-gray-300 disabled:cursor-not-allowed text-teal-600 hover:text-teal-700"
                          >
                            Release
                          </button>
                          <button
                            type="button"
                            onClick={() => setHoldCancelDialog({ open: true, orderId: order.id, obdNumber: order.obdNumber })}
                            className="text-[11px] text-gray-400 hover:text-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      {/* Sticky bar for bulk release — left-[72px] matches the sidebar width
          (CLAUDE_SUPPORT.md §4.13); the main board's bar uses the same offset
          for the same reason. Previously left-14 (56px), tucking the bar
          16px under the sidebar — fixed here. */}
      <div
        className={cn(
          "fixed bottom-0 left-[72px] right-0 z-50 transform transition-transform duration-200",
          selectedHold.size > 0 ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between px-5 py-2">
            <span className="text-xs font-medium text-gray-700">{selectedHold.size} selected</span>
            <div className="flex items-center gap-3">
              <DispatchSlotPicker
                value={bulkSlot}
                onChange={setBulkSlot}
                windows={dispatchWindows}
                popoverDir="up"
              />
              <button
                type="button"
                onClick={() => { setSelectedHold(new Set()); setBulkSlot(null); }}
                className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={!bulkSlot || holdBulkLoading}
                onClick={() => void handleBulkRelease()}
                className="px-4 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-md hover:bg-teal-700 flex items-center gap-1.5 disabled:opacity-50 transition-colors"
              >
                {holdBulkLoading && <Loader2 size={12} className="animate-spin" />}
                Release {selectedHold.size} Order{selectedHold.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cancel dialog */}
      <CancelOrderDialog
        open={holdCancelDialog.open}
        onOpenChange={(v) => setHoldCancelDialog((p) => ({ ...p, open: v }))}
        orderId={holdCancelDialog.orderId}
        obdNumber={holdCancelDialog.obdNumber}
        onConfirm={onCancel}
      />
    </div>
  );
}
