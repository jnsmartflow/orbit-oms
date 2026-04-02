"use client";

import * as XLSX from "xlsx";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Download, Inbox, ChevronDown, ChevronRight, ChevronLeft, SlidersHorizontal,
} from "lucide-react";

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
const KG_FACTOR      = 2162;
const MONTH_NAMES    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES      = ["Su","Mo","Tu","We","Th","Fr","Sa"];

const PACK_CODE_LABELS: Record<string, string> = {
  ml_500: "500ml", L_1: "1L", L_4: "4L", L_10: "10L", L_20: "20L",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateToISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDisplay(iso: string): string {
  const d = isoToDate(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES[d.getMonth()]}`;
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short" })}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDateXLSX(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`;
}

function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function packLabel(code: string | null): string {
  if (!code) return "";
  return PACK_CODE_LABELS[code] ?? code;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ── XLSX Export ───────────────────────────────────────────────────────────────

function exportXLSX(rows: TIRow[], tinterType: string, dateFrom: string, dateTo: string) {
  const shades: string[] =
    tinterType === "ACOTONE" ? [...ACOTONE_SHADES]
    : tinterType === "TINTER" ? [...TINTER_SHADES]
    : [...TINTER_SHADES, ...ACOTONE_SHADES];

  const header = [
    "Date","OBD Number","Dealer Name","Site Name","Base","Tins","Operator",
    ...shades, ...shades.map((s) => `${s}(kg)`),
  ];
  const dataRows = rows.map((r) => [
    fmtDateXLSX(r.createdAt), r.obdNumber, r.billToName, r.customerName,
    r.baseSku, r.tinQty, r.operatorName,
    ...shades.map((s) => r.shades[s] ?? 0),
    ...shades.map((s) => parseFloat(((r.shades[s] ?? 0) * r.tinQty / KG_FACTOR).toFixed(3))),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  const allRows = [header, ...dataRows];
  ws["!cols"] = header.map((_, ci) => ({
    wch: Math.min(30, Math.max(8, allRows.reduce((acc, row) => Math.max(acc, String(row[ci] ?? "").length), 0) + 2)),
  }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "TI Report");
  XLSX.writeFile(wb, `ti-report-${dateFrom}-${dateTo}.xlsx`);
}

// ── Date Range Picker ─────────────────────────────────────────────────────────

function DateRangePicker({ dateFrom, dateTo, onChange }: {
  dateFrom: string;
  dateTo:   string;
  onChange: (from: string, to: string) => void;
}) {
  const [open,      setOpen]      = useState(false);
  const [selecting, setSelecting] = useState<"from" | "to">("from");
  const [tempFrom,  setTempFrom]  = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [calYear,   setCalYear]   = useState(() => new Date().getFullYear());
  const [calMonth,  setCalMonth]  = useState(() => new Date().getMonth());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setSelecting("from"); setTempFrom(null);
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function applyPreset(from: string, to: string) {
    onChange(from, to); setOpen(false); setSelecting("from"); setTempFrom(null);
  }

  function handleDayClick(iso: string) {
    if (selecting === "from") {
      setTempFrom(iso); setSelecting("to");
    } else {
      const from = tempFrom!;
      onChange(iso < from ? iso : from, iso < from ? from : iso);
      setOpen(false); setSelecting("from"); setTempFrom(null);
    }
  }

  const today     = todayISO();
  const yesterday = dateToISO(new Date(Date.now() - 86400000));
  const weekStart = dateToISO(startOfWeek(new Date()));
  const monStart  = dateToISO(startOfMonth(new Date()));

  const firstDay  = new Date(calYear, calMonth, 1).getDay();
  const daysInMon = new Date(calYear, calMonth + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMon }, (_, i) =>
      `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const activeFrom = tempFrom ?? dateFrom;
  const activeTo   = hoverDate && selecting === "to" ? hoverDate : dateTo;

  const isSameDay  = dateFrom === dateTo;
  const rangeLabel = isSameDay
    ? fmtDisplay(dateFrom)
    : `${fmtDisplay(dateFrom)} – ${fmtDisplay(dateTo)}`;

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-7 px-3 flex items-center gap-1.5 rounded-md border text-[11px] font-medium transition-colors ${
          open ? "border-gray-900 text-gray-900" : "border-gray-200 text-gray-700 hover:border-gray-300"
        }`}
      >
        {rangeLabel}
        <ChevronDown className="h-3 w-3 text-gray-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-[240px]">
          {/* Presets */}
          <div className="p-2 border-b border-gray-100 flex flex-col gap-0.5">
            {[
              { label: "Today",      from: today,     to: today     },
              { label: "Yesterday",  from: yesterday, to: yesterday },
              { label: "This Week",  from: weekStart, to: today     },
              { label: "This Month", from: monStart,  to: today     },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.from, p.to)}
                className={`text-left px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  dateFrom === p.from && dateTo === p.to
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); } else setCalMonth((m) => m - 1); }}
                className="p-0.5 rounded hover:bg-gray-100 text-gray-400"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[11px] font-semibold text-gray-700">
                {MONTH_NAMES[calMonth]} {calYear}
              </span>
              <button
                type="button"
                onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); } else setCalMonth((m) => m + 1); }}
                className="p-0.5 rounded hover:bg-gray-100 text-gray-400"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {DAY_NAMES.map((d) => (
                <div key={d} className="text-center text-[9.5px] font-bold text-gray-400 py-0.5">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((iso, idx) => {
                if (!iso) return <div key={`e-${idx}`} />;
                const isFrom   = iso === activeFrom;
                const isTo     = iso === activeTo && selecting !== "to";
                const inRange  = iso > activeFrom && iso < activeTo;
                const isToday  = iso === today;
                const isFuture = iso > today;
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={isFuture}
                    onClick={() => handleDayClick(iso)}
                    onMouseEnter={() => setHoverDate(iso)}
                    onMouseLeave={() => setHoverDate(null)}
                    className={`h-7 w-full text-[11px] rounded-md transition-colors
                      ${isFuture ? "text-gray-200 cursor-not-allowed" : ""}
                      ${isFrom || isTo ? "bg-gray-900 text-white font-semibold" : ""}
                      ${inRange ? "bg-gray-100 text-gray-700" : ""}
                      ${!isFrom && !isTo && !inRange && !isFuture ? "text-gray-700 hover:bg-gray-50" : ""}
                      ${isToday && !isFrom && !isTo ? "font-semibold" : ""}
                    `}
                  >
                    {isoToDate(iso).getDate()}
                  </button>
                );
              })}
            </div>

            {selecting === "to" && tempFrom && (
              <p className="text-[10px] text-gray-400 mt-2 text-center">Now pick end date</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shade Expand Row ──────────────────────────────────────────────────────────

function ShadeExpandRow({ row }: { row: TIRow }) {
  const shades = row.tinterType === "TINTER" ? [...TINTER_SHADES] : [...ACOTONE_SHADES];
  return (
    <TableRow className="bg-gray-50 border-b border-gray-100">
      <TableCell colSpan={9} className="py-3 px-6">
        <div className="flex items-start gap-5">
          <span className={`text-[10px] font-bold uppercase tracking-wider mt-1 flex-shrink-0 ${
            row.tinterType === "TINTER" ? "text-blue-600" : "text-orange-500"
          }`}>
            {row.tinterType}
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {shades.map((s) => {
              const v = row.shades[s] ?? 0;
              return (
                <div key={s} className="flex flex-col items-center gap-0.5 min-w-[28px]">
                  <span className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400">{s}</span>
                  <span className={`text-[12px] font-semibold tabular-nums ${v > 0 ? "text-gray-900" : "text-gray-200"}`}>
                    {v > 0 ? v : "0"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TIReportContent() {
  const today = todayISO();

  const [dateFrom,    setDateFrom]    = useState(today);
  const [dateTo,      setDateTo]      = useState(today);
  const [operatorId,  setOperatorId]  = useState("");
  const [tinterType,  setTinterType]  = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [obdSearch,   setObdSearch]   = useState("");
  const [filterOpen,  setFilterOpen]  = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [rows,        setRows]        = useState<TIRow[]>([]);
  const [summary,     setSummary]     = useState<Summary | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [operators,   setOperators]   = useState<Operator[]>([]);

  const filterRef = useRef<HTMLDivElement>(null);

  // Close filter on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    if (filterOpen) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [filterOpen]);

  // Debounce OBD search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setObdSearch(searchInput), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  useEffect(() => {
    fetch("/api/tint/manager/operators")
      .then((r) => r.json())
      .then((d) => setOperators(d.operators ?? []))
      .catch(() => {});
  }, []);

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

  function toggleExpand(key: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function clearFilters() {
    setOperatorId(""); setTinterType("");
  }

  const activeFilterCount = [operatorId !== "", tinterType !== ""].filter(Boolean).length;

  const isSameDay     = dateFrom === dateTo;
  const downloadLabel = isSameDay ? fmtDisplay(dateFrom) : `${fmtDisplay(dateFrom)} – ${fmtDisplay(dateTo)}`;

  function fmtDisplay(iso: string): string {
    const d = isoToDate(iso);
    return `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES[d.getMonth()]}`;
  }

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Row 1 ────────────────────────────────────────────────────────────── */}
      <div className="h-[42px] flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0 sticky top-0 z-20 bg-white">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-semibold text-gray-900">TI Report</span>
          <span className="text-[11px] text-gray-400">
            <span className="text-gray-900 font-semibold">{summary?.totalEntries ?? 0}</span> entries
          </span>
          <span className="text-[11px] text-gray-400">
            <span className="text-gray-900 font-semibold">{(summary?.totalTinQty ?? 0).toFixed(1)}</span> tins
          </span>
          <span className="w-px h-3 bg-gray-200" />
          <span className="text-[11px] text-gray-400">
            TINTER <span className="text-gray-900 font-semibold">{summary?.byType.TINTER ?? 0}</span>
          </span>
          <span className="text-[11px] text-gray-400">
            ACOTONE <span className="text-gray-900 font-semibold">{summary?.byType.ACOTONE ?? 0}</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => exportXLSX(rows, tinterType, dateFrom, dateTo)}
          disabled={rows.length === 0 || loading}
          className="h-7 px-3 gap-1.5 text-[11px] font-medium rounded-md bg-gray-900 hover:bg-gray-800 text-white flex items-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="h-3 w-3" />
          Download Excel
          <span className="w-px h-3 bg-white/30 mx-0.5" />
          <span className="text-white/70 text-[10px]">{downloadLabel}</span>
        </button>
      </div>

      {/* ── Row 2 ────────────────────────────────────────────────────────────── */}
      <div className="h-[40px] flex items-center gap-2 px-4 border-b border-gray-100 flex-shrink-0 sticky top-[42px] z-10 bg-white">

        {/* Date range picker */}
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />

        {/* OBD Search */}
        <div className="relative flex-1 max-w-[280px]">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search OBD…"
            className="h-7 w-full text-[11px] rounded-md border-gray-200 focus-visible:ring-gray-900/20"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filter dropdown */}
        <div className="relative flex-shrink-0" ref={filterRef}>
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className={`h-7 px-3 flex items-center gap-1.5 rounded-md border text-[11px] font-medium transition-colors ${
              activeFilterCount > 0
                ? "border-gray-900 text-gray-900"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Filter
            {activeFilterCount > 0 && (
              <span className="ml-0.5 bg-gray-900 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3 flex flex-col gap-3">

              {/* Operator */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Operator</p>
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => setOperatorId("")}
                    className={`text-left px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                      operatorId === "" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    All Operators
                  </button>
                  {operators.map((op) => (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => setOperatorId(String(op.id))}
                      className={`text-left px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                        operatorId === String(op.id) ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {op.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Type</p>
                <div className="flex gap-1">
                  {(["", "TINTER", "ACOTONE"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTinterType(t)}
                      className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                        tinterType === t
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {t === "" ? "All" : t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clear */}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => { clearFilters(); setFilterOpen(false); }}
                  className="text-[11px] text-gray-400 hover:text-gray-600 text-left pt-1 border-t border-gray-100"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 border-b border-gray-100 hover:bg-gray-50">
                <TableHead className="w-8" />
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Date</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">OBD No.</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Dealer</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Site</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Base</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Pack</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider text-right">Tins</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Operator · Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>

              {loading && Array.from({ length: 8 }, (_, i) => (
                <TableRow key={`sk-${i}`} className="border-b border-gray-50">
                  {Array.from({ length: 9 }, (__, j) => (
                    <TableCell key={j} className="py-2.5 px-4">
                      <div className={`h-3.5 bg-gray-100 rounded-full animate-pulse ${j === 3 ? "w-4/5" : j === 4 ? "w-2/3" : "w-1/2"}`} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-20 text-center">
                    <Inbox className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-[11px] text-gray-400 font-medium">No entries found</p>
                    <p className="text-[11px] text-gray-300 mt-1">Try adjusting your date range or filters</p>
                  </TableCell>
                </TableRow>
              )}

              {!loading && rows.map((row) => {
                const key      = `${row.tinterType}-${row.id}`;
                const expanded = expandedIds.has(key);
                const pack     = packLabel(row.packCode);

                return (
                  <>
                    <TableRow
                      key={key}
                      onClick={() => toggleExpand(key)}
                      className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
                    >
                      <TableCell className="w-8 py-2.5 px-3 text-gray-300">
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-[11px] text-gray-400 whitespace-nowrap tabular-nums">
                        {fmtDateShort(row.createdAt)}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${row.tinterType === "TINTER" ? "bg-blue-600" : "bg-orange-500"}`}
                            title={row.tinterType}
                          />
                          <span className="font-mono text-[11px] text-gray-800">{row.obdNumber}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-[11px] text-gray-900 font-medium max-w-[180px] truncate" title={row.billToName}>
                        {truncate(row.billToName, 26)}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-[11px] text-gray-600 max-w-[160px] truncate" title={row.customerName}>
                        {truncate(row.customerName, 24)}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 whitespace-nowrap">
                        <span className="font-mono text-[11px] text-gray-700">{row.baseSku}</span>
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-[11px] text-gray-600 whitespace-nowrap">
                        {pack || "—"}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-right text-[11px] text-gray-700 tabular-nums whitespace-nowrap">
                        {Number.isInteger(row.tinQty) ? row.tinQty : parseFloat(row.tinQty.toFixed(2))}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-gray-700 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                            {row.operatorName.charAt(0).toUpperCase()}
                          </span>
                          <span className="text-[11px] text-gray-600">{row.operatorName}</span>
                          <span className="text-[11px] text-gray-400">{fmtTime(row.createdAt)}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && <ShadeExpandRow key={`${key}-expand`} row={row} />}
                  </>
                );
              })}

            </TableBody>
          </Table>
        </div>
      </div>

    </div>
  );
}
