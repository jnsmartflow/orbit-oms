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

export interface TransporterRow {
  id:            number;
  name:          string;
  contactPerson: string | null;
  phone:         string | null;
  email:         string | null;
  isActive:      boolean;
  _count:        { vehicles: number };
}

interface Props {
  initialRows: TransporterRow[];
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name:          "",
  contactPerson: "",
  phone:         "",
  email:         "",
  isActive:      true,
};

function buildForm(row: TransporterRow | null): typeof EMPTY_FORM {
  if (!row) return EMPTY_FORM;
  return {
    name:          row.name,
    contactPerson: row.contactPerson ?? "",
    phone:         row.phone         ?? "",
    email:         row.email         ?? "",
    isActive:      row.isActive,
  };
}

const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name",          label: "Name",           required: true  },
  { key: "contactperson", label: "Contact Person",  required: false },
  { key: "phone",         label: "Phone",           required: false },
  { key: "email",         label: "Email",           required: false },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function TransportersTable({ initialRows }: Props) {
  const [rows,        setRows]        = useState<TransporterRow[]>(initialRows);
  const [sheetOpen,   setSheetOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<TransporterRow | null>(null);
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

  function openEdit(row: TransporterRow) {
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
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errs.email = "Invalid email format.";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = {
        name:          form.name.trim(),
        contactPerson: form.contactPerson.trim() || null,
        phone:         form.phone.trim()         || null,
        email:         form.email.trim()         || null,
        isActive:      form.isActive,
      };
      const res = editTarget
        ? await fetch(`/api/admin/transporters/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/transporters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ name: "A transporter with this name already exists." });
        } else if (res.status === 422) {
          toast.error(data.error ?? "Cannot perform this action.");
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }

      if (editTarget) {
        setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
        toast.success("Transporter updated.");
      } else {
        setRows((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(`Transporter "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row: TransporterRow) {
    const newActive = !row.isActive;
    try {
      const res = await fetch(`/api/admin/transporters/${row.id}`, {
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
      toast.success(newActive ? "Transporter activated." : "Transporter deactivated.");
    } catch {
      toast.error("Network error.");
    }
  }

  function handleTemplateDownload() {
    const csv = "name,contactperson,phone,email\nSharma Logistics,Raj Sharma,9898989898,raj@sharma.com\nPatel Transport,Suresh Patel,9797979797,suresh@patel.com";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-transporters.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const parsed = await parseFile(file);
      setImportRows(parsed);
      setImportFile(file.name);
      setImportOpen(true);
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to parse file.");
    }
  }

  async function handleImportConfirm(validRows: Record<string, string>[]) {
    const res = await fetch("/api/admin/transporters/import", {
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
        <h1 className="text-lg font-bold text-teal-700">Transporters</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 px-3 py-2 rounded-md"
            onClick={handleTemplateDownload}
          >
            <Download className="h-3.5 w-3.5" />
            Download Template
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium bg-white hover:bg-gray-50 text-gray-700 border border-[#e5e7eb] px-3 py-2 rounded-md"
            onClick={() => importFileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            Import File
          </button>
          <Button size="sm" onClick={openAdd} className="oa-btn-primary">+ Add Transporter</Button>
        </div>
        <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-center">Vehicles</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-500 py-8">
                  No transporters configured yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-gray-800">{row.name}</TableCell>
                <TableCell className="text-gray-600 text-sm">{row.contactPerson ?? <span className="text-gray-300">—</span>}</TableCell>
                <TableCell className="text-gray-600 text-sm font-mono">{row.phone ?? <span className="text-gray-300">—</span>}</TableCell>
                <TableCell className="text-gray-600 text-sm">{row.email ?? <span className="text-gray-300">—</span>}</TableCell>
                <TableCell className="text-center text-gray-600 font-mono text-sm">
                  {row._count.vehicles}
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
            <SheetTitle>{editTarget ? "Edit Transporter" : "Add Transporter"}</SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="e.g. Surat Express Logistics"
              />
              {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
            </div>

            {/* Contact Person */}
            <div className="space-y-1.5">
              <Label>
                Contact Person
                <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
              </Label>
              <Input
                value={form.contactPerson}
                onChange={(e) => setField("contactPerson", e.target.value)}
                placeholder="e.g. Ramesh Patel"
              />
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <Label>
                Phone
                <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
              </Label>
              <Input
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="e.g. 9876543210"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label>
                Email
                <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
              </Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                placeholder="e.g. contact@transporter.com"
              />
              {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
            </div>

            {/* Is Active */}
            <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-[#e5e7eb] bg-gray-50">
              <div>
                <div className="text-sm font-medium text-gray-900">Active</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Cannot deactivate while active vehicles are assigned
                </div>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setField("isActive", v)}
                className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-gray-300"
              />
            </div>

            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-gray-700 hover:bg-gray-50 rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Transporter"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <CsvImportModal
        title="Transporters"
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
