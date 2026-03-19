"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CustomerSheet,
  type AreaOption, type SubAreaOption, type SalesOfficerOption,
  type RouteOption, type DeliveryTypeOption, type SOGroupOption, type ContactRoleOption,
  type CustomerFull,
} from "./customer-sheet";

// ── Types ──────────────────────────────────────────────────────────────────────
interface CustomerRow {
  id:                 number;
  customerCode:       string;
  customerName:       string;
  area:               { id: number; name: string };
  subArea:            { id: number; name: string } | null;
  salesOfficerGroup:  { id: number; name: string } | null;
  customerRating:     string | null;
  isKeyCustomer:      boolean;
  isKeySite:          boolean;
  isActive:           boolean;
}

const RATING_BADGE: Record<string, string> = {
  A: "bg-green-100 text-green-800 border border-green-200",
  B: "bg-amber-100 text-amber-800 border border-amber-200",
  C: "bg-red-100   text-red-800   border border-red-200",
};

interface ImportResult {
  created: number;
  updated: number;
  failed: { row: number; reason: string }[];
}

interface CustomersTableProps {
  initialCustomers: CustomerRow[];
  initialTotal:     number;
  areas:            AreaOption[];
  subAreas:         SubAreaOption[];
  salesOfficers:    SalesOfficerOption[];
  routes:           RouteOption[];
  deliveryTypes:    DeliveryTypeOption[];
  soGroups:         SOGroupOption[];
  contactRoles:     ContactRoleOption[];
  canEdit?:         boolean;
  canImport?:       boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CustomersTable({ initialCustomers, initialTotal, areas, subAreas, salesOfficers, routes, deliveryTypes, soGroups, contactRoles, canEdit = true, canImport = true }: CustomersTableProps) {
  const [customers, setCustomers] = useState<CustomerRow[]>(initialCustomers);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(Math.ceil(initialTotal / 25));
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterArea, setFilterArea] = useState("");
  const [filterKeyCustomer, setFilterKeyCustomer] = useState(false);
  const [filterActive, setFilterActive] = useState("all"); // "all" | "active" | "inactive"

  // Sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<CustomerFull | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  // CSV import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Skip fetch on mount (server-rendered initial data)
  const isFirstRender = useRef(true);

