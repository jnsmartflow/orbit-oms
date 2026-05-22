"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Building2,
  Calendar,
  FlaskConical,
  Loader2,
  MapPin,
  Pencil,
} from "lucide-react";
import { smartTitleCase } from "@/lib/mail-orders/utils";

// ── API response types ─────────────────────────────────────────────────────

interface DetailResponse {
  samplingNo:       number;
  shadeName:        string;
  tinterType:       "TINTER" | "ACOTONE";
  siteId:           number | null;
  siteName:         string | null;
  siteNameRaw:      string | null;
  siteMissing:      boolean;
  salesOfficerId:   number | null;
  salesOfficerName: string | null;
  dealerName:       string | null;
  notes:            string | null;
  isActive:         boolean;
  needsReview:      boolean;
  createdBy:        { id: number; name: string };
  createdAt:        string;
  updatedAt:        string;
  recipeCount:      number;
  primaryRecipe:    { skuCode: string; packCode: string } | null;
  lastUsedAt:       string | null;
  totalUsageCount:  number;
  dealersTotal:     number;
  sitesTotal:       number;
  primaryDealer:      string | null;
  primarySite:        string | null;
  primarySiteMissing: boolean;
  allDealers:         string[];
  allSites:           string[];
  usageSummary:       UsageSummaryRow[];
}

interface UsageSummaryRow {
  site:         string | null;
  siteCode:     string | null;
  dealer:       string | null;
  so:           string | null;
  firstUseDate: string | null;
  lastUseDate:  string | null;
  uses:         number;
}

interface UsageLogItem {
  id:             number;
  usageDate:      string | null;
  skuCodeRaw:     string | null;
  packCode:       string | null;
  tinQty:         number;
  dealerNameRaw:  string | null;
  siteNameRaw:    string | null;
  deliveryNumber: string | null;
  operatorId:     number | null;
  operatorName:   string | null;
  createdAt:      string;
}

interface UsageLogResponse {
  items:      UsageLogItem[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
}

const USAGE_LOG_PAGE_SIZE = 25;

interface Variant {
  id:             number;
  skuCode:        string;
  productName:    string | null;
  packCode:       string;
  tinQty:         number;
  pigments:       Record<string, number>;
  activePigments: string[];
  isPrimary:      boolean;
  usageCount:     number;
  firstUsedAt:    string | null;
  lastUsedAt:     string | null;
  createdAt:      string;
  updatedAt:      string;
}

interface VariantsResponse {
  samplingNo: number;
  variants:   Variant[];
  total:      number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function packCodeToLabel(code: string): string {
  if (code === "ml_500") return "500 ML";
  const m = code.match(/^L_(\d+)(?:_(\d+))?$/);
  if (!m) return code;
  const whole = m[1];
  const frac  = m[2];
  return `${frac !== undefined ? `${whole}.${frac}` : whole} LT`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] ?? "";
  const last  = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase().slice(0, 2);
}

function formatLongDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day:   "2-digit",
    month: "short",
    year:  "numeric",
  });
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day:   "2-digit",
    month: "short",
    year:  "2-digit",
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

// Canonical pigment order — 13 TINTER + 14 ACOTONE. Used to sort the
// dynamic recipe-history pigment columns. Codes here that aren't present
// on any variant are filtered out.
const PIGMENT_ORDER_27 = [
  "YOX", "LFY", "GRN", "TBL", "WHT", "MAG", "FFR", "BLK", "OXR", "HEY",
  "HER", "COB", "COG",
  "YE2", "YE1", "XY1", "XR1", "WH1", "RE2", "RE1", "OR1", "NO2", "NO1",
  "MA1", "GR1", "BU2", "BU1",
] as const;

// ── Component ──────────────────────────────────────────────────────────────

export interface SamplingLibraryDetailPaneProps {
  samplingNo: number | null;
}

