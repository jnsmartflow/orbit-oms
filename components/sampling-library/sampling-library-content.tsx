"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { UniversalHeader } from "@/components/universal-header";
import {
  SamplingLibraryListPane,
  type SamplingFilterState,
  type TinterFilter,
  type TriState,
} from "./sampling-library-list-pane";
import { SamplingLibraryDetailPane } from "./sampling-library-detail-pane";

// ── State ───────────────────────────────────────────────────────────────────

function readSelectedSamplingNo(sp: URLSearchParams): number | null {
  const raw = sp.get("samplingNo");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function readState(sp: URLSearchParams): SamplingFilterState {
  const tt           = (sp.get("tinterType")  ?? "ALL").toUpperCase();
  const isActive     =  sp.get("isActive")    ?? "all";
  const needsReview  =  sp.get("needsReview") ?? "all";
  const siteIdRaw    =  sp.get("siteId");
  const soIdRaw      =  sp.get("salesOfficerId");
  return {
    search:         sp.get("search") ?? "",
    tinterType:     tt === "TINTER" || tt === "ACOTONE" ? (tt as TinterFilter) : "ALL",
    isActive:       isActive === "true" || isActive === "false" ? (isActive as TriState) : "all",
    needsReview:    needsReview === "true" || needsReview === "false" ? (needsReview as TriState) : "all",
    siteId:         siteIdRaw && /^\d+$/.test(siteIdRaw) ? parseInt(siteIdRaw, 10) : null,
    salesOfficerId: soIdRaw   && /^\d+$/.test(soIdRaw)   ? parseInt(soIdRaw,   10) : null,
  };
}

// ── Component ───────────────────────────────────────────────────────────────

export function SamplingLibraryContent() {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();

  const state = useMemo(
    () => readState(new URLSearchParams(sp.toString())),
    [sp],
  );

  const selectedSamplingNo = useMemo(
    () => readSelectedSamplingNo(new URLSearchParams(sp.toString())),
    [sp],
  );

  const [totalCount,  setTotalCount]  = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  // Top-of-page counts. These are unfiltered pulses (total + needsReview total),
  // not the filtered list count — the list pane in step 9 will own its own.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [totalRes, reviewRes] = await Promise.all([
          fetch("/api/sampling-library?pageSize=1",                    { cache: "no-store" }),
          fetch("/api/sampling-library?needsReview=true&pageSize=1",   { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (totalRes.ok) {
          const d = await totalRes.json();
          if (typeof d.total === "number") setTotalCount(d.total);
        }
        if (reviewRes.ok) {
          const d = await reviewRes.json();
          if (typeof d.total === "number") setReviewCount(d.total);
        }
      } catch {
        // Counts are non-critical; leave nulls so the UI shows placeholders.
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const updateUrl = useCallback((updates: Partial<SamplingFilterState>) => {
    const next = new URLSearchParams(sp.toString());

    function set(key: keyof SamplingFilterState, isDefault: (v: unknown) => boolean) {
      if (!(key in updates)) return;
      const v = updates[key];
      if (v === null || v === undefined || isDefault(v)) {
        next.delete(key);
      } else {
        next.set(key, String(v));
      }
    }

    set("search",         (v) => v === "");
    set("tinterType",     (v) => v === "ALL");
    set("isActive",       (v) => v === "all");
    set("needsReview",    (v) => v === "all");
    set("siteId",         () => false);
    set("salesOfficerId", () => false);

    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp]);

  const selectSamplingNo = useCallback((samplingNo: number) => {
    const next = new URLSearchParams(sp.toString());
    next.set("samplingNo", String(samplingNo));
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp]);

  // ── UH segments (tinterType) ──────────────────────────────────────────────
  const segments = [
    { id: "ALL",     label: "All" },
    { id: "TINTER",  label: "Tinter" },
    { id: "ACOTONE", label: "Acotone" },
  ];

  // ── UH filter dropdown groups ─────────────────────────────────────────────
  // Status + Needs Review are concrete enums; Site + Sales Officer filters
  // need master-data selectors and arrive in a later step.
  const filterGroups = [
    {
      label: "Status", key: "isActive",
      options: [
        { value: "true",  label: "Active" },
        { value: "false", label: "Inactive" },
      ],
    },
    {
      label: "Needs Review", key: "needsReview",
      options: [
        { value: "true",  label: "Yes" },
        { value: "false", label: "No" },
      ],
    },
  ];

  const activeFilters: Record<string, string[]> = {
    isActive:    state.isActive    === "all" ? [] : [state.isActive],
    needsReview: state.needsReview === "all" ? [] : [state.needsReview],
  };

  // UH treats filters as multi-select arrays. Collapse back to a TriState:
  // empty OR both selected → "all"; single value → that value.
  const handleFilterChange = useCallback((next: Record<string, string[]>) => {
    function reduce(arr: string[] | undefined): TriState {
      const a = arr ?? [];
      if (a.length !== 1) return "all";
      return a[0] === "true" || a[0] === "false" ? (a[0] as TriState) : "all";
    }
    updateUrl({
      isActive:    reduce(next.isActive),
      needsReview: reduce(next.needsReview),
    });
  }, [updateUrl]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">
      <UniversalHeader
        title="Sampling Library"
        stats={[{ label: "shades", value: totalCount ?? 0 }]}
        segments={segments}
        activeSegment={state.tinterType}
        onSegmentChange={(id) =>
          updateUrl({ tinterType: id == null ? "ALL" : (id as TinterFilter) })
        }
        filterGroups={filterGroups}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        showDatePicker={false}
        searchPlaceholder="Search sampling no., shade name…"
        searchValue={state.search}
        onSearchChange={(v) => updateUrl({ search: v })}
        rightExtra={
          <button
            type="button"
            onClick={() =>
              updateUrl({ needsReview: state.needsReview === "true" ? "all" : "true" })
            }
            className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-0.5 cursor-pointer transition-colors border ${
              state.needsReview === "true"
                ? "bg-amber-100 text-amber-800 border-amber-300"
                : "bg-amber-50  text-amber-700 border-amber-200 hover:bg-amber-100"
            }`}
            title="Toggle Needs Review filter"
          >
            <AlertTriangle size={12} />
            Needs Review: {reviewCount ?? "…"}
          </button>
        }
      />

      <div className="flex" style={{ height: "calc(100vh - 92px)" }}>
        <SamplingLibraryListPane
          filters={state}
          selectedSamplingNo={selectedSamplingNo}
          onSelect={selectSamplingNo}
        />
        <SamplingLibraryDetailPane samplingNo={selectedSamplingNo} />
      </div>
    </div>
  );
}