  // ── Debounce search ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Refetch on filter change (skip first render) ───────────────────────────
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, filterArea, filterKeyCustomer, filterActive]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  function buildParams(pageNum: number) {
    const p = new URLSearchParams({ page: pageNum.toString() });
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (filterArea) p.set("areaId", filterArea);
    if (filterKeyCustomer) p.set("isKeyCustomer", "true");
    if (filterActive !== "all") p.set("isActive", filterActive === "active" ? "true" : "false");
    return p;
  }

  async function fetchPage(pageNum: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/customers?${buildParams(pageNum)}`);
      if (!res.ok) { toast.error("Failed to load customers."); return; }
      const data = await res.json();
      setCustomers(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setPage(pageNum);
    } catch {
      toast.error("Network error.");
    } finally {
      setLoading(false);
    }
  }

  // ── Open edit sheet: fetch full customer ───────────────────────────────────
  async function openEdit(id: number) {
    setEditingId(id);
    setLoadingEdit(true);
    setSheetOpen(true);
    try {
      const res = await fetch(`/api/admin/customers/${id}`);
      if (!res.ok) { toast.error("Failed to load customer."); setSheetOpen(false); return; }
      setEditingCustomer(await res.json());
    } catch {
      toast.error("Network error.");
      setSheetOpen(false);
    } finally {
      setLoadingEdit(false);
    }
  }

  function openAdd() {
    setEditingId(null);
    setEditingCustomer(null);
    setSheetOpen(true);
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) { setEditingId(null); setEditingCustomer(null); }
  }

  // ── After save: re-fetch current page to get full area/subArea names ─────
  function handleSaved(_saved: CustomerFull) {
    fetchPage(page);
  }

  // ── CSV import ─────────────────────────────────────────────────────────────
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset input

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/customers/import", { method: "POST", body: formData });
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

  function handleTemplateDownload() {
    const csv = [
      "customerCode,customerName,area,subArea,primaryRoute,deliveryTypeOverride,salesOfficerGroup,customerRating,latitude,longitude,workingHoursStart,workingHoursEnd,isKeyCustomer,isKeySite,acceptsPartialDelivery",
      "C001,Ambika Paints,Varacha Road,Varacha North,Varacha,Local,Varacha North Portfolio,A,21.1702,72.8311,09:00,18:00,false,false,true",
      "C002,Mahadev Traders,Adajan,,,,Surat City Central,B,21.1950,72.8050,08:00,17:00,false,false,false",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-[#1a237e]">
          Customers
          {total > 0 && <span className="ml-2 text-sm font-normal text-slate-400">{total} total</span>}
        </h1>
        <div className="flex gap-2">
          {canImport && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-medium text-[#1a237e] border border-[#c7d2fe] bg-[#eef2ff] hover:bg-[#e0e7ff] px-3 py-2 rounded-md"
              onClick={handleTemplateDownload}
            >
              <Download className="h-3.5 w-3.5" />
              Download Template
            </button>
          )}
          {canImport && (
            <Button size="sm" variant="outline" className="oa-btn-ghost" disabled={importing} onClick={() => fileInputRef.current?.click()}>
              {importing ? "Importing…" : "Import CSV"}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" className="oa-btn-primary" onClick={openAdd}>+ Add Customer</Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          placeholder="Search by name or code…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-xs"
        />
        <Select value={filterArea} onValueChange={(v) => setFilterArea(!v || v === "all" ? "" : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Checkbox
            checked={filterKeyCustomer}
            onCheckedChange={(v) => setFilterKeyCustomer(Boolean(v))}
          />
          Key customers only
        </label>
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
      <div className={`oa-table transition-opacity ${loading ? "opacity-60" : ""}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Customer Name</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Sub-area</TableHead>
              <TableHead>SO Group</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Key Customer</TableHead>
              <TableHead>Key Site</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-slate-500 py-8">
                  {loading ? "Loading…" : "No customers found."}
                </TableCell>
              </TableRow>
            )}
            {customers.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-sm text-slate-600">{c.customerCode}</TableCell>
                <TableCell className="font-medium">{c.customerName}</TableCell>
                <TableCell className="text-slate-600">{c.area?.name ?? "—"}</TableCell>
                <TableCell className="text-slate-500">{c.subArea?.name ?? "—"}</TableCell>
                <TableCell className="text-slate-600 text-sm">
                  {c.salesOfficerGroup?.name ?? <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell>
                  {c.customerRating ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${RATING_BADGE[c.customerRating]}`}>
                      {c.customerRating}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {c.isKeyCustomer ? (
                    <Badge variant="default" className="bg-amber-500 hover:bg-amber-500">Key</Badge>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {c.isKeySite ? (
                    <Badge variant="default" className="bg-blue-500 hover:bg-blue-500">Key</Badge>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={c.isActive ? "default" : "secondary"}>
                    {c.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="oa-btn-ghost"
                      disabled={loadingEdit && editingId === c.id}
                      onClick={() => openEdit(c.id)}
                    >
                      {loadingEdit && editingId === c.id ? "Loading…" : "Edit"}
                    </Button>
                  )}
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
            Page {page} of {totalPages} · {total} customers
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="oa-btn-ghost"
              disabled={page <= 1 || loading}
              onClick={() => fetchPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="oa-btn-ghost"
              disabled={page >= totalPages || loading}
              onClick={() => fetchPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Hidden file input for CSV */}
      {canImport && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileSelect}
        />
      )}

      {/* Customer sheet */}
      <CustomerSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        editing={editingCustomer}
        areas={areas}
        subAreas={subAreas}
        salesOfficers={salesOfficers}
        routes={routes}
        deliveryTypes={deliveryTypes}
        soGroups={soGroups}
        contactRoles={contactRoles}
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
                <Button size="sm" className="oa-btn-primary" onClick={() => setImportResult(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
