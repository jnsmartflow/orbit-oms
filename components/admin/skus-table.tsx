"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download } from "lucide-react";
import { SkuSheet, type SkuRow, CONTAINER_TYPES } from "./sku-sheet";
import { CsvImportModal, parseFile, type CsvColumn } from "@/components/admin/csv-import-modal";

// ── Types ──────────────────────────────────────────────────────────────────────

interface NameOption { id: number; name: string; }

interface SkusTableProps {
  initialSkus:   SkuRow[];
  initialTotal:  number;
  categories:    NameOption[];
  productNames:  NameOption[];
  baseColours:   NameOption[];
  canEdit?:      boolean;
  canImport?:    boolean;
}


const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "skucode",        label: "SKU Code",         required: true  },
  { key: "skuname",        label: "SKU Name",         required: true  },
  { key: "category",       label: "Category",         required: true  },
  { key: "productname",    label: "Product Name",     required: true  },
  { key: "basecolour",     label: "Base Colour",      required: true  },
  { key: "packsize",       label: "Pack Size",        required: true  },
  { key: "containertype",  label: "Container Type",   required: true  },
  { key: "unitspercarton", label: "Units / Carton",   required: false },
];

const VALID_CONTAINER_TYPES = new Set(["tin", "drum", "carton", "bag"]);

// ── Component ──────────────────────────────────────────────────────────────────

