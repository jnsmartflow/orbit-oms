"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CsvImportModal, parseFile, type CsvColumn } from "@/components/admin/csv-import-modal";
import { Upload, Download } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProductCategoryRow {
  id:       number;
  name:     string;
  isActive: boolean;
  _count:   { skus: number };
}

interface Props {
  initialRows: ProductCategoryRow[];
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = { name: "", isActive: true };

function buildForm(row: ProductCategoryRow | null): typeof EMPTY_FORM {
  if (!row) return EMPTY_FORM;
  return { name: row.name, isActive: row.isActive };
}


const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name", label: "Name", required: true },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function ProductCategoriesTable({ initialRows }: Props) {
  const [rows,        setRows]        = useState<ProductCategoryRow[]>(initialRows);
  const [sheetOpen,   setSheetOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<ProductCategoryRow | null>(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving,      setSaving]      = useState(false);
  const importFileRef                  = useRef<HTMLInputElement>(null);
  const [importRows,   setImportRows]  = useState<Record<string, string>[]>([]);
  const [importFile,   setImportFile]  = useState("");
  const [importOpen,   setImportOpen]  = useState(false);

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(row: ProductCategoryRow) {
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
    if (!form.name.trim()) errs.name = "Name is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), isActive: form.isActive };
      const res = editTarget
        ? await fetch(`/api/admin/product-categories/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/product-categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ name: "A category with this name already exists." });
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }

      if (editTarget) {
        setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
        toast.success("Category updated.");
      } else {
        setRows((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(`Category "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row: ProductCategoryRow) {
    const newActive = !row.isActive;
    try {
      const res = await fetch(`/api/admin/product-categories/${row.id}`, {
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
      toast.success(newActive ? "Category activated." : "Category deactivated.");
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
    const csv = "name\nEmulsion\nPrimer";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-product-categories.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfirm(validRows: Record<string, string>[]) {
    const res = await fetch("/api/admin/product-categories/import", {
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
        <h1 className="text-lg font-bold text-[#1a237e]">Product Categories</h1>
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
          <Button size="sm" onClick={openAdd} className="oa-btn-primary">+ Add Category</Button>
        </div>
        <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-center">SKU Count</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                  No categories configured yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-slate-800">{row.name}</TableCell>
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
            <SheetTitle>{editTarget ? "Edit Category" : "Add Category"}</SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="e.g. Emulsion, Primer, Tinter…"
              />
              {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
            </div>

            {/* Is Active */}
            <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-[#e5e7eb] bg-[#f7f8fa]">
              <div>
                <div className="text-sm font-medium text-[#111827]">Active</div>
                <div className="text-xs text-[#6b7280] mt-0.5">Inactive categories are hidden from SKU forms</div>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setField("isActive", v)}
                className="data-[state=checked]:bg-[#1a237e] data-[state=unchecked]:bg-[#d1d5db]"
              />
            </div>

            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-[#374151] hover:bg-[#f7f8fa] rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-[#1a237e] hover:bg-[#283593] text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Category"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <CsvImportModal
        title="Product Categories"
        columns={IMPORT_COLUMNS}
        rows={importRows}
        fileName={importFile}
        validateRow={(row) => {
          if (!row.name?.trim()) return "Name is required";
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
