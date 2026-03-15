"use client";

import { useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CsvImportModal, parseFile, type CsvColumn } from "@/components/admin/csv-import-modal";
import { Upload, Download } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CategoryOption { id: number; name: string; }

export interface ProductNameRow {
  id:         number;
  name:       string;
  categoryId: number;
  category:   CategoryOption;
  isActive:   boolean;
  _count:     { skus: number };
}

interface Props {
  initialRows: ProductNameRow[];
  categories:  CategoryOption[];
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = { name: "", categoryId: "", isActive: true };

function buildForm(row: ProductNameRow | null): typeof EMPTY_FORM {
  if (!row) return EMPTY_FORM;
  return { name: row.name, categoryId: row.categoryId.toString(), isActive: row.isActive };
}


const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name",     label: "Name",     required: true },
  { key: "category", label: "Category", required: true },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function ProductNamesTable({ initialRows, categories }: Props) {
  const [rows,          setRows]          = useState<ProductNameRow[]>(initialRows);
  const [sheetOpen,     setSheetOpen]     = useState(false);
  const [editTarget,    setEditTarget]    = useState<ProductNameRow | null>(null);
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [fieldErrors,   setFieldErrors]   = useState<Record<string, string>>({});
  const [saving,        setSaving]        = useState(false);
  const importFileRef                  = useRef<HTMLInputElement>(null);
  const [importRows,   setImportRows]  = useState<Record<string, string>[]>([]);
  const [importFile,   setImportFile]  = useState("");
  const [importOpen,   setImportOpen]  = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const displayedRows = useMemo(() => {
    if (filterCategory === "all") return rows;
    const catId = parseInt(filterCategory, 10);
    return rows.filter((r) => r.categoryId === catId);
  }, [rows, filterCategory]);

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(row: ProductNameRow) {
    setEditTarget(row);
    setForm(buildForm(row));
    setFieldErrors({});
    setSheetOpen(true);
  }

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim())   errs.name       = "Name is required.";
    if (!form.categoryId)    errs.categoryId = "Category is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = {
        name:       form.name.trim(),
        categoryId: parseInt(form.categoryId, 10),
        isActive:   form.isActive,
      };
      const res = editTarget
        ? await fetch(`/api/admin/product-names/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/product-names", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ name: "A product name with this name already exists." });
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }

      if (editTarget) {
        setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
        toast.success("Product name updated.");
      } else {
        setRows((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(`Product name "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row: ProductNameRow) {
    const newActive = !row.isActive;
    try {
      const res = await fetch(`/api/admin/product-names/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update.");
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === row.id ? data : r)));
      toast.success(newActive ? "Product name activated." : "Product name deactivated.");
    } catch {
      toast.error("Network error.");
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
    const csv = "name,category\nAquatech,Emulsion\nWS,Emulsion";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-product-names.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfirm(validRows: Record<string, string>[]) {
    const res = await fetch("/api/admin/product-names/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: validRows }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Import failed."); return; }
    toast.success(`${data.imported} imported, ${data.skipped} skipped.`);
    setImportOpen(false);
    window.location.reload();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-[#1a237e]">Product Names</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[#1a237e] border border-[#c7d2fe] bg-[#eef2ff] hover:bg-[#e0e7ff] text-xs font-medium px-3 py-2 rounded-md"
            onClick={handleTemplateDownload}
          >
            <Download className="h-3.5 w-3.5" />
            Download Template
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 bg-white hover:bg-[#f7f8fa] text-[#374151] border border-[#e5e7eb] text-xs font-medium px-3 py-2 rounded-md"
            onClick={() => importFileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            Import File
          </button>
          <Button size="sm" onClick={openAdd} className="oa-btn-primary">+ Add Product Name</Button>
        </div>
        <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-3 mb-4">
        <Label className="text-sm text-slate-600 shrink-0">Filter by category:</Label>
        <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v ?? "all")}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filterCategory !== "all" && (
          <Button size="sm" variant="ghost" onClick={() => setFilterCategory("all")} className="oa-btn-ghost">
            Clear
          </Button>
        )}
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-center">SKU Count</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                  {filterCategory !== "all" ? "No product names in this category." : "No product names configured yet."}
                </TableCell>
              </TableRow>
            )}
            {displayedRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-slate-800">{row.name}</TableCell>
                <TableCell className="text-slate-600 text-sm">{row.category.name}</TableCell>
                <TableCell className="text-center text-slate-600 font-mono text-sm">
                  {row._count.skus}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(row)} className="oa-btn-ghost">
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleToggle(row)} className="oa-btn-ghost">
                      {row.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Add / Edit Sheet ──────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? "Edit Product Name" : "Add Product Name"}</SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="e.g. Aquatech, Weathercoat, WS…"
              />
              {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label>Category <span className="text-destructive">*</span></Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => setField("categoryId", v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category…" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.categoryId && <p className="text-xs text-destructive">{fieldErrors.categoryId}</p>}
            </div>

            {/* Is Active */}
            <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-[#e5e7eb] bg-[#f7f8fa]">
              <div>
                <div className="text-sm font-medium text-[#111827]">Active</div>
                <div className="text-xs text-[#6b7280] mt-0.5">Inactive names are hidden from SKU forms</div>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setField("isActive", v)}
                className="data-[state=checked]:bg-[#1a237e] data-[state=unchecked]:bg-[#d1d5db]"
              />
            </div>

            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-[#374151] hover:bg-[#f7f8fa] rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-[#1a237e] hover:bg-[#283593] text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Product Name"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <CsvImportModal
        title="Product Names"
        columns={IMPORT_COLUMNS}
        rows={importRows}
        fileName={importFile}
        validateRow={(row) => {
          if (!row.name?.trim()) return "Name is required";
          const cat = row.category?.trim();
          if (!cat) return "Category is required";
          const exists = categories.some((c) => c.name.toLowerCase() === cat.toLowerCase());
          if (!exists) return `Category "${cat}" not found`;
          if (rows.some((r) => r.name.toLowerCase() === row.name.trim().toLowerCase()))
            return "Already exists — will be skipped";
          return null;
        }}
        onConfirm={handleImportConfirm}
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
      />
    </>
  );
}
