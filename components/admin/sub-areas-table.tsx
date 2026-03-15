"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CsvImportModal, parseFile, type CsvColumn } from "@/components/admin/csv-import-modal";
import { Upload, Download } from "lucide-react";

interface Area { id: number; name: string; }
interface SubAreaRow {
  id: number; name: string; isActive: boolean; createdAt: string;
  area: Area;
}

interface SubAreasTableProps {
  initialSubAreas: SubAreaRow[];
  areas: Area[];
}

const EMPTY = { name: "", areaId: "" };


const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name", label: "Name", required: true },
  { key: "area", label: "Area", required: true },
];

export function SubAreasTable({ initialSubAreas, areas }: SubAreasTableProps) {
  const [subAreas, setSubAreas] = useState<SubAreaRow[]>(initialSubAreas);
  const [filterAreaId, setFilterAreaId] = useState<string>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SubAreaRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const importFileRef                  = useRef<HTMLInputElement>(null);
  const [importRows,   setImportRows]  = useState<Record<string, string>[]>([]);
  const [importFile,   setImportFile]  = useState("");
  const [importOpen,   setImportOpen]  = useState(false);

  const filtered = filterAreaId === "all"
    ? subAreas
    : subAreas.filter((s) => s.area.id === parseInt(filterAreaId, 10));

  function openAdd() {
    setEditTarget(null);
    setForm({ name: "", areaId: areas[0]?.id.toString() ?? "" });
    setSheetOpen(true);
  }

  function openEdit(sub: SubAreaRow) {
    setEditTarget(sub);
    setForm({ name: sub.name, areaId: sub.area.id.toString() });
    setSheetOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.areaId) {
      toast.error("Name and area are required.");
      return;
    }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), areaId: parseInt(form.areaId, 10) };
      const res = editTarget
        ? await fetch(`/api/admin/sub-areas/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/sub-areas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to save."); return; }

      if (editTarget) {
        setSubAreas((prev) => prev.map((s) => (s.id === data.id ? data : s)));
        toast.success("Sub-area updated.");
      } else {
        setSubAreas((prev) => [...prev, data]);
        toast.success(`Sub-area "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch { toast.error("Network error."); } finally { setSaving(false); }
  }

  async function handleToggle(sub: SubAreaRow) {
    setTogglingId(sub.id);
    try {
      const res = await fetch(`/api/admin/sub-areas/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !sub.isActive }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to update."); return; }
      setSubAreas((prev) => prev.map((s) => (s.id === sub.id ? data : s)));
      toast.success(`Sub-area ${data.isActive ? "activated" : "deactivated"}.`);
    } catch { toast.error("Network error."); } finally { setTogglingId(null); }
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
    const csv = "name,area\nVaracha North,Varacha Road\nVaracha South,Varacha Road";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-sub-areas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfirm(validRows: Record<string, string>[]) {
    const res = await fetch("/api/admin/sub-areas/import", {
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
        <h1 className="text-lg font-bold text-[#1a237e]">Sub-areas</h1>
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
          <Button size="sm" className="oa-btn-primary" onClick={openAdd}>+ Add Sub-area</Button>
        </div>
        <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-4">
        <Label className="text-sm text-slate-600 shrink-0">Filter by area:</Label>
        <Select value={filterAreaId} onValueChange={(v) => setFilterAreaId(v ?? "all")}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sub-area Name</TableHead>
              <TableHead>Parent Area</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-500 py-8">No sub-areas found.</TableCell>
              </TableRow>
            )}
            {filtered.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell className="font-medium">{sub.name}</TableCell>
                <TableCell className="text-slate-600">{sub.area.name}</TableCell>
                <TableCell>
                  <Badge variant={sub.isActive ? "default" : "secondary"}>
                    {sub.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" className="oa-btn-ghost" onClick={() => openEdit(sub)}>Edit</Button>
                    <Button
                      size="sm" variant="outline"
                      className="oa-btn-ghost"
                      disabled={togglingId === sub.id}
                      onClick={() => handleToggle(sub)}
                    >
                      {sub.isActive ? "Deactivate" : "Activate"}
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
            <SheetTitle>{editTarget ? "Edit Sub-area" : "Add Sub-area"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            <div className="space-y-1.5">
              <Label htmlFor="sa-name">Sub-area Name</Label>
              <Input id="sa-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Parent Area</Label>
              <Select value={form.areaId} onValueChange={(v) => setForm((p) => ({ ...p, areaId: v ?? "" }))}>
                <SelectTrigger><SelectValue placeholder="Select area" /></SelectTrigger>
                <SelectContent>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-[#374151] hover:bg-[#f7f8fa] rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-[#1a237e] hover:bg-[#283593] text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <CsvImportModal
        title="Sub-areas"
        columns={IMPORT_COLUMNS}
        rows={importRows}
        fileName={importFile}
        validateRow={(row) => {
          if (!row.name?.trim()) return "Name is required";
          const areaName = row.area?.trim();
          if (!areaName) return "Area is required";
          const areaExists = areas.some((a) => a.name.toLowerCase() === areaName.toLowerCase());
          if (!areaExists) return `Area "${areaName}" not found`;
          if (subAreas.some(
            (s) => s.name.toLowerCase() === row.name.trim().toLowerCase() &&
                   s.area.name.toLowerCase() === areaName.toLowerCase()
          )) return "Already exists — will be skipped";
          return null;
        }}
        onConfirm={handleImportConfirm}
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
      />
    </>
  );
}
