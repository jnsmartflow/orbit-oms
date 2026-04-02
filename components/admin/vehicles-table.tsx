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

interface Transporter { id: number; name: string; }

interface VehicleRow {
  id:                  number;
  vehicleNo:           string;
  category:            string;
  capacityKg:          number;
  maxCustomers:        number | null;
  deliveryTypeAllowed: string;
  transporter:         Transporter;
  driverName:          string | null;
  driverPhone:         string | null;
  isActive:            boolean;
}

interface VehiclesTableProps {
  initialVehicles: VehicleRow[];
  transporters:    Transporter[];
  canEdit?:        boolean;
  canImport?:      boolean;
}

const EMPTY_FORM = {
  vehicleNo:           "",
  category:            "",
  capacityKg:          "",
  maxCustomers:        "",
  deliveryTypeAllowed: "",
  transporterId:       "",
  driverName:          "",
  driverPhone:         "",
};

const IMPORT_COLUMNS: CsvColumn[] = [
  { key: "vehicleno",           label: "Vehicle No.",         required: true  },
  { key: "category",            label: "Category",            required: true  },
  { key: "capacitykg",          label: "Capacity (kg)",       required: true  },
  { key: "deliverytypeallowed", label: "Delivery Type",       required: true  },
  { key: "transporter",         label: "Transporter",         required: true  },
  { key: "drivername",          label: "Driver Name",         required: false },
  { key: "driverphone",         label: "Driver Phone",        required: false },
  { key: "maxcustomers",        label: "Max Customers",       required: false },
];

