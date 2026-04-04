"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UniversalHeader } from "@/components/universal-header";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShadeRow {
  id:               number;
  shadeName:        string;
  shipToCustomerId: string;
  skuCode:          string | null;
  tinterType:       "TINTER" | "ACOTONE";
  packCode:         string | null;
  isActive:         boolean;
  createdBy:        { name: string } | null;
  createdAt:        string;
}

interface ApiResponse {
  data:  ShadeRow[];
  total: number;
  page:  number;
  limit: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PACK_CODE_LABELS: Record<string, string> = {
  ml_500: "500ml",
  L_1:    "1L",
  L_4:    "4L",
  L_10:   "10L",
  L_20:   "20L",
};

const LIMIT = 20;

type StatusFilter = "all" | "active" | "inactive";
type TinterFilter = "" | "TINTER" | "ACOTONE";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short" })}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function nowIST(): string {
  return new Date().toLocaleTimeString("en-IN", {
    timeZone:     "Asia/Kolkata",
    hour:         "2-digit",
    minute:       "2-digit",
    hour12:       false,
  });
}

function nowDateIST(): string {
  return new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday:  "short",
    day:      "2-digit",
    month:    "short",
  });
}

// ── iPhone-style Toggle ───────────────────────────────────────────────────────

function IosToggle({
  checked,
  onChange,
  disabled,
}: {
  checked:  boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[20px] w-[36px] flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? "bg-teal-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-[16px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShadeMasterContent() {
  const [page,           setPage]           = useState(1);
  const [search,         setSearch]         = useState("");
  const [tinterFilter,   setTinterFilter]   = useState<TinterFilter>("");
  const [packCode,       setPackCode]       = useState<string>("");
  const [statusFilter,   setStatusFilter]   = useState<StatusFilter>("all");
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({ tinterType: [], status: [] });
  const [data,           setData]           = useState<ShadeRow[]>([]);
  const [total,          setTotal]          = useState(0);
  const [loading,        setLoading]        = useState(false);
  const [togglingId,     setTogglingId]     = useState<number | null>(null);

  // Sync header filters → existing filter state
  useEffect(() => {
    const tt = headerFilters.tinterType ?? [];
    setTinterFilter(tt.length === 1 ? tt[0] as TinterFilter : "");
    const st = headerFilters.status ?? [];
    setStatusFilter(st.length === 1 ? st[0] as StatusFilter : "all");
    setPage(1);
  }, [headerFilters]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (search)                      params.set("search",     search);
      if (tinterFilter)                params.set("tinterType", tinterFilter);
      if (packCode)                    params.set("packCode",   packCode);
      if (statusFilter === "active")   params.set("isActive",   "true");
      if (statusFilter === "inactive") params.set("isActive",   "false");

      const res = await fetch(`/api/admin/shades?${params}`);
      if (res.ok) {
        const json: ApiResponse = await res.json();
        setData(json.data);
        setTotal(json.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, search, tinterFilter, packCode, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounced search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleSearchChange(val: string) {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); }, 300);
  }

  async function handleToggle(id: number, isActive: boolean) {
    setTogglingId(id);
    setData((prev) => prev.map((r) => r.id === id ? { ...r, isActive } : r));
    await fetch(`/api/admin/shades/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ isActive }),
    });
    setTogglingId(null);
  }

  function clearFilters() {
    setTinterFilter("");
    setPackCode("");
    setStatusFilter("all");
    setPage(1);
  }

  const activeFilterCount = [
    tinterFilter !== "",
    packCode !== "",
    statusFilter !== "all",
  ].filter(Boolean).length;

  const totalPages    = Math.max(1, Math.ceil(total / LIMIT));
  const activeCount   = data.filter((r) =>  r.isActive).length;
  const inactiveCount = data.filter((r) => !r.isActive).length;

  return (
    <div className="flex flex-col h-full bg-white">

      <UniversalHeader
        title="Shade Master"
        stats={[
          { label: "shades", value: total },
          { label: "active", value: activeCount },
          { label: "inactive", value: inactiveCount },
        ]}
        showDatePicker={false}
        filterGroups={[
          { label: "Tinter Type", key: "tinterType", options: [{ value: "TINTER", label: "Tinter" }, { value: "ACOTONE", label: "Acotone" }] },
          { label: "Status", key: "status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        searchPlaceholder="Search shade name or customer ID..."
        searchValue={search}
        onSearchChange={(v) => handleSearchChange(v)}
      />

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 border-b border-gray-100 hover:bg-gray-50">
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider w-10">#</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Shade Name</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Customer ID</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider w-28">Type</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">SKU Code</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Pack</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Active</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Added By</TableHead>
                <TableHead className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Added At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>

              {/* Loading skeleton */}
              {loading && Array.from({ length: 10 }, (_, i) => (
                <TableRow key={`sk-${i}`} className="border-b border-gray-50">
                  {Array.from({ length: 10 }, (__, j) => (
                    <TableCell key={j} className="py-2.5 px-4">
                      <div className={`h-3.5 bg-gray-100 rounded-full animate-pulse ${
                        j === 1 ? "w-4/5" : j === 2 ? "w-2/3" : "w-1/2"
                      }`} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

              {/* Empty state */}
              {!loading && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-[11px] text-gray-400 py-16">
                    No shades found.
                  </TableCell>
                </TableRow>
              )}

              {/* Data rows */}
              {!loading && data.map((row, idx) => (
                <TableRow
                  key={row.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                >
                  <TableCell className="py-2.5 px-4 text-[11px] text-gray-400 tabular-nums w-10">
                    {(page - 1) * LIMIT + idx + 1}
                  </TableCell>
                  <TableCell className="py-2.5 px-4 text-[11px] font-medium text-gray-900">
                    {row.shadeName}
                  </TableCell>
                  <TableCell className="py-2.5 px-4 text-[11px] text-gray-600 font-mono">
                    {row.shipToCustomerId}
                  </TableCell>
                  <TableCell className="py-2.5 px-4 w-28">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${
                          row.tinterType === "TINTER" ? "bg-blue-600" : "bg-orange-500"
                        }`}
                        title={row.tinterType}
                      />
                      <span className="text-[10.5px] text-gray-400">{row.tinterType}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 px-4 text-[11px] text-gray-600 font-mono">
                    {row.skuCode ?? "—"}
                  </TableCell>
                  <TableCell className="py-2.5 px-4 text-[11px] text-gray-600">
                    {row.packCode ? (PACK_CODE_LABELS[row.packCode] ?? row.packCode) : "—"}
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    {row.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10.5px] font-semibold bg-green-50 border-green-200 text-green-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10.5px] font-semibold bg-gray-50 border-gray-200 text-gray-500">
                        Inactive
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <IosToggle
                      checked={row.isActive}
                      onChange={(checked) => handleToggle(row.id, checked)}
                      disabled={togglingId === row.id}
                    />
                  </TableCell>
                  <TableCell className="py-2.5 px-4 text-[11px] text-gray-500">
                    {row.createdBy?.name ?? "—"}
                  </TableCell>
                  <TableCell className="py-2.5 px-4 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <span
                        className="text-[11px] font-medium text-gray-900 tabular-nums"
                        title={fmtDate(row.createdAt)}
                      >
                        {fmtDateShort(row.createdAt)}
                      </span>
                      <span className="text-[10px] text-gray-400 tabular-nums">
                        {fmtTime(row.createdAt)}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────────── */}
      <div className="h-[40px] flex items-center justify-between px-4 border-t border-gray-100 flex-shrink-0">
        <span className="text-[11px] text-gray-400">
          {total} shade{total !== 1 ? "s" : ""} total
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[11px] text-gray-500">Page {page} of {totalPages}</span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

    </div>
  );
}
