"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

export type TinterFilter = "ALL" | "TINTER" | "ACOTONE";
export type TriState     = "all" | "true" | "false";

export interface SamplingFilterState {
  search:         string;
  tinterType:     TinterFilter;
  isActive:       TriState;
  needsReview:    TriState;
  siteId:         number | null;
  salesOfficerId: number | null;
}

interface ListItem {
  samplingNo:       string;
  shadeName:        string;
  tinterType:       "TINTER" | "ACOTONE";
  siteName:         string | null;
  salesOfficerName: string | null;
  dealerName:       string | null;
  isActive:         boolean;
  needsReview:      boolean;
  recipeCount:      number;
  createdAt:        string;
  updatedAt:        string;
  lastUsedAt:       string | null;
}

interface ListResponse {
  items:      ListItem[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
}

export interface SamplingLibraryListPaneProps {
  filters:            SamplingFilterState;
  selectedSamplingNo: string | null;
  onSelect:           (samplingNo: string) => void;
}

const PAGE_SIZE = 50;

// ── Build query string from filters ─────────────────────────────────────────
function buildQuery(filters: SamplingFilterState, page: number): string {
  const sp = new URLSearchParams();
  if (filters.search)                            sp.set("search",         filters.search);
  if (filters.tinterType !== "ALL")              sp.set("tinterType",     filters.tinterType);
  if (filters.isActive !== "all")                sp.set("isActive",       filters.isActive);
  if (filters.needsReview !== "all")             sp.set("needsReview",    filters.needsReview);
  if (filters.siteId !== null)                   sp.set("siteId",         String(filters.siteId));
  if (filters.salesOfficerId !== null)           sp.set("salesOfficerId", String(filters.salesOfficerId));
  sp.set("sort",     "updatedAt");
  sp.set("order",    "desc");
  sp.set("page",     String(page));
  sp.set("pageSize", String(PAGE_SIZE));
  return sp.toString();
}

// ── Component ───────────────────────────────────────────────────────────────

export function SamplingLibraryListPane({
  filters,
  selectedSamplingNo,
  onSelect,
}: SamplingLibraryListPaneProps) {
  const [items,          setItems]          = useState<ListItem[]>([]);
  const [total,          setTotal]          = useState(0);
  const [page,           setPage]           = useState(1);
  const [hasMore,        setHasMore]        = useState(false);
  const [isLoading,      setIsLoading]      = useState(true);
  const [isLoadingMore,  setIsLoadingMore]  = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [reloadNonce,    setReloadNonce]    = useState(0);

  // Stable filter key so the reset effect only fires on real changes.
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  // Initial / filter-change / retry load.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setItems([]);
    setTotal(0);
    setPage(1);
    setHasMore(false);

    (async () => {
      try {
        const res = await fetch(`/api/sampling-library?${buildQuery(filters, 1)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = (await res.json()) as ListResponse;
        if (cancelled) return;
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setHasMore(data.page < data.totalPages);
        setPage(data.page);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load list");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, reloadNonce]);

  // Load-more handler.
  const loadMore = useCallback(async () => {
    if (isLoading || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await fetch(`/api/sampling-library?${buildQuery(filters, nextPage)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setHasMore(data.page < data.totalPages);
      setPage(data.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setIsLoadingMore(false);
    }
  }, [filters, page, hasMore, isLoading, isLoadingMore]);

  // IntersectionObserver on a sentinel for infinite scroll.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || isLoading) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) void loadMore(); },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-[380px] border-r border-gray-200 bg-white h-full flex flex-col">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <span className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wider">
          {isLoading
            ? "Loading…"
            : `${total.toLocaleString("en-IN")} ${total === 1 ? "result" : "results"}`}
        </span>
        <span className="text-[11px] text-gray-500 font-medium">
          Last updated &darr;
        </span>
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && items.length === 0 && <ListSkeleton />}

        {!isLoading && error && (
          <div className="px-4 py-6 text-center">
            <p className="text-[12px] text-red-600 font-medium">{error}</p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="mt-2 text-[11px] text-gray-600 underline hover:text-gray-900"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <p className="text-[13px] text-gray-500 font-medium">No shades found</p>
            <p className="text-[11px] text-gray-400 mt-1">Adjust filters to see more results.</p>
          </div>
        )}

        {items.map((item) => (
          <ListCard
            key={item.samplingNo}
            item={item}
            isSelected={item.samplingNo === selectedSamplingNo}
            onSelect={onSelect}
          />
        ))}

        {/* Sentinel + load-more indicator */}
        {hasMore && (
          <div ref={sentinelRef} className="py-5 flex items-center justify-center">
            {isLoadingMore ? (
              <Loader2 size={14} className="text-gray-400 animate-spin" />
            ) : (
              <span className="text-[11px] text-gray-400">Loading more&hellip;</span>
            )}
          </div>
        )}

        {!hasMore && !isLoading && items.length > 0 && (
          <div className="py-4 text-center text-[10px] text-gray-300 uppercase tracking-wider font-semibold">
            End of list
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function getSoInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] ?? "";
  const last  = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase().slice(0, 2);
}

function ListCard({
  item,
  isSelected,
  onSelect,
}: {
  item:       ListItem;
  isSelected: boolean;
  onSelect:   (samplingNo: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.samplingNo)}
      className={`w-full text-left flex items-stretch gap-3 py-3 px-4 border-b border-gray-100 border-l-[3px] cursor-pointer transition-colors duration-100 ${
        isSelected
          ? "bg-teal-50 border-l-teal-700"
          : "bg-white border-l-transparent hover:bg-gray-50"
      }`}
    >
      {/* Col 1 — sampling number + tinter type label */}
      <div className="w-[110px] flex-shrink-0 flex flex-col items-start justify-center gap-0.5">
        <span className="font-mono text-[13px] font-medium text-gray-900 leading-none">
          #{item.samplingNo}
        </span>
        <span
          className={`font-mono text-[10px] font-medium uppercase tracking-wider leading-none ${
            item.tinterType === "TINTER" ? "text-gray-400" : "text-orange-700"
          }`}
        >
          {item.tinterType}
        </span>
      </div>

      {/* Col 2 — shade name */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="text-[13px] font-medium text-gray-900 truncate leading-tight">
          {item.shadeName}
        </div>
      </div>

      {/* Col 3 — last used + indicator */}
      <div className="w-[100px] flex-shrink-0 flex flex-col items-end justify-center gap-1.5">
        {item.lastUsedAt ? (
          <span className="text-[12px] text-gray-700 leading-none">
            {formatShortDate(item.lastUsedAt)}
          </span>
        ) : (
          <span className="text-[11px] italic text-gray-400 leading-none">
            Never used
          </span>
        )}
        {item.needsReview ? (
          <div className="w-5 h-5 rounded-full bg-amber-500" aria-label="Needs review" />
        ) : item.salesOfficerName ? (
          <div className="w-5 h-5 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center text-[10px] font-medium leading-none">
            {getSoInitials(item.salesOfficerName)}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex items-stretch gap-3 py-3 px-4 border-b border-gray-100 border-l-[3px] border-l-transparent"
        >
          <div className="w-[110px] flex-shrink-0 flex flex-col justify-center gap-1.5">
            <div className="h-3.5 w-16 bg-gray-100 rounded animate-pulse" />
            <div className="h-2.5 w-12 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
            <div className="h-3.5 w-3/4 bg-gray-100 rounded animate-pulse" />
            <div className="h-3 w-1/2 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="w-[100px] flex-shrink-0 flex flex-col items-end justify-center gap-1.5">
            <div className="h-3 w-12 bg-gray-100 rounded animate-pulse" />
            <div className="h-5 w-5 rounded-full bg-gray-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
