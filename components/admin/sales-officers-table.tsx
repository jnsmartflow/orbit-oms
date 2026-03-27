"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CsvImportModal, parseFile, type CsvColumn } from "@/components/admin/csv-import-modal";
import { Upload, Download } from "lucide-react";

interface OfficerRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

interface SalesOfficersTableProps {
  initialOfficers: OfficerRow[];
}

const EMPTY = { name: "", email: "", phone: "" };

const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name",  label: "Name",  required: true  },
  { key: "email", label: "Email", required: true  },
  { key: "phone", label: "Phone", required: false },
];

export function SalesOfficersTable({ initialOfficers }: SalesOfficersTableProps) {
  const [officers, setOfficers] = useState<OfficerRow[]>(initialOfficers);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<OfficerRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const importFileRef               = useRef<HTMLInputElement>(null);
  const [importRows,  setImportRows] = useState<Record<string, string>[]>([]);
  const [importFile,  setImportFile] = useState("");
  const [importOpen,  setImportOpen] = useState(false);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(officer: OfficerRow) {
    setEditing(officer);
    setForm({
      name: officer.name,
      email: officer.email ?? "",
      phone: officer.phone ?? "",
    });
    setFieldErrors({});
    setSheetOpen(true);
  }

  function setField(key: keyof typeof EMPTY, value: string) {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      };
      const res = editing
        ? await fetch(`/api/admin/sales-officers/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/sales-officers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ email: "Email already exists." });
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }

      if (editing) {
        setOfficers((prev) => prev.map((o) => (o.id === data.id ? data : o)));
        toast.success("Sales officer updated.");
      } else {
        setOfficers((prev) => [...prev, data]);
        toast.success(`Sales officer "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(officer: OfficerRow) {
    setTogglingId(officer.id);
    try {
      const res = await fetch(`/api/admin/sales-officers/${officer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !officer.isActive }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to update."); return; }
      setOfficers((prev) => prev.map((o) => (o.id === officer.id ? data : o)));
      toast.success(`${data.name} ${data.isActive ? "activated" : "deactivated"}.`);
    } catch {
      toast.error("Network error.");
    } finally {
      setTogglingId(null);
    }
  }

  function handleTemplateDownload() {
    const csv = "name,email,phone\nAmit Shah,amit.shah@company.com,9898989898\nKavita Mehta,kavita.mehta@company.com,9797979797";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-sales-officers.csv";
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
    const res = await fetch("/api/admin/sales-officers/import", {
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
        <h1 className="text-lg font-bold text-[#1a237e]">Sales Officers</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-[#1a237e] border border-[#c7d2fe] bg-[#eef2ff] hover:bg-[#e0e7ff] px-3 py-2 rounded-md"
            onClick={handleTemplateDownload}
          >
            <Download className="h-3.5 w-3.5" />
            Download Template
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium bg-white hover:bg-[#f7f8fa] text-[#374151] border border-[#e5e7eb] px-3 py-2 rounded-md"
            onClick={() => importFileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            Import File
          </button>
          <Button size="sm" className="oa-btn-primary" onClick={openAdd}>+ Add Sales Officer</Button>
        </div>
        <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {officers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                  No sales officers yet.
                </TableCell>
              </TableRow>
            )}
            {officers.map((officer) => (
              <TableRow key={officer.id}>
                <TableCell className="font-medium">{officer.name}</TableCell>
                <TableCell className="text-slate-600">
                  {officer.email ?? <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell className="text-slate-500">
                  {officer.phone ?? <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={officer.isActive ? "default" : "secondary"}>
                    {officer.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" className="oa-btn-ghost" onClick={() => openEdit(officer)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="oa-btn-ghost"
                      disabled={togglingId === officer.id}
                      onClick={() => handleToggle(officer)}
                    >
                      {officer.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit Sales Officer" : "Add Sales Officer"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            <div className="space-y-1.5">
              <Label htmlFor="so-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="so-name"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
              {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-email">Email</Label>
              <Input
                id="so-email"
                type="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                placeholder="Optional"
              />
              {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-phone">Phone</Label>
              <Input
                id="so-phone"
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-[#374151] hover:bg-[#f7f8fa] rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-[#1a237e] hover:bg-[#283593] text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <CsvImportModal
        title="Sales Officers"
        columns={IMPORT_COLUMNS}
        rows={importRows}
        fileName={importFile}
        validateRow={(row) => {
          if (!row.name?.trim()) return "Name is required";
          if (!row.email?.trim()) return "Email is required";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()))
            return "Invalid email format";
          if (officers.some((o) => o.email?.toLowerCase() === row.email.trim().toLowerCase()))
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
