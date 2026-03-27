"use client";

import * as XLSX from "xlsx";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Inbox } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TIRow {
  id:           number;
  tinterType:   "TINTER" | "ACOTONE";
  obdNumber:    string;
  customerName: string;
  billToName:   string;
  operatorName: string;
  baseSku:      string;
  tinQty:       number;
  packCode:     string | null;
  skuCodeRaw:   string | null;
  shades:       Record<string, number>;
  createdAt:    string;
}

interface Summary {
  totalEntries: number;
  totalTinQty:  number;
  byType:       { TINTER: number; ACOTONE: number };
}

interface Operator {
  id:   number;
  name: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TINTER_SHADES  = ["YOX","LFY","GRN","TBL","WHT","MAG","FFR","BLK","OXR","HEY","HER","COB","COG"] as const;
const ACOTONE_SHADES = ["YE2","YE1","XY1","XR1","WH1","RE2","RE1","OR1","NO2","NO1","MA1","GR1","BU2","BU1"] as const;
const ALL_SHADES     = [...TINTER_SHADES, ...ACOTONE_SHADES];
const KG_FACTOR      = 2162;

const TINTER_SET = new Set<string>(TINTER_SHADES);

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function fmtDate(iso: string): string {
  const d   = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short" });
  const yr  = d.getFullYear();
  return `${day} ${mon} ${yr}`;
}

function fmtCreatedAt(iso: string): string {
  const d   = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short" });
  const hh  = String(d.getHours()).padStart(2, "0");
  const mm  = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon}, ${hh}:${mm}`;
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

// ── XLSX Export ───────────────────────────────────────────────────────────────

function fmtDateXLSX(iso: string): string {
  const d   = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short" });
  const yr  = d.getFullYear();
  return `${day}-${mon}-${yr}`;
}

function exportXLSX(rows: TIRow[], tinterType: string, dateFrom: string, dateTo: string) {
  const shades: string[] =
    tinterType === "ACOTONE" ? [...ACOTONE_SHADES]
    : tinterType === "TINTER" ? [...TINTER_SHADES]
    : [...TINTER_SHADES, ...ACOTONE_SHADES];

  const shadeKgCols = shades.map((s) => `${s}(kg)`);

  const header = [
    "Date", "OBD Number", "Dealer Name", "Site Name", "Base", "Tins", "Operator",
    ...shades,
    ...shadeKgCols,
  ];

  const dataRows = rows.map((r) => [
    fmtDateXLSX(r.createdAt),
    r.obdNumber,
    r.billToName,
    r.customerName,
    r.baseSku,
    r.tinQty,
    r.operatorName,
    ...shades.map((s) => r.shades[s] ?? 0),
    ...shades.map((s) => parseFloat(((r.shades[s] ?? 0) * r.tinQty / KG_FACTOR).toFixed(3))),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);

  // Column widths — max 30 chars, min 8
  const allRows = [header, ...dataRows];
  ws["!cols"] = header.map((_, ci) => {
    const maxLen = allRows.reduce((acc, row) => {
      const cell = row[ci];
      const len  = cell == null ? 0 : String(cell).length;
      return Math.max(acc, len);
    }, 0);
    return { wch: Math.min(30, Math.max(8, maxLen + 2)) };
  });

  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "TI Report");
  XLSX.writeFile(wb, `ti-report-${dateFrom}-${dateTo}.xlsx`);
}

// ── Segmented Toggle ──────────────────────────────────────────────────────────

function SegmentedToggle({ options, value, onChange }: {
  options: { value: string; label: string }[];
  value:    string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center bg-[#f0f2f8] rounded-lg p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            value === opt.value
              ? "bg-[#1a237e] text-white shadow-sm"
              : "bg-white border border-[#e2e5f1] text-slate-500 hover:text-slate-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TIReportContent() {
  const today = todayISO();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [dateFrom,    setDateFrom]    = useState(today);
  const [dateTo,      setDateTo]      = useState(today);
  const [operatorId,  setOperatorId]  = useState("");
  const [tinterType,  setTinterType]  = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [obdSearch,   setObdSearch]   = useState("");

  // ── View state ──────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<"transactions" | "summary">("transactions");

  // ── Data state ──────────────────────────────────────────────────────────
  const [rows,      setRows]      = useState<TIRow[]>([]);
  const [summary,   setSummary]   = useState<Summary | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [operators, setOperators] = useState<Operator[]>([]);

  // ── Debounce OBD search (300ms) ─────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setObdSearch(searchInput), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  // ── Fetch operators once ────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/tint/manager/operators")
      .then((r) => r.json())
      .then((d) => setOperators(d.operators ?? []))
      .catch(() => {});
  }, []);

  // ── Fetch report data ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom)   params.set("dateFrom",   dateFrom);
      if (dateTo)     params.set("dateTo",     dateTo);
      if (operatorId) params.set("operatorId", operatorId);
      if (tinterType) params.set("tinterType", tinterType);
      if (obdSearch)  params.set("obdSearch",  obdSearch);

      const res = await fetch(`/api/tint/manager/ti-report?${params}`);
      if (res.ok) {
        const json = await res.json();
        setRows(json.rows    ?? []);
        setSummary(json.summary ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, operatorId, tinterType, obdSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Active shade columns (driven by tinterType dropdown) ──────────────
  const activeShades: readonly string[] =
    tinterType === "TINTER"  ? TINTER_SHADES :
    tinterType === "ACOTONE" ? ACOTONE_SHADES :
    ALL_SHADES;

  // ── Total KG ──────────────────────────────────────────────────────────
  const totalKG = useMemo(
    () =>
      rows.reduce((acc, row) => {
        const totalGrams = Object.values(row.shades).reduce((s, v) => s + v, 0);
        return acc + (totalGrams * row.tinQty) / KG_FACTOR;
      }, 0),
    [rows],
  );

  // ── Summary data (grouped by date x baseSku) ──────────────────────────
  const summaryRows = useMemo(() => {
    const map = new Map<
      string,
      { dateKey: string; dateFmt: string; baseSku: string; entries: number; totalTinQty: number; shades: Record<string, number> }
    >();

    for (const row of rows) {
      const dk  = localDateKey(row.createdAt);
      const df  = fmtDate(row.createdAt);
      const key = `${dk}|${row.baseSku}`;

      let entry = map.get(key);
      if (!entry) {
        entry = { dateKey: dk, dateFmt: df, baseSku: row.baseSku, entries: 0, totalTinQty: 0, shades: {} };
        map.set(key, entry);
      }
      entry.entries += 1;
      entry.totalTinQty += row.tinQty;
      for (const shade of ALL_SHADES) {
        entry.shades[shade] = (entry.shades[shade] ?? 0) + (row.shades[shade] ?? 0);
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
      return a.baseSku.localeCompare(b.baseSku);
    });
  }, [rows]);

  const grandTotal = useMemo(() => {
    const shades: Record<string, number> = {};
    let entries   = 0;
    let tinQtySum = 0;

    for (const sr of summaryRows) {
      entries   += sr.entries;
      tinQtySum += sr.totalTinQty;
      for (const shade of ALL_SHADES) {
        shades[shade] = (shades[shade] ?? 0) + (sr.shades[shade] ?? 0);
      }
    }

    return { entries, tinQtySum, shades };
  }, [summaryRows]);

  // ── Column counts for skeleton / empty state ───────────────────────────
  // Transaction: 8 fixed (Date|OBD|Dealer|Site|Base|Tins|Operator|SubmittedAt) + shades
  // Summary: 4 fixed (Date|BaseSKU|Entries|TinQty) + shades
  const totalCols =
    viewMode === "transactions"
      ? 8 + activeShades.length
      : 4 + activeShades.length;

  // ── Select helpers ─────────────────────────────────────────────────────
  const opVal = operatorId || "__all__";
  const ttVal = tinterType || "__all__";

  // ── Header cell classes ────────────────────────────────────────────────
  const TH_FIXED  = "text-[11px] font-bold uppercase tracking-widest text-slate-500 py-3 px-4 whitespace-nowrap";
  const TH_TINTER = "text-[11px] font-bold uppercase tracking-widest text-[#3949ab] py-3 px-4 whitespace-nowrap";
  const TH_ACO    = "text-[11px] font-bold uppercase tracking-widest text-[#e65100] py-3 px-4 whitespace-nowrap";

  function shadeThCls(shade: string): string {
    return TINTER_SET.has(shade) ? TH_TINTER : TH_ACO;
  }

  // ── Skeleton widths ────────────────────────────────────────────────────
  const SKW = ["w-full", "w-4/5", "w-2/3"];

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f0f2f8] overflow-hidden">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div className="h-[52px] bg-white border-b border-[#e2e5f1] px-6 flex items-center gap-3 sticky top-0 z-40">
        <div className="w-[3px] h-5 bg-[#3949ab] rounded-full" />
        <h1 className="text-[18px] font-extrabold text-gray-900">TI Report</h1>
        <span className="text-sm text-slate-400 ml-2">Tinter Issue Log</span>
      </div>

      {/* ── Filter Card ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e2e5f1] rounded-xl px-5 py-4 mx-6 mt-4 shadow-sm overflow-hidden">
        <div className="flex items-end gap-3 flex-wrap min-w-0">

          {/* Date From */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 rounded-lg border border-[#e2e5f1] bg-white px-2.5 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3949ab]"
            />
          </div>

          {/* Date To */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 rounded-lg border border-[#e2e5f1] bg-white px-2.5 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3949ab]"
            />
          </div>

          {/* Operator */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Operator</span>
            <Select
              value={opVal}
              onValueChange={(v) => setOperatorId(v === "__all__" ? "" : (v ?? ""))}
            >
              <SelectTrigger className="h-9 w-44 text-sm rounded-lg border-[#e2e5f1]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Operators</SelectItem>
                {operators.map((op) => (
                  <SelectItem key={op.id} value={String(op.id)}>
                    {op.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tinter Type — also controls shade columns */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Type</span>
            <Select
              value={ttVal}
              onValueChange={(v) => setTinterType(v === "__all__" ? "" : (v ?? ""))}
            >
              <SelectTrigger className="h-9 w-36 text-sm rounded-lg border-[#e2e5f1]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Types</SelectItem>
                <SelectItem value="TINTER">TINTER</SelectItem>
                <SelectItem value="ACOTONE">ACOTONE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* OBD Search */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Search</span>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search OBD…"
              className="h-9 w-40 text-sm rounded-lg border-[#e2e5f1]"
            />
          </div>

          {/* Divider */}
          <div className="w-px h-9 bg-[#e2e5f1] self-end" />

          {/* View Toggle */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">&nbsp;</span>
            <SegmentedToggle
              options={[
                { value: "transactions", label: "Transactions" },
                { value: "summary",      label: "Summary" },
              ]}
              value={viewMode}
              onChange={(v) => setViewMode(v as "transactions" | "summary")}
            />
          </div>

          {/* Export Excel */}
          <button
            type="button"
            onClick={() => exportXLSX(rows, tinterType, dateFrom, dateTo)}
            disabled={rows.length === 0 || loading}
            className="ml-auto self-end h-9 px-4 gap-2 text-sm font-semibold rounded-lg bg-[#1a237e] hover:bg-[#283593] text-white flex items-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel
          </button>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="mx-6 mt-4 mb-6 overflow-hidden">
        <div className="bg-white rounded-2xl border border-[#e2e5f1] shadow-md overflow-hidden" style={{ minHeight: "calc(100vh - 220px)" }}>
          {/* rotateX trick: flips container so scrollbar appears at bottom of card, then flips content back */}
          <div
            className="scrollbar-hide"
            style={{
              overflowX:        "auto",
              overflowY:        "auto",
              maxHeight:        "calc(100vh - 220px)",
              transform:        "rotateX(180deg)",
              scrollbarWidth:   "thin",
            }}
          >
          <div style={{ transform: "rotateX(180deg)" }}>
            <Table>

              {/* ── Transactions view ──────────────────────────────────────── */}
              {viewMode === "transactions" && (
                <>
                  <TableHeader className="sticky top-0 z-10">
                    <TableRow className="bg-[#f0f2f8] border-b-2 border-[#e2e5f1]">
                      <TableHead className={TH_FIXED}>Date</TableHead>
                      <TableHead className={TH_FIXED}>OBD Number</TableHead>
                      <TableHead className={TH_FIXED}>Dealer Name</TableHead>
                      <TableHead className={TH_FIXED}>Site Name</TableHead>
                      <TableHead className={TH_FIXED}>Base</TableHead>
                      <TableHead className={`${TH_FIXED} text-right`}>Tins</TableHead>
                      <TableHead className={TH_FIXED}>Operator</TableHead>
                      {activeShades.map((s) => (
                        <TableHead key={s} className={`${shadeThCls(s)} text-right`}>{s}</TableHead>
                      ))}
                      <TableHead className={`${TH_FIXED} text-right`}>Submitted At</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {/* Loading skeleton */}
                    {loading &&
                      Array.from({ length: 8 }, (_, i) => (
                        <TableRow key={`sk-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-[#f8f9ff]"}>
                          {Array.from({ length: totalCols }, (__, j) => (
                            <TableCell key={j} className="py-2.5 px-4">
                              <div className={`h-4 bg-slate-100 rounded-full animate-pulse ${SKW[j % 3]}`} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    }

                    {/* Empty state */}
                    {!loading && rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={totalCols} className="py-20 text-center">
                          <Inbox className="h-12 w-12 text-slate-200 mx-auto mb-4" />
                          <p className="text-slate-400 font-medium text-sm">No entries found</p>
                          <p className="text-slate-300 text-xs mt-1">Try adjusting your date range or filters</p>
                        </TableCell>
                      </TableRow>
                    )}

                    {/* Data rows */}
                    {!loading &&
                      rows.map((row, idx) => {
                        const isEven = idx % 2 === 0;
                        const rowCls = `${isEven ? "bg-white" : "bg-[#f8f9ff]"} hover:bg-[#eef0fb] transition-colors duration-150`;
                        const cellCls = "py-2.5 px-4 border-b border-[#f0f2f8]";
                        const shadeCls =
                          row.tinterType === "TINTER"
                            ? { nonzero: "text-[#1a237e] font-semibold text-right tabular-nums text-sm", zero: "text-slate-300 text-right tabular-nums text-sm" }
                            : { nonzero: "text-[#e65100] font-semibold text-right tabular-nums text-sm", zero: "text-slate-300 text-right tabular-nums text-sm" };

                        return (
                          <TableRow key={`${row.tinterType}-${row.id}`} className={rowCls}>
                            <TableCell className={`${cellCls} font-medium text-slate-600 whitespace-nowrap text-sm`}>
                              {fmtDate(row.createdAt)}
                            </TableCell>
                            <TableCell className={`${cellCls} font-mono text-xs font-semibold text-[#1a237e] whitespace-nowrap`}>
                              {row.obdNumber}
                            </TableCell>
                            <TableCell
                              className={`${cellCls} text-sm text-slate-800 font-medium whitespace-nowrap truncate max-w-[180px]`}
                              title={row.billToName}
                            >
                              {truncate(row.billToName, 24)}
                            </TableCell>
                            <TableCell
                              className={`${cellCls} text-sm text-slate-600 whitespace-nowrap truncate max-w-[160px]`}
                              title={row.customerName}
                            >
                              {truncate(row.customerName, 22)}
                            </TableCell>
                            <TableCell className={`${cellCls} font-mono text-xs text-slate-700 whitespace-nowrap`}>
                              {row.baseSku}
                            </TableCell>
                            <TableCell className={`${cellCls} text-right tabular-nums text-slate-700 text-sm whitespace-nowrap`}>
                              {row.tinQty.toFixed(2)}
                            </TableCell>
                            <TableCell className={`${cellCls} text-sm text-slate-600 whitespace-nowrap`}>
                              {row.operatorName}
                            </TableCell>
                            {activeShades.map((s) => {
                              const v = row.shades[s] ?? 0;
                              return (
                                <TableCell key={s} className={`${cellCls} ${v > 0 ? shadeCls.nonzero : shadeCls.zero}`}>
                                  {v > 0 ? v : "0"}
                                </TableCell>
                              );
                            })}
                            <TableCell className={`${cellCls} text-xs text-slate-400 whitespace-nowrap text-right`}>
                              {fmtCreatedAt(row.createdAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    }
                  </TableBody>
                </>
              )}

              {/* ── Summary view ───────────────────────────────────────────── */}
              {viewMode === "summary" && (
                <>
                  <TableHeader className="sticky top-0 z-10">
                    <TableRow className="bg-[#f0f2f8] border-b-2 border-[#e2e5f1]">
                      <TableHead className={TH_FIXED}>Date</TableHead>
                      <TableHead className={TH_FIXED}>Base SKU</TableHead>
                      <TableHead className={`${TH_FIXED} text-center`}>Entries</TableHead>
                      <TableHead className={`${TH_FIXED} text-right`}>Tin Qty</TableHead>
                      {activeShades.map((s) => (
                        <TableHead key={s} className={`${shadeThCls(s)} text-right`}>{s}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {/* Loading skeleton */}
                    {loading &&
                      Array.from({ length: 8 }, (_, i) => (
                        <TableRow key={`sk-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-[#f8f9ff]"}>
                          {Array.from({ length: totalCols }, (__, j) => (
                            <TableCell key={j} className="py-2.5 px-4">
                              <div className={`h-4 bg-slate-100 rounded-full animate-pulse ${SKW[j % 3]}`} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    }

                    {/* Empty state */}
                    {!loading && rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={totalCols} className="py-20 text-center">
                          <Inbox className="h-12 w-12 text-slate-200 mx-auto mb-4" />
                          <p className="text-slate-400 font-medium text-sm">No entries found</p>
                          <p className="text-slate-300 text-xs mt-1">Try adjusting your date range or filters</p>
                        </TableCell>
                      </TableRow>
                    )}

                    {/* Summary rows */}
                    {!loading &&
                      summaryRows.map((sr, idx) => {
                        const isEven = idx % 2 === 0;
                        const rowCls = `${isEven ? "bg-white" : "bg-[#f8f9ff]"} hover:bg-[#eef0fb] transition-colors duration-150`;
                        const cellCls = "py-2.5 px-4 border-b border-[#f0f2f8]";

                        return (
                          <TableRow key={`${sr.dateKey}-${sr.baseSku}`} className={rowCls}>
                            <TableCell className={`${cellCls} font-semibold text-slate-700 whitespace-nowrap text-sm`}>
                              {sr.dateFmt}
                            </TableCell>
                            <TableCell className={`${cellCls} font-mono text-xs text-slate-700 whitespace-nowrap`}>
                              {sr.baseSku}
                            </TableCell>
                            <TableCell className={`${cellCls} tabular-nums text-slate-600 text-center text-sm`}>
                              {sr.entries}
                            </TableCell>
                            <TableCell className={`${cellCls} tabular-nums text-slate-700 text-right text-sm whitespace-nowrap`}>
                              {sr.totalTinQty.toFixed(2)}
                            </TableCell>
                            {activeShades.map((s) => {
                              const v = sr.shades[s] ?? 0;
                              const cls = TINTER_SET.has(s)
                                ? (v > 0 ? "text-[#1a237e] font-semibold text-right tabular-nums text-sm" : "text-slate-300 text-right tabular-nums text-sm")
                                : (v > 0 ? "text-[#e65100] font-semibold text-right tabular-nums text-sm" : "text-slate-300 text-right tabular-nums text-sm");
                              return (
                                <TableCell key={s} className={`${cellCls} ${cls}`}>
                                  {v > 0 ? v : "0"}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })
                    }

                    {/* Grand total row */}
                    {!loading && summaryRows.length > 0 && (
                      <TableRow className="bg-[#e8eaf6] border-t-2 border-[#3949ab]">
                        <TableCell
                          colSpan={2}
                          className="py-2.5 px-4 text-[#1a237e] font-extrabold uppercase text-xs tracking-widest whitespace-nowrap"
                        >
                          TOTAL
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-[#1a237e] font-bold tabular-nums text-center text-sm">
                          {grandTotal.entries}
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-[#1a237e] font-bold tabular-nums text-right text-sm whitespace-nowrap">
                          {grandTotal.tinQtySum.toFixed(2)}
                        </TableCell>
                        {activeShades.map((s) => (
                          <TableCell key={s} className="py-2.5 px-4 text-[#1a237e] font-extrabold tabular-nums text-right text-sm whitespace-nowrap">
                            {grandTotal.shades[s] ?? 0}
                          </TableCell>
                        ))}
                      </TableRow>
                    )}
                  </TableBody>
                </>
              )}

            </Table>
          </div>
          </div>
        </div>
      </div>

      {/* Keep summary + totalKG in scope — used by exportXLSX indirectly */}
      {summary && totalKG > 0 && <span className="hidden" />}

    </div>
  );
}