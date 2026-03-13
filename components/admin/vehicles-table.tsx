"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Note: "Both" delivery type is not supported in Phase 1.
// The dropdown shows Local / Upcountry only (sourced from delivery_type_master).

interface DeliveryType { id: number; name: string; }
interface VehicleRow {
  id: number;
  vehicleNumber: string;
  vehicleType: string;
  capacityKg: number;
  capacityCbm: number | null;
  deliveryType: DeliveryType;
  isActive: boolean;
}

interface VehiclesTableProps {
  initialVehicles: VehicleRow[];
  deliveryTypes: DeliveryType[];
}

const EMPTY_FORM = {
  vehicleNumber: "",
  vehicleType: "",
  capacityKg: "",
  capacityCbm: "",
  deliveryTypeId: "",
};

export function VehiclesTable({ initialVehicles, deliveryTypes }: VehiclesTableProps) {
  const [vehicles, setVehicles] = useState<VehicleRow[]>(initialVehicles);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VehicleRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  function openAdd() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, deliveryTypeId: deliveryTypes[0]?.id.toString() ?? "" });
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(vehicle: VehicleRow) {
    setEditTarget(vehicle);
    setForm({
      vehicleNumber: vehicle.vehicleNumber,
      vehicleType: vehicle.vehicleType,
      capacityKg: vehicle.capacityKg.toString(),
      capacityCbm: vehicle.capacityCbm?.toString() ?? "",
      deliveryTypeId: vehicle.deliveryType.id.toString(),
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
    if (!form.vehicleNumber.trim()) errs.vehicleNumber = "Vehicle number is required.";
    if (!form.vehicleType.trim()) errs.vehicleType = "Vehicle type is required.";
    if (!form.capacityKg) {
      errs.capacityKg = "Capacity (kg) is required.";
    } else if (isNaN(parseFloat(form.capacityKg)) || parseFloat(form.capacityKg) <= 0) {
      errs.capacityKg = "Must be a positive number.";
    }
    if (form.capacityCbm && (isNaN(parseFloat(form.capacityCbm)) || parseFloat(form.capacityCbm) <= 0)) {
      errs.capacityCbm = "Must be a positive number.";
    }
    if (!form.deliveryTypeId) errs.deliveryTypeId = "Delivery type is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = {
        vehicleNumber: form.vehicleNumber.trim().toUpperCase(),
        vehicleType: form.vehicleType.trim(),
        capacityKg: parseFloat(form.capacityKg),
        capacityCbm: form.capacityCbm ? parseFloat(form.capacityCbm) : null,
        deliveryTypeId: parseInt(form.deliveryTypeId, 10),
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
          setFieldErrors({ vehicleNumber: "Vehicle number already exists." });
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
        toast.success(`Vehicle "${data.vehicleNumber}" created.`);
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

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Vehicles</h1>
        <Button size="sm" onClick={openAdd}>+ Add Vehicle</Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle No.</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Capacity (kg)</TableHead>
              <TableHead>Capacity (CBM)</TableHead>
              <TableHead>Delivery Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                  No vehicles yet.
                </TableCell>
              </TableRow>
            )}
            {vehicles.map((vehicle) => (
              <TableRow key={vehicle.id}>
                <TableCell className="font-mono font-medium">{vehicle.vehicleNumber}</TableCell>
                <TableCell>{vehicle.vehicleType}</TableCell>
                <TableCell>{vehicle.capacityKg.toLocaleString()}</TableCell>
                <TableCell className="text-slate-500">
                  {vehicle.capacityCbm != null ? vehicle.capacityCbm : <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{vehicle.deliveryType.name}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={vehicle.isActive ? "default" : "secondary"}>
                    {vehicle.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(vehicle)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={togglingId === vehicle.id}
                      onClick={() => handleToggle(vehicle)}
                    >
                      {vehicle.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? "Edit Vehicle" : "Add Vehicle"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="flex flex-col gap-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="v-number">Vehicle Number <span className="text-destructive">*</span></Label>
              <Input
                id="v-number"
                value={form.vehicleNumber}
                onChange={(e) => setField("vehicleNumber", e.target.value.toUpperCase())}
                placeholder="e.g. GJ05AB1234"
              />
              {fieldErrors.vehicleNumber && (
                <p className="text-xs text-destructive">{fieldErrors.vehicleNumber}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-type">Vehicle Type <span className="text-destructive">*</span></Label>
              <Input
                id="v-type"
                value={form.vehicleType}
                onChange={(e) => setField("vehicleType", e.target.value)}
                placeholder="e.g. Tata Ace, Bolero Pickup, 407"
              />
              {fieldErrors.vehicleType && (
                <p className="text-xs text-destructive">{fieldErrors.vehicleType}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="v-kg">Capacity (kg) <span className="text-destructive">*</span></Label>
                <Input
                  id="v-kg"
                  type="number"
                  step="any"
                  min="0"
                  value={form.capacityKg}
                  onChange={(e) => setField("capacityKg", e.target.value)}
                  placeholder="e.g. 900"
                />
                {fieldErrors.capacityKg && (
                  <p className="text-xs text-destructive">{fieldErrors.capacityKg}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-cbm">Capacity (CBM)</Label>
                <Input
                  id="v-cbm"
                  type="number"
                  step="any"
                  min="0"
                  value={form.capacityCbm}
                  onChange={(e) => setField("capacityCbm", e.target.value)}
                  placeholder="Optional"
                />
                {fieldErrors.capacityCbm && (
                  <p className="text-xs text-destructive">{fieldErrors.capacityCbm}</p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Delivery Type <span className="text-destructive">*</span></Label>
              <Select
                value={form.deliveryTypeId}
                onValueChange={(v) => setField("deliveryTypeId", v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {deliveryTypes.map((dt) => (
                    <SelectItem key={dt.id} value={dt.id.toString()}>{dt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.deliveryTypeId && (
                <p className="text-xs text-destructive">{fieldErrors.deliveryTypeId}</p>
              )}
              <p className="text-xs text-slate-400">
                &quot;Both&quot; is not supported in Phase 1. Use Local or Upcountry.
              </p>
            </div>
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editTarget ? "Save Changes" : "Create Vehicle"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
