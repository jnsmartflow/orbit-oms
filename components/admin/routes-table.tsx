"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CsvImportModal, parseFile, type CsvColumn } from "@/components/admin/csv-import-modal";
import { StatusBadge } from "@/components/shared/status-badge";
import { Upload, Download } from "lucide-react";

interface RouteRow {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
  areaCount: number;
}

interface RoutesTableProps {
  initialRoutes: RouteRow[];
  canEdit?:      boolean;
  canImport?:    boolean;
}

const EMPTY_FORM = { name: "", description: "" };

const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name",        label: "Name",        required: true  },
  { key: "description", label: "Description", required: false },
];

export function RoutesTable({ initialRoutes, canEdit = true, canImport = true }: RoutesTableProps) {
  const [routes, setRoutes] = useState<RouteRow[]>(initialRoutes);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RouteRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const importFileRef                  = useRef<HTMLInputElement>(null);
  const [importRows,   setImportRows]  = useState<Record<string, string>[]>([]);
  const [importFile,   setImportFile]  = useState("");
  const [importOpen,   setImportOpen]  = useState(false);

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setSheetOpen(true);
  }

  function openEdit(route: RouteRow) {
    setEditTarget(route);
    setForm({ name: route.name, description: route.description ?? "" });
    setSheetOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Route name is required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
      };

      const res = editTarget
        ? await fetch(`/api/admin/routes/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/routes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to save route."); return; }

      if (editTarget) {
        setRoutes((prev) => prev.map((r) => (r.id === data.id ? data : r)));
        toast.success("Route updated.");
      } else {
        setRoutes((prev) => [...prev, data]);
        toast.success(`Route "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch { toast.error("Network error."); } finally { setSaving(false); }
  }

  async function handleToggle(route: RouteRow) {
    setTogglingId(route.id);
    try {
      const res = await fetch(`/api/admin/routes/${route.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !route.isActive }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to update."); return; }
      setRoutes((prev) => prev.map((r) => (r.id === route.id ? data : r)));
      toast.success(`Route ${data.isActive ? "activated" : "deactivated"}.`);
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
    const csv = "name,description\nVaracha,Varacha Road route\nBharuch,Bharuch highway";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-routes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfirm(validRows: Record<string, string>[]) {
    const res = await fetch("/api/admin/routes/import", {
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

  const total = routes.length;
  const activeCount = routes.filter((x) => x.isActive).length;

  return (
    <>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[18px] font-extrabold text-gray-900 tracking-tight">Routes</h1>
          <p className="text-[12px] text-gray-400 mt-0.5">{total} total · {activeCount} active</p>
        </div>
        <div className="flex gap-2">
          {canImport && (
            <button
              type="button"
              className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 text-[12.5px] font-medium px-3 py-2 rounded-lg hover:bg-gray-50"
              onClick={handleTemplateDownload}
            >
              <Download className="h-3.5 w-3.5" />
              Download Template
            </button>
          )}
          {canImport && (
            <button
              type="button"
              className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 text-[12.5px] font-medium px-3 py-2 rounded-lg hover:bg-gray-50"
              onClick={() => importFileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Import File
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="bg-teal-600 hover:bg-teal-700 text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
              onClick={openAdd}
            >
              + Add Route
            </button>
          )}
        </div>
        <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Route Name</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Description</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Areas</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Status</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-right border-b border-gray-200">Actions</th>
            </tr>
          </thead>
          <tbody>
            {routes.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-8 text-[12.5px]">No routes yet.</td>
              </tr>
            )}
            {routes.map((route) => (
              <tr key={route.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors last:border-0">
                <td className="py-3 px-4 text-[12.5px] text-gray-900 font-semibold">{route.name}</td>
                <td className="py-3 px-4 text-[12.5px] text-gray-700">
                  {route.description ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="py-3 px-4 text-[12.5px] text-gray-700">{route.areaCount}</td>
                <td className="py-3 px-4 text-[12.5px] text-gray-700">
                  <StatusBadge variant={route.isActive ? "active" : "inactive"} />
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {canEdit && (
                      <button
                        type="button"
                        className="text-[11.5px] font-medium text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 hover:text-teal-700 hover:border-teal-200 px-3 py-1.5 rounded-lg transition-colors"
                        onClick={() => openEdit(route)}
                      >
                        Edit →
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        className="text-[11.5px] font-medium text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                        disabled={togglingId === route.id}
                        onClick={() => handleToggle(route)}
                      >
                        {route.isActive ? "Deactivate" : "Activate"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? "Edit Route" : "Add Route"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            <div className="space-y-1.5">
              <Label htmlFor="rt-name">Route Name <span className="text-destructive">*</span></Label>
              <Input
                id="rt-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Varacha"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-desc">Description</Label>
              <textarea
                id="rt-desc"
                value={form.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="Optional description"
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-gray-700 hover:bg-gray-50 rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Route"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <CsvImportModal
        title="Routes"
        columns={IMPORT_COLUMNS}
        rows={importRows}
        fileName={importFile}
        validateRow={(row) => {
          if (!row.name?.trim()) return "Name is required";
          if (routes.some((r) => r.name.toLowerCase() === row.name.trim().toLowerCase()))
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
