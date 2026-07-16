"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, ChevronDown, Check, Star, Zap, ArrowRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { getTodayIST } from "@/lib/dates";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickingQueueResult } from "@/lib/picking/queue";

// Real /api/warehouse/pickers response shape — do not invent fields.
interface Picker {
  id: number;
  name: string;
  avatarInitial: string;
  status: "available" | "picking";
  assignedCount: number;
  pickedCount: number;
  pendingCount: number;
  totalKg: number;
}

interface AssignResponse {
  assigned?: number;
  failed?: { orderId: number; error: string }[];
  error?: string;
}

// Real GET /api/picking/order/[orderId] response shape — see that route.
interface LineItem {
  id: number;
  name: string | null;
  sku: string;
  pack: string | null;
  qty: number;
}

// Card shell shadow — lifted verbatim from app/po/po-page.tsx's SOFT_CARD_SHADOW
// (the /po visual reference this board is styled to match).
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)";

type TypeFilter = "All" | "Local" | "Upcountry";

// Square checkbox — matches po-page.tsx's multi-select row checkbox exactly
// (rounded-[6px], border-2, teal-600 fill + white check svg when selected),
// per docs/mockups/picking/supervisor-assign-board.html (the approved design).
function SelectBox({ checked }: { checked: boolean }) {
  return (
    <div
      className={
        "w-5 h-5 rounded-[6px] border-2 flex items-center justify-center shrink-0 " +
        (checked ? "bg-teal-600 border-teal-600" : "bg-white border-gray-300")
      }
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

export function PickingBoardMobile(): React.JSX.Element {
  // Same fetch-on-date-change shape as components/picking/picking-queue.tsx —
  // no date UI in this stage, so this never changes, but the pattern stays
  // date-driven for whenever a date control is added.
  const [selectedDate] = useState<string>(() => getTodayIST());
  const [data, setData] = useState<PickingQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<TypeFilter>("All");
  const [activeRoute, setActiveRoute] = useState<string | null>(null); // null = "All routes"
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [assignedOpen, setAssignedOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [pickers, setPickers] = useState<Picker[]>([]);
  const [pickersLoading, setPickersLoading] = useState(true);
  const [pickerSheetOpen, setPickerSheetOpen] = useState(false);
  // In-flight guard — disables the Assign button + every picker row so a
  // double-tap can't fire two overlapping POSTs.
  const [assigning, setAssigning] = useState(false);
  // Per-row Undo in-flight guard — a Set (not a single scalar) so tapping
  // Undo on one assigned row never disables another row's Undo, and two
  // rows undone in quick succession can't lose track of each other.
  const [unassigningIds, setUnassigningIds] = useState<Set<number>>(new Set());

  // Detail screen — a full-screen overlay that stays MOUNTED (translateX
  // slide, per the approved mockup) rather than conditionally rendered, so
  // the board underneath (filters + scroll position) is never torn down.
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[] | null>(null);
  const [lineItemsLoading, setLineItemsLoading] = useState(false);
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);

  // Which rows the OPEN picker sheet will act on — bulk (floating bar, from
  // the current selection) or single (detail screen's own CTA). Decoupled
  // from `selected` so the two flows never fight over the same state.
  const [assignTarget, setAssignTarget] = useState<PickingQueueRow[]>([]);

  const fetchQueue = useCallback(async (): Promise<PickingQueueResult> => {
    const res = await fetch(`/api/picking/queue?date=${selectedDate}`);
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    return res.json();
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await fetchQueue();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load picking queue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchQueue]);

  // Picker roster for the assign sheet — same endpoint desktop uses, fetched
  // once (the picker roster doesn't change within a session).
  useEffect(() => {
    let cancelled = false;
    async function loadPickers() {
      try {
        const res = await fetch("/api/warehouse/pickers");
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { pickers?: Picker[] };
        if (!cancelled) setPickers(json.pickers ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Failed to load pickers");
      } finally {
        if (!cancelled) setPickersLoading(false);
      }
    }
    void loadPickers();
    return () => {
      cancelled = true;
    };
  }, []);

  // Line items for the detail screen — fetched on demand per the task brief
  // ("do NOT bloat the main queue payload"). Re-fires only when the target
  // order changes, not on every open/close of the same order.
  useEffect(() => {
    if (detailOrderId === null) return;
    let cancelled = false;
    setLineItemsLoading(true);
    setLineItemsError(null);
    setLineItems(null);
    async function load() {
      try {
        const res = await fetch(`/api/picking/order/${detailOrderId}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { lines?: LineItem[] };
        if (!cancelled) setLineItems(json.lines ?? []);
      } catch (err) {
        if (!cancelled) setLineItemsError(err instanceof Error ? err.message : "Failed to load line items");
      } finally {
        if (!cancelled) setLineItemsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [detailOrderId]);

  // Post-assign refetch — never patch rows locally. Mirrors
  // picking-queue.tsx's refetchAfterAction: does not touch loading/error UI,
  // just replaces data with a fresh server read.
  const refetchQueue = useCallback(async () => {
    try {
      const json = await fetchQueue();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh picking queue");
    }
  }, [fetchQueue]);

  // data.rows arrives already sorted server-side (lib/picking/sort.ts
  // PICKING_SPINE — assigned-sink leads, window next). Array.filter preserves
  // that order; NOTHING here re-sorts or re-groups.
  const waitingRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => !r.isAssigned) : []),
    [data],
  );
  const assignedRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => r.isAssigned) : []),
    [data],
  );

  // Route list — distinct non-null `route` across ALL waiting rows (stable,
  // not narrowed by the Type pill). Counts DO reflect the current Type pill
  // (live), mirroring the approved mockup's route sheet exactly.
  const availableRoutes = useMemo(() => {
    const set = new Set<string>();
    for (const r of waitingRows) {
      if (r.route !== null) set.add(r.route);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  }, [waitingRows]);

  const routeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of waitingRows) {
      if (r.route === null) continue;
      if (activeType !== "All" && r.deliveryType !== activeType) continue;
      map.set(r.route, (map.get(r.route) ?? 0) + 1);
    }
    return map;
  }, [waitingRows, activeType]);

  const q = query.trim().toLowerCase();
  const filteredWaiting: PickingQueueRow[] = useMemo(() => {
    return waitingRows.filter((r) => {
      if (activeType !== "All" && r.deliveryType !== activeType) return false;
      if (activeRoute !== null && r.route !== activeRoute) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [waitingRows, activeType, activeRoute, q]);

  const totalLitres = filteredWaiting.reduce((sum, r) => sum + (r.volumeLitres ?? 0), 0);
  const allRoutesCount = Array.from(routeCounts.values()).reduce((a, b) => a + b, 0);

  function toggleSelect(orderId: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  const laneLabel =
    [activeType !== "All" ? (activeType === "Upcountry" ? "UPC" : activeType) : null, activeRoute]
      .filter(Boolean)
      .join(" · ") || "All routes";

  // Selected rows narrowed to what's currently VISIBLE under the active
  // type/route/search filters — a row hidden by a later filter change drops
  // out of the bar/assign payload rather than silently riding along
  // uncounted (its checkbox still shows checked if the filter is reverted;
  // it just doesn't count or get submitted while hidden).
  const selectedRows = filteredWaiting.filter((r) => selected.has(r.orderId));
  const selectedLitres = selectedRows.reduce((sum, r) => sum + (r.volumeLitres ?? 0), 0);
  const pickerSheetSubtitle =
    assignTarget.length === 1
      ? `1 bill · ${assignTarget[0].dealerName}`
      : `${assignTarget.length} bills selected`;

  // The row the detail screen is currently showing — looked up fresh from
  // `data` each render (not a captured snapshot) so it reflects the latest
  // fetch if something changed the row while the screen was open.
  const detailRow: PickingQueueRow | null = useMemo(() => {
    if (!data || detailOrderId === null) return null;
    return data.rows.find((r) => r.orderId === detailOrderId) ?? null;
  }, [data, detailOrderId]);

  function openDetail(orderId: number): void {
    setDetailOrderId(orderId);
    setDetailOpen(true);
  }

  function closeDetail(): void {
    setDetailOpen(false);
  }

  // Opens the shared picker sheet targeted at a single row — the detail
  // screen's own "Assign to picker" CTA, independent of the bulk selection.
  function openPickerForRow(row: PickingQueueRow): void {
    setAssignTarget([row]);
    setPickerSheetOpen(true);
  }

  const handleAssign = useCallback(
    async (pickerId: number, pickerName: string) => {
      if (assignTarget.length === 0 || assigning) return;
      setAssigning(true);
      try {
        const res = await fetch("/api/picking/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds: assignTarget.map((r) => r.orderId), pickerId }),
        });
        const json = (await res.json().catch(() => ({}))) as AssignResponse;
        if (!res.ok) {
          // Hard error / non-200 — keep selection intact so they can retry,
          // sheet stays open.
          toast.error(json.error ?? `Request failed (${res.status})`);
          return;
        }
        const assignedCount = json.assigned ?? 0;
        const failedList = json.failed ?? [];
        if (failedList.length > 0) {
          // Partial failure — the endpoint didn't abort the batch; never
          // report this as a clean success.
          toast(`${assignedCount} assigned, ${failedList.length} couldn't be assigned`);
        } else {
          toast.success(`${assignedCount} ${assignedCount === 1 ? "bill" : "bills"} → ${pickerName}`);
        }
        setSelected(new Set());
        setPickerSheetOpen(false);
        // Closes the detail screen too when the assign came from its own
        // CTA — a harmless no-op when it came from the bulk floating bar,
        // since detail isn't open in that case.
        setDetailOpen(false);
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Assign failed");
      } finally {
        setAssigning(false);
      }
    },
    [assignTarget, assigning, refetchQueue],
  );

  // Undo — mirrors picking-queue.tsx's handleUnassign: single-order payload
  // (no batch endpoint exists), refetch-after-action rather than patching
  // rows locally, and the same 409 handling (bill already moved out from
  // under us — refetch and say so honestly instead of a generic failure).
  const handleUndo = useCallback(
    async (row: PickingQueueRow) => {
      if (unassigningIds.has(row.orderId)) return;
      setUnassigningIds((prev) => new Set(prev).add(row.orderId));
      try {
        const res = await fetch("/api/picking/unassign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: row.orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          if (res.status === 409) {
            toast("Already changed — refreshed.");
            await refetchQueue();
          } else {
            toast.error(json.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        toast.success(`${row.dealerName} released`);
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Undo failed");
      } finally {
        setUnassigningIds((prev) => {
          const next = new Set(prev);
          next.delete(row.orderId);
          return next;
        });
      }
    },
    [unassigningIds, refetchQueue],
  );

  return (
    <div className="bg-[#f9fafb] min-h-screen">
      {/* Teal top bar — matches app/po/po-page.tsx's pinned brand bar */}
      <div
        className="bg-teal-600 px-4 pb-3 flex items-center justify-between gap-2.5 sticky top-0 z-20"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-[19px] font-extrabold text-white tracking-tight">Assign</h1>
          <span className="text-[11px] font-bold text-white bg-white/20 rounded-full px-2.5 py-[3px] whitespace-nowrap">
            {waitingRows.length} waiting
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSearching((v) => !v)}
          aria-label="Search"
          className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-white active:bg-white/15 shrink-0"
        >
          <Search size={19} />
        </button>
      </div>

      {/* Filter row + lane strip (swaps for search when active) */}
      <div className="bg-white border-b border-gray-200 px-4 pt-2.5">
        {searching ? (
          <div className="flex items-center gap-2 pb-2.5">
            <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2.5">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customer or OBD…"
                className="flex-1 bg-transparent border-none outline-none text-[15px] text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setSearching(false);
                setQuery("");
              }}
              className="text-[13px] font-semibold text-teal-700 px-1 shrink-0"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 pb-2.5">
              <div className="flex items-center gap-1.5">
                {(["All", "Local", "Upcountry"] satisfies TypeFilter[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActiveType(t)}
                    className={
                      "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap " +
                      (activeType === t
                        ? "bg-gray-900 border-gray-900 text-white font-semibold"
                        : "bg-white border-gray-200 text-gray-700")
                    }
                  >
                    {t === "Upcountry" ? "UPC" : t}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRouteSheetOpen(true)}
                className={
                  "flex-1 min-w-0 max-w-[150px] flex items-center justify-between gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border " +
                  (activeRoute !== null
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-gray-200 bg-white text-gray-500")
                }
              >
                <span className="truncate">{activeRoute ?? "All routes"}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
            </div>

            <div className="mx-[-16px] bg-teal-50 border-t border-teal-200 px-4 py-2 text-[12px] font-medium text-teal-700 flex items-center gap-1">
              <b className="font-bold">{laneLabel}</b>
              <span>
                &nbsp;·&nbsp;{filteredWaiting.length} waiting&nbsp;·&nbsp;{totalLitres} L ready to load
              </span>
            </div>
          </>
        )}
      </div>

      {/* Card list */}
      <div className="px-4 py-2.5">
        {loading && <p className="text-[13px] text-gray-400 text-center py-16">Loading queue&hellip;</p>}

        {!loading && error && (
          <p className="text-[13px] text-red-600 text-center py-16">
            Couldn&apos;t load the picking queue: {error}
          </p>
        )}

        {!loading &&
          !error &&
          data &&
          (filteredWaiting.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-16">No bills here right now.</p>
          ) : (
            filteredWaiting.map((row) => {
              const isSel = selected.has(row.orderId);
              return (
                <div
                  key={row.orderId}
                  className={
                    "flex items-start gap-[11px] bg-white rounded-[14px] p-[13px] mb-[9px] border-[1.5px] " +
                    (isSel ? "border-teal-600 bg-teal-50" : "border-transparent")
                  }
                  style={{ boxShadow: SOFT_CARD_SHADOW }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelect(row.orderId)}
                    aria-label={isSel ? "Deselect" : "Select"}
                    className="w-11 shrink-0 flex items-center justify-center pt-px"
                  >
                    <SelectBox checked={isSel} />
                  </button>
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => openDetail(row.orderId)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-[5px]">
                      <span className="flex items-baseline gap-[5px] min-w-0">
                        <span className="font-mono text-[11px] text-gray-400 whitespace-nowrap">
                          {row.obdNumber}
                        </span>
                        {row.windowTime !== null && (
                          <span className="text-[10.5px] text-gray-300 whitespace-nowrap">
                            &middot;{row.windowTime}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {row.isKeyCustomer && <Star size={14} className="text-amber-500 fill-amber-500" />}
                        {row.priorityLevel === 1 && <Zap size={14} className="text-amber-500 fill-amber-500" />}
                      </span>
                    </div>
                    <div className="text-[15px] font-bold text-gray-900 leading-tight mb-[3px] truncate">
                      {row.dealerName}
                    </div>
                    <div className="text-[12px] text-gray-500 truncate">
                      {row.area !== null ? (
                        <>
                          {row.area}
                          {row.articleTag !== null && (
                            <>
                              <span className="text-gray-300 mx-[5px]">&middot;</span>
                              {row.articleTag}
                            </>
                          )}
                        </>
                      ) : (
                        (row.articleTag ?? "—")
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ))}

        {/* Collapsed assigned strip — Undo wired below; detail screen (stage 7) still not built */}
        {!loading && !error && data && assignedRows.length > 0 && (
          <div className="mt-1.5 border-t border-gray-200 pt-0.5">
            <button
              type="button"
              onClick={() => setAssignedOpen((v) => !v)}
              className="flex items-center gap-[7px] py-3 px-[3px] w-full text-left"
            >
              <span
                className="text-[10px] text-gray-400 inline-block transition-transform"
                style={{ transform: assignedOpen ? "rotate(90deg)" : "none" }}
              >
                &#9656;
              </span>
              <span className="text-[12px] font-semibold text-gray-500">{assignedRows.length} assigned</span>
            </button>
            {assignedOpen && (
              <div>
                {assignedRows.map((row) => {
                  const isUndoing = unassigningIds.has(row.orderId);
                  return (
                    <div
                      key={row.orderId}
                      className="flex items-center justify-between gap-2 py-2.5 px-[3px] border-b border-gray-100 last:border-b-0 opacity-70"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-semibold text-gray-700 truncate">{row.dealerName}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{row.obdNumber}</div>
                        <div className="text-[11px] text-teal-700 font-semibold">
                          &rarr; {row.assignedToName ?? "—"}
                        </div>
                      </div>
                      {/* Padding + negative margins expand the tap target well past the
                          visible underlined text — finger-sized, and clearly separated
                          from the row body above so it can't be hit by accident. */}
                      <button
                        type="button"
                        onClick={() => void handleUndo(row)}
                        disabled={isUndoing}
                        aria-label={`Undo assignment for ${row.dealerName}`}
                        className="shrink-0 -my-2 -mr-1 px-3 py-3 text-[11px] font-semibold text-gray-600 underline decoration-gray-400 underline-offset-2 disabled:opacity-40 disabled:no-underline"
                      >
                        {isUndoing ? "…" : "Undo"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Route bottom sheet */}
      {routeSheetOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setRouteSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-[18px] p-5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
          >
            <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mb-3.5" />
            <h3 className="text-[16px] font-extrabold text-gray-900">Filter by route</h3>
            <p className="text-[12.5px] text-gray-400 mt-[3px] mb-3.5">
              Single-select &middot; counts reflect the current Type filter
            </p>
            <button
              type="button"
              onClick={() => {
                setActiveRoute(null);
                setRouteSheetOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 py-3 px-1 border-b border-gray-100"
            >
              <span
                className={
                  "text-[14px] flex items-center gap-2 " +
                  (activeRoute === null ? "text-teal-700 font-semibold" : "text-gray-900 font-medium")
                }
              >
                {activeRoute === null && <Check size={16} className="text-teal-600" />}
                All routes
              </span>
              <span className="text-[12px] text-gray-400">{allRoutesCount}</span>
            </button>
            {availableRoutes.map((route) => (
              <button
                key={route}
                type="button"
                onClick={() => {
                  setActiveRoute(route);
                  setRouteSheetOpen(false);
                }}
                className="w-full flex items-center justify-between gap-2 py-3 px-1 border-b border-gray-100 last:border-b-0"
              >
                <span
                  className={
                    "text-[14px] flex items-center gap-2 min-w-0 " +
                    (activeRoute === route ? "text-teal-700 font-semibold" : "text-gray-900 font-medium")
                  }
                >
                  {activeRoute === route && <Check size={16} className="text-teal-600 shrink-0" />}
                  <span className="truncate">{route}</span>
                </span>
                <span className="text-[12px] text-gray-400 shrink-0">{routeCounts.get(route) ?? 0}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Detail screen — always mounted, slides in via translate-x so the
          board underneath (filters + scroll) is never torn down. Matches
          the approved mockup's Screen 2. */}
      <div
        className={
          "fixed inset-0 z-[35] bg-[#f9fafb] flex flex-col transition-transform duration-200 ease-out " +
          (detailOpen ? "translate-x-0" : "translate-x-full")
        }
      >
        <div
          className="bg-teal-600 px-3.5 pb-3.5 flex items-center gap-2.5 shrink-0"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
        >
          <button
            type="button"
            onClick={closeDetail}
            aria-label="Back"
            className="w-8 h-8 rounded-[9px] bg-white/15 flex items-center justify-center text-white shrink-0"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="min-w-0">
            <div className="text-[16px] font-extrabold text-white truncate">
              {detailRow?.dealerName ?? "—"}
            </div>
            <div className="text-[12px] text-white/75 truncate">
              {detailRow
                ? `OBD ${detailRow.obdNumber} · ${detailRow.area ?? "Unmatched"}${
                    detailRow.windowTime !== null ? ` · ${detailRow.windowTime}` : ""
                  }`
                : "—"}
            </div>
          </div>
        </div>

        <div className="bg-white border-b border-gray-200 flex px-2.5 py-3.5 shrink-0">
          <div className="flex-1 text-center border-r border-gray-200 px-1">
            <div className="text-[16px] font-extrabold text-gray-900">
              {detailRow?.volumeLitres ?? "—"}
            </div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mt-0.5">
              Volume (LT)
            </div>
          </div>
          <div className="flex-1 text-center border-r border-gray-200 px-1">
            <div className="text-[11px] font-bold text-gray-900 leading-snug break-words">
              {detailRow?.articleTag ?? "—"}
            </div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mt-0.5">
              Article
            </div>
          </div>
          <div className="flex-1 text-center px-1">
            <div className="text-[16px] font-extrabold text-gray-900">
              {detailRow?.weightKg ?? "—"}
            </div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mt-0.5">
              Weight (kg)
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 pt-3 pb-24">
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
            Line items
          </div>
          {lineItemsLoading && (
            <p className="text-[13px] text-gray-400 text-center py-10">Loading line items&hellip;</p>
          )}
          {!lineItemsLoading && lineItemsError && (
            <p className="text-[13px] text-red-600 text-center py-10">
              Couldn&apos;t load line items: {lineItemsError}
            </p>
          )}
          {!lineItemsLoading && !lineItemsError && lineItems !== null && (
            lineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No line items found for this bill.</p>
            ) : (
              lineItems.map((li) => (
                <div
                  key={li.id}
                  className="flex items-center justify-between gap-2.5 bg-white rounded-xl p-3 mb-2"
                  style={{ boxShadow: SOFT_CARD_SHADOW }}
                >
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-gray-900 truncate">
                      {li.name ?? "—"}
                    </div>
                    <div className="text-[10.5px] text-gray-400 font-mono mt-0.5">{li.sku}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-gray-400">{li.pack ?? "—"}</div>
                    <div className="text-[14px] font-bold text-gray-900 font-mono">&times;{li.qty}</div>
                  </div>
                </div>
              ))
            )
          )}
        </div>

        {detailRow && !detailRow.isAssigned && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 14px)" }}
          >
            <button
              type="button"
              onClick={() => openPickerForRow(detailRow)}
              className="w-full h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
            >
              Assign to picker
            </button>
          </div>
        )}
      </div>

      {/* Floating assign bar — matches docs/mockups/picking/supervisor-assign-board.html's
          .assignbar exactly (bg-gray-900 pill, teal Assign CTA), sitting just
          above the fixed mobile shell (76px, per components/shared/mobile-shell.tsx). */}
      {selectedRows.length > 0 && (
        <div
          className="fixed left-3 right-3 z-30 bg-gray-900 rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.28)]"
          style={{ bottom: "calc(76px + env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="text-[13px] font-semibold text-white min-w-0 truncate">
            {selectedRows.length} {selectedRows.length === 1 ? "bill" : "bills"}
            <span className="text-gray-400 font-normal"> · {selectedLitres} L selected</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={assigning}
              className="text-[12.5px] font-semibold text-gray-400 px-1 py-2 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setAssignTarget(selectedRows);
                setPickerSheetOpen(true);
              }}
              disabled={assigning}
              className="flex items-center gap-1.5 bg-teal-600 active:bg-teal-700 text-white text-[13px] font-bold rounded-[10px] px-[15px] py-[9px] disabled:opacity-60"
            >
              Assign
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Picker sheet — tap a row to fire the assign immediately (no separate
          confirm step), per the approved mockup. */}
      {pickerSheetOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => {
              if (!assigning) setPickerSheetOpen(false);
            }}
            aria-hidden="true"
          />
          <div
            className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-[18px] p-5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
          >
            <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mb-3.5" />
            <h3 className="text-[16px] font-extrabold text-gray-900">Assign to picker</h3>
            <p className="text-[12.5px] text-gray-400 mt-[3px] mb-3.5">{pickerSheetSubtitle}</p>
            {pickersLoading ? (
              <p className="text-[13px] text-gray-400 text-center py-6">Loading pickers&hellip;</p>
            ) : pickers.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-6">No active pickers found.</p>
            ) : (
              pickers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void handleAssign(p.id, p.name)}
                  disabled={assigning}
                  className="w-full flex items-center gap-[11px] py-[11px] px-1 border-b border-gray-100 last:border-b-0 disabled:opacity-50"
                >
                  <span className="w-9 h-9 rounded-full bg-teal-600 text-white text-[13px] font-bold flex items-center justify-center shrink-0">
                    {p.avatarInitial}
                  </span>
                  <span className="flex-1 min-w-0 text-[14px] font-semibold text-gray-900 text-left truncate">
                    {p.name}
                  </span>
                  <span
                    className={
                      "text-[10.5px] font-semibold px-2.5 py-[3px] rounded-full shrink-0 " +
                      (p.status === "available"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-gray-100 text-gray-600 border border-gray-200")
                    }
                  >
                    {p.status === "available" ? "Free" : `${p.assignedCount} jobs`}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
