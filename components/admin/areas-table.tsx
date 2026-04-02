"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CsvImportModal, parseFile, type CsvColumn } from "@/components/admin/csv-import-modal";
import { StatusBadge } from "@/components/shared/status-badge";
import { Upload, Download } from "lucide-react";

interface DeliveryType { id: number; name: string; }
interface Route { id: number; name: string; }
interface AreaRow {
  id: number; name: string; isActive: boolean; createdAt: string;
  deliveryType:  DeliveryType;
  primaryRoute:  Route | null;
  routes:        Route[];
  subAreaCount:  number;
}

interface AreasTableProps {
  initialAreas: AreaRow[];
  deliveryTypes: DeliveryType[];
  routes: Route[];
}

const EMPTY_FORM = { name: "", deliveryTypeId: "", primaryRouteId: "", routeId: "" };

const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name",         label: "Name",          required: true  },
  { key: "deliverytype", label: "Delivery Type",  required: true  },
  { key: "primaryroute", label: "Primary Route",  required: false },
];

export function AreasTable({ initialAreas, deliveryTypes, routes }: AreasTableProps) {
  const [areas, setAreas] = useState<AreaRow[]>(initialAreas);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AreaRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const importFileRef                  = useRef<HTMLInputElement>(null);
  const [importRows,   setImportRows]  = useState<Record<string, string>[]>([]);
  const [importFile,   setImportFile]  = useState("");
  const [importOpen,   setImportOpen]  = useState(false);

  function openAdd() {
    setEditTarget(null);
    setForm({ name: "", deliveryTypeId: deliveryTypes[0]?.id.toString() ?? "", primaryRouteId: "", routeId: "" });
    setSheetOpen(true);
  }

  function openEdit(area: AreaRow) {
    setEditTarget(area);
    setForm({
      name:           area.name,
      deliveryTypeId: area.deliveryType.id.toString(),
      primaryRouteId: area.primaryRoute?.id.toString() ?? "",
      routeId:        area.routes[0]?.id.toString() ?? "",
    });
    setSheetOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.deliveryTypeId) {
      toast.error("Name and delivery type are required.");
      return;
    }
    if (!form.routeId) {
      toast.error("A route is required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name:           form.name.trim(),
        deliveryTypeId: parseInt(form.deliveryTypeId, 10),
        primaryRouteId: form.primaryRouteId ? parseInt(form.primaryRouteId, 10) : null,
        routeIds:       form.routeId ? [parseInt(form.routeId, 10)] : [],
      };

      const res = editTarget
        ? await fetch(`/api/admin/areas/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/areas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to save area."); return; }

      if (editTarget) {
        setAreas((prev) => prev.map((a) => (a.id === data.id ? data : a)));
        toast.success("Area updated.");
      } else {
        setAreas((prev) => [...prev, data]);
        toast.success(`Area "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch { toast.error("Network error."); } finally { setSaving(false); }
  }

  async function handleToggle(area: AreaRow) {
    setTogglingId(area.id);
    try {
      const res = await fetch(`/api/admin/areas/${area.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !area.isActive }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to update."); return; }
      setAreas((prev) => prev.map((a) => (a.id === area.id ? data : a)));
      toast.success(`Area ${data.isActive ? "activated" : "deactivated"}.`);
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
    const csv = "name,deliverytype,primaryroute\nVaracha Road,Local,Varacha\nBharuch,Upcountry,Bharuch";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-areas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfirm(validRows: Record<string, string>[]) {
    const res = await fetch("/api/admin/areas/import", {
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

  const total = areas.length;
  const activeCount = areas.filter((x) => x.isActive).length;

  return (
    <>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[18px] font-extrabold text-gray-900 tracking-tight">Areas</h1>
          <p className="text-[12px] text-gray-400 mt-0.5">{total} total · {activeCount} active</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 text-[12.5px] font-medium px-3 py-2 rounded-lg hover:bg-gray-50"
            onClick={handleTemplateDownload}
          >
            <Download className="h-3.5 w-3.5" />
            Download Template
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 text-[12.5px] font-medium px-3 py-2 rounded-lg hover:bg-gray-50"
            onClick={() => importFileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            Import File
          </button>
          <button
            type="button"
            className="bg-teal-600 hover:bg-teal-700 text-white text-[12.5px] font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
            onClick={openAdd}
          >
            + Add Area
          </button>
        </div>
        <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Area Name</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Delivery Type</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Primary Route</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Routes</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-left border-b border-gray-200">Status</th>
              <th className="text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400 py-2.5 px-4 text-right border-b border-gray-200">Actions</th>
            </tr>
          </thead>
          <tbody>
            {areas.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-8 text-[12.5px]">No areas yet.</td>
              </tr>
            )}
            {areas.map((area) => (
              <tr key={area.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors last:border-0">
                <td className="py-3 px-4 text-[12.5px] text-gray-900 font-semibold">{area.name}</td>
                <td className="py-3 px-4 text-[12.5px] text-gray-700">
                  <span className="text-[11px] bg-gray-50 border border-gray-200 text-gray-600 px-2 py-0.5 rounded font-medium">{area.deliveryType.name}</span>
                </td>
                <td className="py-3 px-4 text-[12.5px] text-gray-700">
                  {area.primaryRoute ? area.primaryRoute.name : <span className="text-gray-300">—</span>}
                </td>
                <td className="py-3 px-4 text-[12.5px] text-gray-700">
                  {area.routes.length === 0
                    ? <span className="text-gray-400">—</span>
                    : area.routes.map((r) => r.name).join(", ")}
                </td>
                <td className="py-3 px-4 text-[12.5px] text-gray-700">
                  <StatusBadge variant={area.isActive ? "active" : "inactive"} />
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="text-[11.5px] font-medium text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 hover:text-teal-700 hover:border-teal-200 px-3 py-1.5 rounded-lg transition-colors"
                      onClick={() => openEdit(area)}
                    >
                      Edit →
                    </button>
                    <button
                      type="button"
                      className="text-[11.5px] font-medium text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                      disabled={togglingId === area.id}
                      onClick={() => handleToggle(area)}
                    >
                      {area.isActive ? "Deactivate" : "Activate"}
                    </button>
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
            <SheetTitle>{editTarget ? "Edit Area" : "Add Area"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            <div className="space-y-1.5">
              <Label htmlFor="area-name">Area Name</Label>
              <Input id="area-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Delivery Type</Label>
              <Select
                value={form.deliveryTypeId}
                onValueChange={(v) => setForm((p) => ({ ...p, deliveryTypeId: v ?? "" }))}
              >
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {deliveryTypes.map((dt) => (
                    <SelectItem key={dt.id} value={dt.id.toString()}>{dt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Primary Route</Label>
              <Select
                value={form.primaryRouteId}
                onValueChange={(v) => setForm((p) => ({ ...p, primaryRouteId: v ?? "" }))}
              >
                <SelectTrigger><SelectValue placeholder="Select primary route…" /></SelectTrigger>
                <SelectContent>
                  {routes.map((r) => (
                    <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">
                The default route for this area. Used for dispatch planning and customer inheritance.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Route <span className="text-destructive">*</span></Label>
              <Select
                value={form.routeId}
                onValueChange={(v) => setForm((p) => ({ ...p, routeId: v ?? "" }))}
              >
                <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
                <SelectContent>
                  {routes.map((r) => (
                    <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-gray-700 hover:bg-gray-50 rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Area"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <CsvImportModal
        title="Areas"
        columns={IMPORT_COLUMNS}
        rows={importRows}
        fileName={importFile}
        validateRow={(row) => {
          if (!row.name?.trim()) return "Name is required";
          const dt = row.deliverytype?.trim();
          if (!dt) return "Delivery type is required";
          const dtExists = deliveryTypes.some((d) => d.name.toLowerCase() === dt.toLowerCase());
          if (!dtExists) return `Delivery type "${dt}" not found`;
          const pr = row.primaryroute?.trim();
          if (pr) {
            const prExists = routes.some((r) => r.name.toLowerCase() === pr.toLowerCase());
            if (!prExists) return `Route "${pr}" not found`;
          }
          if (areas.some((a) => a.name.toLowerCase() === row.name.trim().toLowerCase()))
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
