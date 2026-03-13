"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SkuSheet, type SkuRow, CONTAINER_TYPES } from "./sku-sheet";
import { cn } from "@/lib/utils";

interface ImportResult {
  created: number;
  updated: number;
  failed: { row: number; reason: string }[];
}

interface SkusTableProps {
  initialSkus: SkuRow[];
  initialTotal: number;
}

export function SkusTable({ initialSkus, initialTotal }: SkusTableProps) {
  const [skus, setSkus] = useState<SkuRow[]>(initialSkus);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(Math.ceil(initialTotal / 25));
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterContainer, setFilterContainer] = useState("all");
  const [filterActive, setFilterActive] = useState("all");

  // Sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<SkuRow | null>(null);

  // CSV import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const isFirstRender = useRef(true);

  // ── Debounce search ──────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Refetch on filter change ─────────────────────────────────────────────
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, filterContainer, filterActive]);

  // ── Fetch ────────────────────────────────────────────────────────────────
  function buildParams(pageNum: number) {
    const p = new URLSearchParams({ page: pageNum.toString() });
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (filterContainer !== "all") p.set("containerType", filterContainer);
    if (filterActive !== "all") p.set("isActive", filterActive === "active" ? "true" : "false");
    return p;
  }

  async function fetchPage(pageNum: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/skus?${buildParams(pageNum)}`);
      if (!res.ok) { toast.error("Failed to load SKUs."); return; }
      const data = await res.json();
      setSkus(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setPage(pageNum);
    } catch {
      toast.error("Network error.");
    } finally {
      setLoading(false);
    }
  }

  // ── Sheet handlers ───────────────────────────────────────────────────────
  function openAdd() { setEditingSku(null); setSheetOpen(true); }
  function openEdit(sku: SkuRow) { setEditingSku(sku); setSheetOpen(true); }

  function handleSaved(saved: SkuRow) {
    if (editingSku) {
      setSkus((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    } else {
      fetchPage(1);
    }
  }

  // ── CSV import ───────────────────────────────────────────────────────────
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/skus/import", { method: "POST", body: formData });
      const data: ImportResult = await res.json();
      if (!res.ok) { toast.error((data as any).error ?? "Import failed."); return; }
      setImportResult(data);
      if (data.created + data.updated > 0) fetchPage(1);
    } catch {
      toast.error("Network error during import.");
    } finally {
      setImporting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">
          SKUs
          {total > 0 && <span className="ml-2 text-sm font-normal text-slate-400">{total} total</span>}
        </h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={importing} onClick={() => fileInputRef.current?.click()}>
            {importing ? "Importing…" : "Import CSV"}
          </Button>
          <Button size="sm" onClick={openAdd}>+ Add SKU</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          placeholder="Search by code or name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-xs"
        />
        <Select value={filterContainer} onValueChange={(v) => setFilterContainer(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CONTAINER_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterActive} onValueChange={(v) => setFilterActive(v ?? "all")}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className={`rounded-md border bg-white overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU Code</TableHead>
              <TableHead>SKU Name</TableHead>
              <TableHead>Pack Size</TableHead>
              <TableHead>Container</TableHead>
              <TableHead>Units/Carton</TableHead>
              <TableHead>Weight (kg)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skus.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500 py-8">
                  {loading ? "Loading…" : "No SKUs found."}
                </TableCell>
              </TableRow>
            )}
            {skus.map((sku) => (
              <TableRow key={sku.id}>
                <TableCell className="font-mono text-sm text-slate-700">{sku.skuCode}</TableCell>
                <TableCell className="font-medium">{sku.skuName}</TableCell>
                <TableCell className="text-slate-600">{sku.packSize || "—"}</TableCell>
                <TableCell className="capitalize text-slate-600">{sku.containerType}</TableCell>
                <TableCell className="text-slate-600">
                  {sku.containerType === "drum" ? <span className="text-slate-300">N/A</span> : (sku.unitsPerCarton ?? "—")}
                </TableCell>
                <TableCell className="text-slate-600">{sku.grossWeightPerUnit}</TableCell>
                <TableCell>
                  <Badge variant={sku.isActive ? "default" : "secondary"}>
                    {sku.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(sku)}>
                      Edit
                    </Button>
                    <Link
                      href={`/admin/skus/${sku.id}/sub-skus`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      Sub-SKUs
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">
            Page {page} of {totalPages} · {total} SKUs
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => fetchPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => fetchPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />

      {/* SKU sheet */}
      <SkuSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editing={editingSku}
        onSaved={handleSaved}
      />

      {/* Import result dialog */}
      <Dialog open={!!importResult} onOpenChange={(o) => { if (!o) setImportResult(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Complete</DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="space-y-3 text-sm">
              <div className="flex gap-6">
                <span className="text-green-700 font-medium">{importResult.created} created</span>
                <span className="text-blue-700 font-medium">{importResult.updated} updated</span>
                {importResult.failed.length > 0 && (
                  <span className="text-destructive font-medium">{importResult.failed.length} failed</span>
                )}
              </div>
              {importResult.failed.length > 0 && (
                <div className="max-h-60 overflow-y-auto rounded-md border bg-slate-50 p-3 space-y-1">
                  {importResult.failed.map((f) => (
                    <p key={f.row} className="text-slate-700">
                      <span className="font-medium">Row {f.row}:</span> {f.reason}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setImportResult(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