export function VehiclesTable({ initialVehicles, transporters, canEdit = true, canImport = true }: VehiclesTableProps) {
  const [vehicles,   setVehicles]   = useState<VehicleRow[]>(initialVehicles);
  const [sheetOpen,  setSheetOpen]  = useState(false);
  const [editTarget, setEditTarget] = useState<VehicleRow | null>(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [fieldErrors,setFieldErrors]= useState<Record<string, string>>({});
  const [saving,     setSaving]     = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const importFileRef                = useRef<HTMLInputElement>(null);
  const [importRows,  setImportRows] = useState<Record<string, string>[]>([]);
  const [importFile,  setImportFile] = useState("");
  const [importOpen,  setImportOpen] = useState(false);

  function openAdd() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, transporterId: transporters[0]?.id.toString() ?? "" });
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(v: VehicleRow) {
    setEditTarget(v);
    setForm({
      vehicleNo:           v.vehicleNo,
      category:            v.category,
      capacityKg:          v.capacityKg.toString(),
      maxCustomers:        v.maxCustomers?.toString() ?? "",
      deliveryTypeAllowed: v.deliveryTypeAllowed,
      transporterId:       v.transporter.id.toString(),
      driverName:          v.driverName ?? "",
      driverPhone:         v.driverPhone ?? "",
    });
    setFieldErrors({});
    setSheetOpen(true);
  }

  function setField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.vehicleNo.trim())           errs.vehicleNo = "Vehicle number is required.";
    if (!form.category.trim())            errs.category = "Category is required.";
    if (!form.deliveryTypeAllowed.trim()) errs.deliveryTypeAllowed = "Delivery type is required.";
    if (!form.transporterId)              errs.transporterId = "Transporter is required.";
    if (!form.capacityKg) {
      errs.capacityKg = "Capacity (kg) is required.";
    } else if (isNaN(parseFloat(form.capacityKg)) || parseFloat(form.capacityKg) <= 0) {
      errs.capacityKg = "Must be a positive number.";
    }
    if (form.maxCustomers && (isNaN(parseInt(form.maxCustomers, 10)) || parseInt(form.maxCustomers, 10) <= 0)) {
      errs.maxCustomers = "Must be a positive integer.";
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
        vehicleNo:           form.vehicleNo.trim().toUpperCase(),
        category:            form.category.trim(),
        capacityKg:          parseFloat(form.capacityKg),
        maxCustomers:        form.maxCustomers ? parseInt(form.maxCustomers, 10) : null,
        deliveryTypeAllowed: form.deliveryTypeAllowed.trim(),
        transporterId:       parseInt(form.transporterId, 10),
        driverName:          form.driverName.trim() || null,
        driverPhone:         form.driverPhone.trim() || null,
      };

      const res = editTarget
        ? await fetch(`/api/admin/vehicles/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/vehicles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ vehicleNo: "Vehicle number already exists." });
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }

      if (editTarget) {
        setVehicles((prev) => prev.map((v) => (v.id === data.id ? data : v)));
        toast.success("Vehicle updated.");
      } else {
        setVehicles((prev) => [...prev, data]);
        toast.success(`Vehicle "${data.vehicleNo}" created.`);
      }
      setSheetOpen(false);
    } catch { toast.error("Network error."); } finally { setSaving(false); }
  }

  async function handleToggle(vehicle: VehicleRow) {
    setTogglingId(vehicle.id);
    try {
      const res = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !vehicle.isActive }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to update."); return; }
      setVehicles((prev) => prev.map((v) => (v.id === vehicle.id ? data : v)));
      toast.success(`Vehicle ${data.isActive ? "activated" : "deactivated"}.`);
    } catch { toast.error("Network error."); } finally { setTogglingId(null); }
  }

  function handleTemplateDownload() {
    const csv = "vehicleno,category,capacitykg,deliverytypeallowed,transporter,drivername,driverphone,maxcustomers\nGJ05AB1234,Light,900,Local,Sharma Logistics,Raj Kumar,9898989898,5\nGJ05CD5678,Medium,2000,Upcountry,Patel Transport,Suresh Patel,9797979797,8";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-vehicles.csv";
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
    const res = await fetch("/api/admin/vehicles/import", {
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
        <h1 className="text-lg font-bold text-teal-700">Vehicles</h1>
        <div className="flex gap-2">
          {canImport && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-medium text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 px-3 py-2 rounded-md"
              onClick={handleTemplateDownload}
            >
              <Download className="h-3.5 w-3.5" />
              Download Template
            </button>
          )}
          {canImport && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-medium bg-white hover:bg-gray-50 text-gray-700 border border-[#e5e7eb] px-3 py-2 rounded-md"
              onClick={() => importFileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Import File
            </button>
          )}
          {canEdit && (
            <Button size="sm" onClick={openAdd} className="oa-btn-primary">+ Add Vehicle</Button>
          )}
        </div>
        <input ref={importFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleImportFileSelect} />
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle No.</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Capacity (kg)</TableHead>
              <TableHead>Delivery Type</TableHead>
              <TableHead>Transporter</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                  No vehicles yet.
                </TableCell>
              </TableRow>
            )}
            {vehicles.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono font-medium">{v.vehicleNo}</TableCell>
                <TableCell>{v.category}</TableCell>
                <TableCell>{v.capacityKg.toLocaleString()}</TableCell>
                <TableCell className="text-gray-600">{v.deliveryTypeAllowed}</TableCell>
                <TableCell className="text-gray-600">{v.transporter.name}</TableCell>
                <TableCell className="text-gray-500 text-sm">
                  {v.driverName ?? <span className="text-gray-300">—</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={v.isActive ? "default" : "secondary"}>
                    {v.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => openEdit(v)} className="oa-btn-ghost">Edit</Button>
                    )}
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={togglingId === v.id}
                        onClick={() => handleToggle(v)}
                        className="oa-btn-ghost"
                      >
                        {v.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    )}
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
            <SheetTitle>{editTarget ? "Edit Vehicle" : "Add Vehicle"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            <div className="space-y-1.5">
              <Label>Vehicle Number <span className="text-destructive">*</span></Label>
              <Input
                value={form.vehicleNo}
                onChange={(e) => setField("vehicleNo", e.target.value.toUpperCase())}
                placeholder="e.g. GJ05AB1234"
              />
              {fieldErrors.vehicleNo && <p className="text-xs text-destructive">{fieldErrors.vehicleNo}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Category <span className="text-destructive">*</span></Label>
              <Input
                value={form.category}
                onChange={(e) => setField("category", e.target.value)}
                placeholder="e.g. Light, Medium, Heavy"
              />
              {fieldErrors.category && <p className="text-xs text-destructive">{fieldErrors.category}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Capacity (kg) <span className="text-destructive">*</span></Label>
                <Input
                  type="number" step="any" min="0"
                  value={form.capacityKg}
                  onChange={(e) => setField("capacityKg", e.target.value)}
                  placeholder="e.g. 900"
                />
                {fieldErrors.capacityKg && <p className="text-xs text-destructive">{fieldErrors.capacityKg}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Max Customers</Label>
                <Input
                  type="number" step="1" min="1"
                  value={form.maxCustomers}
                  onChange={(e) => setField("maxCustomers", e.target.value)}
                  placeholder="Optional"
                />
                {fieldErrors.maxCustomers && <p className="text-xs text-destructive">{fieldErrors.maxCustomers}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Delivery Type Allowed <span className="text-destructive">*</span></Label>
              <Input
                value={form.deliveryTypeAllowed}
                onChange={(e) => setField("deliveryTypeAllowed", e.target.value)}
                placeholder="e.g. Local, Upcountry, Both"
              />
              {fieldErrors.deliveryTypeAllowed && <p className="text-xs text-destructive">{fieldErrors.deliveryTypeAllowed}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Transporter <span className="text-destructive">*</span></Label>
              <Select value={form.transporterId} onValueChange={(v) => setField("transporterId", v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select transporter" />
                </SelectTrigger>
                <SelectContent>
                  {transporters.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.transporterId && <p className="text-xs text-destructive">{fieldErrors.transporterId}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Driver Name</Label>
                <Input
                  value={form.driverName}
                  onChange={(e) => setField("driverName", e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Driver Phone</Label>
                <Input
                  value={form.driverPhone}
                  onChange={(e) => setField("driverPhone", e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-gray-700 hover:bg-gray-50 rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Vehicle"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <CsvImportModal
        title="Vehicles"
        columns={IMPORT_COLUMNS}
        rows={importRows}
        fileName={importFile}
        validateRow={(row) => {
          if (!row.vehicleno?.trim()) return "Vehicle No. is required";
          const cat = row.category?.trim();
          if (!cat) return "Category is required";
          if (!["light", "medium", "heavy"].includes(cat.toLowerCase()))
            return `Category must be Light, Medium or Heavy`;
          if (!row.capacitykg?.trim()) return "Capacity (kg) is required";
          if (isNaN(parseFloat(row.capacitykg)) || parseFloat(row.capacitykg) <= 0)
            return "Capacity must be a positive number";
          if (!row.deliverytypeallowed?.trim()) return "Delivery Type is required";
          const tp = row.transporter?.trim();
          if (!tp) return "Transporter is required";
          if (!transporters.some((t) => t.name.toLowerCase() === tp.toLowerCase()))
            return `Transporter "${tp}" not found`;
          if (row.maxcustomers?.trim()) {
            const mc = parseInt(row.maxcustomers.trim(), 10);
            if (isNaN(mc) || mc <= 0) return "Max Customers must be a positive integer";
          }
          if (vehicles.some((v) => v.vehicleNo.toLowerCase() === row.vehicleno.trim().toUpperCase().toLowerCase()))
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