export function SamplingLibraryDetailPane({
  samplingNo,
}: SamplingLibraryDetailPaneProps) {
  const [detail,            setDetail]            = useState<DetailResponse | null>(null);
  const [variants,          setVariants]          = useState<Variant[]>([]);
  const [isLoading,         setIsLoading]         = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [reloadNonce,       setReloadNonce]       = useState(0);
  const [selectedPackCode, setSelectedPackCode] = useState<string | null>(null);
  const [usageLog,          setUsageLog]          = useState<UsageLogItem[]>([]);
  const [usageLogTotal,     setUsageLogTotal]     = useState(0);
  const [usageLogPage,      setUsageLogPage]      = useState(1);
  const [usageLogLoadingMore, setUsageLogLoadingMore] = useState(false);

  useEffect(() => {
    if (samplingNo == null) {
      setDetail(null);
      setVariants([]);
      setError(null);
      setIsLoading(false);
      setSelectedPackCode(null);
      setUsageLog([]);
      setUsageLogTotal(0);
      setUsageLogPage(1);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setDetail(null);
    setVariants([]);
    setSelectedPackCode(null);
    setUsageLog([]);
    setUsageLogTotal(0);
    setUsageLogPage(1);

    (async () => {
      try {
        const [detailRes, variantsRes, usageLogRes] = await Promise.all([
          fetch(`/api/sampling-library/${samplingNo}`,          { cache: "no-store" }),
          fetch(`/api/sampling-library/${samplingNo}/variants`, { cache: "no-store" }),
          fetch(`/api/sampling-library/${samplingNo}/usage-log?page=1&pageSize=${USAGE_LOG_PAGE_SIZE}`, { cache: "no-store" }),
        ]);
        if (!detailRes.ok)   throw new Error(`Detail load failed: ${detailRes.status}`);
        if (!variantsRes.ok) throw new Error(`Variants load failed: ${variantsRes.status}`);
        // usage-log is non-critical: if it fails, fall back to empty list.
        const detailData   = (await detailRes.json())   as DetailResponse;
        const variantsData = (await variantsRes.json()) as VariantsResponse;
        if (cancelled) return;
        setDetail(detailData);
        const list = variantsData.variants ?? [];
        setVariants(list);
        const primary = list.find((v) => v.isPrimary);
        setSelectedPackCode(primary?.packCode ?? list[0]?.packCode ?? null);
        if (usageLogRes.ok) {
          const usageLogData = (await usageLogRes.json()) as UsageLogResponse;
          if (cancelled) return;
          setUsageLog(usageLogData.items ?? []);
          setUsageLogTotal(usageLogData.total ?? 0);
          setUsageLogPage(usageLogData.page ?? 1);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load detail");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [samplingNo, reloadNonce]);

  const loadMoreUsageLog = async () => {
    if (samplingNo == null || usageLogLoadingMore) return;
    if (usageLog.length >= usageLogTotal) return;
    const nextPage = usageLogPage + 1;
    setUsageLogLoadingMore(true);
    try {
      const res = await fetch(
        `/api/sampling-library/${samplingNo}/usage-log?page=${nextPage}&pageSize=${USAGE_LOG_PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Usage log load failed: ${res.status}`);
      const data = (await res.json()) as UsageLogResponse;
      setUsageLog((prev) => [...prev, ...(data.items ?? [])]);
      setUsageLogPage(data.page ?? nextPage);
    } catch {
      // Silent — non-critical pagination. User can click again.
    } finally {
      setUsageLogLoadingMore(false);
    }
  };

  // Group recipe variants by packCode (Issue A). One tab per unique pack;
  // the tab's pigment cards read the canonical recipe of the group. SKUS
  // USED table at the bottom still iterates the flat `variants` array.
  type PackGroup = {
    packCode:        string;
    rows:            Variant[];
    canonicalRecipe: Variant;
    totalUsageCount: number;
    hasPrimary:      boolean;
  };

  const packGroups = useMemo<PackGroup[]>(() => {
    if (variants.length === 0) return [];
    const byPack = new Map<string, Variant[]>();
    for (const v of variants) {
      const existing = byPack.get(v.packCode);
      if (existing) existing.push(v);
      else byPack.set(v.packCode, [v]);
    }
    const groups: PackGroup[] = [];
    for (const [packCode, rows] of Array.from(byPack.entries())) {
      const sorted = [...rows].sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
        return a.id - b.id;
      });
      const primaryCount = sorted.filter((r) => r.isPrimary).length;
      if (primaryCount > 1) {
        console.warn(
          `[sampling-library] multiple isPrimary rows for samplingNo=${samplingNo ?? "?"} packCode=${packCode}`,
        );
      }
      groups.push({
        packCode,
        rows:            sorted,
        canonicalRecipe: sorted[0],
        totalUsageCount: sorted.reduce((s, r) => s + r.usageCount, 0),
        hasPrimary:      primaryCount > 0,
      });
    }
    return groups;
  }, [variants, samplingNo]);

  const selectedGroup = useMemo<PackGroup | null>(
    () => packGroups.find((g) => g.packCode === selectedPackCode) ?? null,
    [packGroups, selectedPackCode],
  );
  const selectedVariant = selectedGroup?.canonicalRecipe ?? null;

  // Pigments that any variant has a non-zero value for, in canonical order.
  // Drives the recipe-history table's column set so we never show a column
  // that's all em-dashes.
  const activePigmentCodes = useMemo<string[]>(() => {
    if (variants.length === 0) return [];
    return PIGMENT_ORDER_27.filter((code) =>
      variants.some((v) => (v.pigments[code] ?? 0) > 0),
    );
  }, [variants]);

  // ── Empty / loading / error ─────────────────────────────────────────────

  if (samplingNo == null) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 h-full">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <FlaskConical size={40} strokeWidth={1.5} />
          <p className="text-[12px]">Select a shade from the list to view its recipe history</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 h-full">
        <Loader2 size={20} className="text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 h-full">
        <div className="text-center">
          <p className="text-[12px] text-red-600 font-medium">{error}</p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="mt-2 text-[11px] text-gray-600 underline hover:text-gray-900"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 h-full">
        <p className="text-[12px] text-gray-400">Not found</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 h-full">
      {/* ── Section 1+2 — Header strip + full-width CREATED ON strip ────── */}
      <div className="px-6 py-5 bg-white border-b border-gray-200">
        <div className="flex items-start gap-5">
          {/* Left block — sampling no + tinter type, divider on right */}
          <div className="flex-shrink-0 pr-5 border-r border-gray-200">
            <div className="font-mono text-[30px] font-medium text-gray-900 leading-none tracking-tight">
              #{detail.samplingNo}
            </div>
            <div
              className={`mt-2 font-mono text-[10px] font-medium uppercase tracking-wider leading-none ${
                detail.tinterType === "TINTER" ? "text-gray-500" : "text-orange-700"
              }`}
            >
              {detail.tinterType}
            </div>
          </div>

          {/* Right block — name + pills + actions on line 1, counters on line 2 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                <div className="text-[18px] font-semibold text-gray-900 leading-tight truncate">
                  {detail.shadeName}
                </div>
                {detail.isActive ? (
                  <span className="inline-flex items-center text-[10.5px] font-semibold uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-200 rounded px-2 py-0.5">
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center text-[10.5px] font-semibold uppercase tracking-wider bg-gray-200 text-gray-700 rounded px-2 py-0.5">
                    Inactive
                  </span>
                )}
                {detail.needsReview && (
                  <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-800 rounded px-2 py-0.5">
                    <AlertTriangle size={10} />
                    Needs Review
                  </span>
                )}
              </div>

              {/* Action icons */}
              <div className="flex items-start gap-1.5 flex-shrink-0">
                <ActionButton
                  onClick={() => console.log("edit", detail.samplingNo)}
                  ariaLabel="Edit shade"
                >
                  <Pencil size={14} />
                </ActionButton>
                <ActionButton
                  onClick={() => console.log("deactivate", detail.samplingNo)}
                  ariaLabel={detail.isActive ? "Deactivate" : "Reactivate"}
                >
                  <Ban size={14} />
                </ActionButton>
                <ActionButton
                  onClick={() => console.log("mark-review", detail.samplingNo)}
                  ariaLabel="Mark for review"
                >
                  <AlertTriangle size={14} />
                </ActionButton>
              </div>
            </div>

            <div className="mt-1.5 flex items-center gap-2 text-[12px] text-gray-600 flex-wrap">
              <span>
                <strong className="text-gray-900 font-semibold">{detail.totalUsageCount}</strong>{" "}
                uses
              </span>
              <span className="text-gray-300">&middot;</span>
              <span>
                <strong className="text-gray-900 font-semibold">{detail.recipeCount}</strong>{" "}
                {detail.recipeCount === 1 ? "pack" : "packs"}
              </span>
              <span className="text-gray-300">&middot;</span>
              <span>
                <strong className="text-gray-900 font-semibold">{detail.sitesTotal}</strong>{" "}
                {detail.sitesTotal === 1 ? "site" : "sites"}
              </span>
              <span className="text-gray-300">&middot;</span>
              <span>
                <strong className="text-gray-900 font-semibold">{detail.dealersTotal}</strong>{" "}
                {detail.dealersTotal === 1 ? "dealer" : "dealers"}
              </span>
            </div>
          </div>
        </div>

        {/* Full-width CREATED ON meta strip — spans below both columns. */}
        <div className="mt-4 pt-3 border-t border-gray-200 flex items-center gap-2.5 text-[11.5px] text-gray-700 flex-wrap">
          <span className="text-[9.5px] uppercase tracking-wider font-bold text-gray-400">
            Created on
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Calendar size={11} className="text-gray-400" />
            {formatLongDate(detail.createdAt)}
          </span>
          <span className="text-gray-300">&middot;</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-gray-100 text-gray-700 text-[8.5px] font-bold leading-none">
              {getInitials(detail.createdBy.name)}
            </span>
            {detail.createdBy.name}
          </span>
          <span className="text-gray-300">&middot;</span>
          <span className="inline-flex items-center gap-1.5">
            <Building2 size={11} className="text-gray-400" />
            {detail.primaryDealer
              ? smartTitleCase(detail.primaryDealer)
              : <span className="text-gray-300">&mdash;</span>}
          </span>
          <span className="text-gray-300">&middot;</span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={11} className="text-gray-400" />
            {detail.primarySite ? (
              <>
                {smartTitleCase(detail.primarySite)}
                {detail.primarySiteMissing && (
                  <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5 ml-1.5">
                    missing
                  </span>
                )}
              </>
            ) : (
              <span className="text-gray-300">&mdash;</span>
            )}
          </span>
        </div>
      </div>

      {/* ── Section 3+4+5 — Recipe block (tabs + pigments + footnote) ── */}
      <div className="px-6 pt-3 pb-5 bg-white border-b border-gray-200">
        {/* Tabs — one per unique packCode (Issue A) */}
        {packGroups.length > 0 ? (
          <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-hidden">
            {packGroups.map((g) => {
              const isActive = g.packCode === selectedPackCode;
              return (
                <button
                  key={g.packCode}
                  type="button"
                  onClick={() => setSelectedPackCode(g.packCode)}
                  className={`-mb-px flex items-baseline gap-2 py-2.5 px-4 font-mono text-[13px] font-semibold border-b-2 whitespace-nowrap transition-colors ${
                    isActive
                      ? "text-gray-900 border-gray-900"
                      : "text-gray-500 hover:text-gray-700 border-transparent"
                  }`}
                >
                  {packCodeToLabel(g.packCode)}
                  <span
                    className={`font-sans text-[10.5px] font-medium uppercase tracking-wider ${
                      isActive ? "text-gray-700" : "text-gray-400"
                    }`}
                  >
                    &middot; {g.totalUsageCount} {g.totalUsageCount === 1 ? "use" : "uses"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] text-gray-400 italic py-4">No variants yet</p>
        )}

        {/* Pigment cards */}
        {selectedVariant && (
          <>
            {selectedVariant.activePigments.length > 0 ? (
              <div className="flex flex-wrap gap-2.5">
                {selectedVariant.activePigments.map((code) => (
                  <div
                    key={code}
                    className="bg-white border-[1.5px] border-gray-200 rounded-lg px-4 pt-2.5 pb-2 min-w-[88px] text-center"
                  >
                    <div className="font-mono text-[10.5px] font-semibold text-gray-500 uppercase tracking-wider leading-none">
                      {code}
                    </div>
                    <div className="mt-1.5 font-mono text-[22px] font-semibold text-gray-900 leading-none tracking-tight">
                      {formatNumber(selectedVariant.pigments[code] ?? 0)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-gray-400 italic">
                No pigment values for this variant
              </p>
            )}

          </>
        )}
      </div>

      {/* ── Section 6 — Recipe history table ──────────────────────────── */}
      <div className="px-6 py-5 bg-white border-b border-gray-200">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">
            SKUs used
          </span>
          <span className="font-mono text-[10px] text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">
            {variants.length} {variants.length === 1 ? "entry" : "entries"}
          </span>
          <button
            type="button"
            onClick={() => console.log("export", detail.samplingNo)}
            className="ml-auto text-[11px] text-gray-700 hover:text-gray-900 underline"
          >
            Export &rarr;
          </button>
        </div>

        {variants.length === 0 ? (
          <p className="text-[12px] text-gray-400 italic">No variants to show</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-x-auto bg-white">
            <table className="w-full text-[11.5px] min-w-[720px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 text-[10px] uppercase tracking-wider font-medium">
                  <th className="text-left py-2.5 px-2.5 whitespace-nowrap">SKU</th>
                  <th className="text-left py-2.5 px-2.5 whitespace-nowrap">Product</th>
                  <th className="text-left py-2.5 px-2.5 whitespace-nowrap">Pack</th>
                  {activePigmentCodes.map((c) => (
                    <th key={c} className="text-right py-2.5 px-2.5 whitespace-nowrap">{c}</th>
                  ))}
                  <th className="text-right py-2.5 px-2.5 whitespace-nowrap">Uses</th>
                  <th className="text-left  py-2.5 px-2.5 whitespace-nowrap">Last Used</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => {
                  return (
                    <tr
                      key={v.id}
                      className="border-b border-gray-100 last:border-b-0 cursor-pointer bg-white hover:bg-gray-50"
                      onClick={() => setSelectedPackCode(v.packCode)}
                    >
                      <td className="py-2.5 px-2.5 font-mono text-[11px] font-medium whitespace-nowrap text-gray-900">
                        {v.skuCode}
                      </td>
                      <td className="py-2.5 px-2.5 text-gray-600 text-[11px] truncate max-w-[180px]">
                        {v.productName ?? "—"}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span className="inline-block font-mono text-[10.5px] font-semibold text-gray-700 bg-gray-100 rounded px-1.5 py-0.5">
                          {packCodeToLabel(v.packCode)}
                        </span>
                      </td>
                      {activePigmentCodes.map((c) => {
                        const val = v.pigments[c] ?? 0;
                        return (
                          <td
                            key={c}
                            className={`py-2.5 px-2.5 whitespace-nowrap font-mono font-medium ${
                              val > 0
                                ? "text-right text-gray-900"
                                : "text-center text-gray-300"
                            }`}
                          >
                            {val > 0 ? formatNumber(val) : "—"}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-2.5 text-right font-mono font-medium text-gray-900 whitespace-nowrap">
                        {v.usageCount}
                      </td>
                      <td className="py-2.5 px-2.5 font-mono font-medium whitespace-nowrap text-gray-700">
                        {formatShortDate(v.lastUsedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 7 — USED AT (per-site rollup) ────────────────────────── */}
      <div className="px-6 py-5 bg-white border-b border-gray-200">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
            Used at
          </span>
          <span className="bg-gray-100 text-gray-700 text-[10px] font-medium rounded-md px-2 py-0.5">
            {detail.usageSummary.length} {detail.usageSummary.length === 1 ? "site" : "sites"}
          </span>
          <button
            type="button"
            onClick={() => console.log("export-used-at", detail.samplingNo)}
            className="ml-auto text-[11px] text-gray-700 hover:text-gray-900 underline"
          >
            Export &rarr;
          </button>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "28%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr className="bg-gray-50 border-b border-[#ebebeb] h-[32px]">
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">Site</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">Dealer</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">SO</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">First</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">Last</th>
                <th className="px-3.5 text-right text-[10px] font-medium uppercase tracking-wider text-gray-400">Uses</th>
              </tr>
            </thead>
            <tbody>
              {detail.usageSummary.length === 0 ? (
                <tr className="h-[32px]">
                  <td colSpan={6} className="px-3.5 text-center italic text-gray-400 text-[11px]">
                    No site usage recorded yet
                  </td>
                </tr>
              ) : (
                detail.usageSummary.map((row, idx) => (
                  <tr
                    key={`${row.site ?? "?"}|${row.dealer ?? "?"}|${idx}`}
                    className="h-[36px] border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa]"
                  >
                    <td className="px-3.5 text-[11px] font-medium text-gray-900" style={cellEllipsis}>
                      {row.site
                        ? smartTitleCase(row.site)
                        : <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-3.5 text-[11px] text-gray-700" style={cellEllipsis}>
                      {row.dealer
                        ? smartTitleCase(row.dealer)
                        : <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-3.5" style={cellEllipsis}>
                      {row.so ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-gray-100 text-gray-700 text-[9px] font-medium leading-none">
                            {getInitials(row.so)}
                          </span>
                          <span className="text-[11px] text-gray-700 truncate">{row.so}</span>
                        </span>
                      ) : (
                        <span className="text-gray-300">&mdash;</span>
                      )}
                    </td>
                    <td className="px-3.5 text-[11px] text-gray-700">
                      {row.firstUseDate
                        ? formatUsageDate(row.firstUseDate)
                        : <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-3.5 text-[11px] text-gray-700">
                      {row.lastUseDate
                        ? formatUsageDate(row.lastUseDate)
                        : <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-3.5 text-right text-[11px] text-gray-900 font-medium">
                      {row.uses}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 8 — TINTING HISTORY (table) ──────────────────────────── */}
      <div className="px-6 py-5 bg-white border-b border-gray-200">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
            Tinting history
          </span>
          <span className="bg-gray-100 text-gray-700 text-[10px] font-medium rounded-md px-2 py-0.5">
            {usageLogTotal} {usageLogTotal === 1 ? "TI" : "TIs"}
          </span>
          <button
            type="button"
            onClick={() => console.log("export-tinting", detail.samplingNo)}
            className="ml-auto text-[11px] text-gray-700 hover:text-gray-900 underline"
          >
            Export &rarr;
          </button>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "10%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "8%"  }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <thead>
              <tr className="bg-gray-50 border-b border-[#ebebeb] h-[32px]">
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">Date</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">Delivery No</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">Dealer</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">Site</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">SKU</th>
                <th className="px-3.5 text-right text-[10px] font-medium uppercase tracking-wider text-gray-400">Qty</th>
                <th className="px-3.5 text-left  text-[10px] font-medium uppercase tracking-wider text-gray-400">Operator</th>
              </tr>
            </thead>
            <tbody>
              {usageLog.length === 0 ? (
                <tr className="h-[32px]">
                  <td colSpan={7} className="px-3.5 text-center italic text-gray-400 text-[11px]">
                    No tinting history yet
                  </td>
                </tr>
              ) : (
                usageLog.map((entry) => {
                  const opName = entry.operatorName ?? "Harsh";
                  return (
                    <tr
                      key={entry.id}
                      className="h-[36px] border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa]"
                    >
                      <td className="px-3.5 text-[11px] text-gray-700" style={cellEllipsis}>
                        {entry.usageDate
                          ? formatShortDate(entry.usageDate)
                          : <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="px-3.5 font-mono text-[11px] text-gray-700" style={cellEllipsis}>
                        {entry.deliveryNumber
                          ? entry.deliveryNumber
                          : <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="px-3.5 text-[11px] text-gray-700" style={cellEllipsis}>
                        {entry.dealerNameRaw
                          ? smartTitleCase(entry.dealerNameRaw)
                          : <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="px-3.5 text-[11px] text-gray-700" style={cellEllipsis}>
                        {entry.siteNameRaw
                          ? smartTitleCase(entry.siteNameRaw)
                          : <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="px-3.5 text-[11px] text-gray-700 font-mono" style={cellEllipsis}>
                        {entry.skuCodeRaw ?? <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="px-3.5 text-right text-[11px] text-gray-900 font-medium">
                        {entry.tinQty > 0
                          ? formatNumber(entry.tinQty)
                          : <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="px-3.5" style={cellEllipsis}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-gray-100 text-gray-700 text-[9px] font-medium leading-none">
                            {getInitials(opName)}
                          </span>
                          <span className="text-[11px] text-gray-700 truncate">{opName}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {usageLog.length > 0 && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">
              Showing {usageLog.length} of {usageLogTotal}
            </span>
            {usageLog.length < usageLogTotal && (
              <button
                type="button"
                onClick={() => void loadMoreUsageLog()}
                disabled={usageLogLoadingMore}
                className="text-[11px] text-gray-700 hover:text-gray-900 underline disabled:opacity-60"
              >
                {usageLogLoadingMore
                  ? "Loading…"
                  : `Load more (${usageLogTotal - usageLog.length}) →`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Reused style for ellipsis-truncated table cells per CLAUDE_UI §28.
const cellEllipsis: React.CSSProperties = {
  whiteSpace:   "nowrap",
  overflow:     "hidden",
  textOverflow: "ellipsis",
};

// USED AT cells render dates without year unless year differs from current.
function formatUsageDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-IN", {
    day:   "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

// ── Action button (placeholder click handlers wire in a later step) ────────

function ActionButton({
  children,
  onClick,
  ariaLabel,
}: {
  children:  React.ReactNode;
  onClick:   () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="w-8 h-8 inline-flex items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-300 transition-colors"
    >
      {children}
    </button>
  );
}