export function SkusTable({ initialSkus, initialTotal, categories, productNames, baseColours, canEdit = true, canImport = true }: SkusTableProps) {
  const [skus,       setSkus]       = useState<SkuRow[]>(initialSkus);
  const [total,      setTotal]      = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(Math.ceil(initialTotal / 25));
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(false);

  // Filters
  const [searchInput,     setSearchInput]     = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCategory,  setFilterCategory]  = useState("all");
  const [filterContainer, setFilterContainer] = useState("all");
  const [filterActive,    setFilterActive]    = useState("all");

  // Sheet
  const [sheetOpen,  setSheetOpen]  = useState(false);
  const [editingSku, setEditingSku] = useState<SkuRow | null>(null);

  // CSV import
  const importFileRef                  = useRef<HTMLInputElement>(null);
  const [importRows,   setImportRows]  = useState<Record<string, string>[]>([]);
  const [importFile,   setImportFile]  = useState("");
  const [importOpen,   setImportOpen]  = useState(false);

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
  }, [debouncedSearch, filterCategory, filterContainer, filterActive]);

  function buildParams(pageNum: number) {
    const p = new URLSearchParams({ page: pageNum.toString() });
    if (debouncedSearch)           p.set("search",        debouncedSearch);
    if (filterCategory !== "all")  p.set("categoryId",    filterCategory);
    if (filterContainer !== "all") p.set("containerType", filterContainer);
    if (filterActive !== "all")    p.set("isActive",      filterActive === "active" ? "true" : "false");
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

  function openAdd()             { setEditingSku(null); setSheetOpen(true); }
  function openEdit(sku: SkuRow) { setEditingSku(sku);  setSheetOpen(true); }

  function handleSaved(saved: SkuRow) {
    if (editingSku) {
      setSkus((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    } else {
      fetchPage(1);
    }
  }

  async function handleImportFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const rows = await parseFile(file);
      setImportRows(rows);
      setImportFile(file.name);
      setImportOpen(true);
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to parse file.");
    }
  }

  function handleTemplateDownload() {
    const csv = "code,name,category,productname,basecolour,size,containertype,unitspercarton\nWS-WHT-20L,WS White 20L,Emulsion,WS,White Base,20L,Bucket,24\nWS-DEP-20L,WS Deep 20L,Emulsion,WS,Deep Base,20L,Bucket,24";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-skus.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfirm(validRows: Record<string, string>[]) {
    const res = await fetch("/api/admin/skus/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: validRows }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Import failed."); return; }
    toast.success(`${data.imported} imported, ${data.skipped} skipped.`);
    setImportOpen(false);
    fetchPage(1);
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-teal-700">
          SKUs
          {total > 0 && <span className="ml-2 text-sm font-normal text-gray-400">{total} total</span>}
        </h1>
        <div className="flex gap-2">
          {canImport && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 text-xs font-medium px-3 py-2 rounded-md"
              onClick={handleTemplateDownload}
            >
              <Download className="h-3.5 w-3.5" />
              Download Template
            </button>
          )}
          {canImport && (
            <button
              type="button"
              className="flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-[#e5e7eb] text-xs font-medium px-3 py-2 rounded-md"
              onClick={() => importFileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Import File
            </button>
          )}
          {canEdit && (
            <Button size="sm" className="oa-btn-primary" onClick={openAdd}>+ Add SKU</Button>
          )}
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
        <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v ?? "all")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      <div className={`oa-table transition-opacity ${loading ? "opacity-60" : ""}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU Code</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Base Colour</TableHead>
              <TableHead>Pack Size</TableHead>
              <TableHead>Container</TableHead>
              <TableHead>Units/Carton</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skus.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                  {loading ? "Loading…" : "No SKUs found."}
                </TableCell>
              </TableRow>
            )}
            {skus.map((sku) => (
              <TableRow key={sku.id}>
                <TableCell className="font-mono text-sm text-gray-700">{sku.skuCode}</TableCell>
                <TableCell className="font-medium">{sku.productName.name}</TableCell>
                <TableCell className="text-gray-600 text-sm">{sku.productCategory.name}</TableCell>
                <TableCell className="text-gray-600 text-sm">{sku.baseColour.name}</TableCell>
                <TableCell className="text-gray-600">{sku.packSize || "—"}</TableCell>
                <TableCell className="capitalize text-gray-600">{sku.containerType}</TableCell>
                <TableCell className="text-gray-600">
                  {sku.containerType === "drum" ? <span className="text-gray-300">N/A</span> : (sku.unitsPerCarton ?? "—")}
                </TableCell>
                <TableCell>
                  <Badge variant={sku.isActive ? "default" : "secondary"}>
                    {sku.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {canEdit && (
                      <Button size="sm" variant="outline" className="oa-btn-ghost" onClick={() => openEdit(sku)}>
                        Edit
                      </Button>
                    )}
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
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages} · {total} SKUs
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="oa-btn-ghost" disabled={page <= 1 || loading} onClick={() => fetchPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" className="oa-btn-ghost" disabled={page >= totalPages || loading} onClick={() => fetchPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />

      {/* SKU sheet */}
      <SkuSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editing={editingSku}
        onSaved={handleSaved}
      />

      {/* CSV import modal */}
      <CsvImportModal
        title="SKUs"
        columns={IMPORT_COLUMNS}
        rows={importRows}
        fileName={importFile}
        validateRow={(row) => {
          if (!row.skucode?.trim())    return "skuCode is required";
          if (!row.skuname?.trim())    return "skuName is required";
          if (!row.packsize?.trim())   return "packSize is required";
          const ct = row.containertype?.trim().toLowerCase();
          if (ct && !VALID_CONTAINER_TYPES.has(ct)) return `Invalid containerType "${ct}"`;
          const cat = row.category?.trim();
          if (!cat) return "category is required";
          if (!categories.some((c) => c.name.toLowerCase() === cat.toLowerCase()))
            return `Category "${cat}" not found`;
          const pn = row.productname?.trim();
          if (!pn) return "productName is required";
          if (!productNames.some((n) => n.name.toLowerCase() === pn.toLowerCase()))
            return `Product name "${pn}" not found`;
          const bc = row.basecolour?.trim();
          if (!bc) return "baseColour is required";
          if (!baseColours.some((b) => b.name.toLowerCase() === bc.toLowerCase()))
            return `Base colour "${bc}" not found`;
          return null;
        }}
        onConfirm={handleImportConfirm}
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
      />
    </>
  );
}
