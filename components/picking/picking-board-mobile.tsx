"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, ChevronDown, Check, Star, Zap } from "lucide-react";
import { getTodayIST } from "@/lib/dates";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickingQueueResult } from "@/lib/picking/queue";

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
  // Selection STATE ONLY this stage — no assign bar, no picker sheet, no API
  // call wired to it yet (stage 5-7 per the task brief).
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
                  <div className="flex-1 min-w-0">
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

        {/* Collapsed assigned strip — display only, no Undo wiring this stage */}
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
                {assignedRows.map((row) => (
                  <div
                    key={row.orderId}
                    className="py-2.5 px-[3px] border-b border-gray-100 last:border-b-0 opacity-70"
                  >
                    <div className="text-[12.5px] font-semibold text-gray-700 truncate">{row.dealerName}</div>
                    <div className="text-[11px] text-gray-400 font-mono">{row.obdNumber}</div>
                    <div className="text-[11px] text-teal-700 font-semibold">
                      &rarr; {row.assignedToName ?? "—"}
                    </div>
                  </div>
                ))}
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
    </div>
  );
}
