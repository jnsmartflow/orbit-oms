"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShadeRow {
  id:               number;
  shadeName:        string;
  shipToCustomerId: string;
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

// ── Component ─────────────────────────────────────────────────────────────────

export function ShadeMasterContent() {
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState("");
  const [searchInput,  setSearchInput]  = useState("");
  const [tinterType,   setTinterType]   = useState<string>("");
  const [packCode,     setPackCode]     = useState<string>("");
  const [data,         setData]         = useState<ShadeRow[]>([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(false);
  const [togglingId,   setTogglingId]   = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (search)     params.set("search",     search);
      if (tinterType) params.set("tinterType", tinterType);
      if (packCode)   params.set("packCode",   packCode);

      const res = await fetch(`/api/admin/shades?${params}`);
      if (res.ok) {
        const json: ApiResponse = await res.json();
        setData(json.data);
        setTotal(json.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, search, tinterType, packCode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleToggle(id: number, isActive: boolean) {
    setTogglingId(id);
    // Optimistic update
    setData((prev) => prev.map((r) => r.id === id ? { ...r, isActive } : r));
    await fetch(`/api/admin/shades/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ isActive }),
    });
    setTogglingId(null);
  }

  function applySearch() {
    setSearch(searchInput);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-4">
      {/* ── Filters ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            className="pl-8 w-56 h-8 text-sm"
            placeholder="Search shade or customer…"
            value={searchInput}
            onChange={(e) => setSearchInput((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
          />
        </div>

        {/* Tinter type toggle */}
        <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {(["", "TINTER", "ACOTONE"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTinterType(t); setPage(1); }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                tinterType === t
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "" ? "All" : t}
            </button>
          ))}
        </div>

        {/* Pack code filter */}
        <select
          value={packCode}
          onChange={(e) => { setPackCode(e.target.value); setPage(1); }}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-slate-700 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">All Packs</option>
          {Object.entries(PACK_CODE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="text-xs text-slate-500 font-semibold w-10">#</TableHead>
              <TableHead className="text-xs text-slate-500 font-semibold">Shade Name</TableHead>
              <TableHead className="text-xs text-slate-500 font-semibold">Customer ID</TableHead>
              <TableHead className="text-xs text-slate-500 font-semibold">Type</TableHead>
              <TableHead className="text-xs text-slate-500 font-semibold">Pack</TableHead>
              <TableHead className="text-xs text-slate-500 font-semibold">Status</TableHead>
              <TableHead className="text-xs text-slate-500 font-semibold">Active</TableHead>
              <TableHead className="text-xs text-slate-500 font-semibold">Created By</TableHead>
              <TableHead className="text-xs text-slate-500 font-semibold">Created At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-slate-400 py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-slate-400 py-8">
                  No shades found.
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, idx) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-slate-400">
                    {(page - 1) * LIMIT + idx + 1}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-slate-900">
                    {row.shadeName}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {row.shipToCustomerId}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={row.tinterType === "ACOTONE" ? "secondary" : "outline"}
                      className="text-[10px]"
                    >
                      {row.tinterType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {row.packCode ? (PACK_CODE_LABELS[row.packCode] ?? row.packCode) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={row.isActive ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {row.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={row.isActive}
                      onCheckedChange={(checked: boolean) => handleToggle(row.id, checked)}
                      disabled={togglingId === row.id}
                      size="sm"
                    />
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {row.createdBy?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {new Date(row.createdAt).toLocaleDateString("en-IN")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {total} shade{total !== 1 ? "s" : ""} total
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span>Page {page} of {totalPages}</span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
