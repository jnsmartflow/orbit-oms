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

interface DeliveryType { id: number; name: string; }
interface Route { id: number; name: string; }
interface AreaRow {
  id: number; name: string; isActive: boolean; createdAt: string;
  deliveryType: DeliveryType;
  routes: Route[];
  subAreaCount: number;
}

interface AreasTableProps {
  initialAreas: AreaRow[];
  deliveryTypes: DeliveryType[];
  routes: Route[];
}

const EMPTY_FORM = { name: "", deliveryTypeId: "", routeId: "" };

export function AreasTable({ initialAreas, deliveryTypes, routes }: AreasTableProps) {
  const [areas, setAreas] = useState<AreaRow[]>(initialAreas);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AreaRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  function openAdd() {
    setEditTarget(null);
    setForm({ name: "", deliveryTypeId: deliveryTypes[0]?.id.toString() ?? "", routeId: "" });
    setSheetOpen(true);
  }

  function openEdit(area: AreaRow) {
    setEditTarget(area);
    setForm({
      name: area.name,
      deliveryTypeId: area.deliveryType.id.toString(),
      routeId: area.routes[0]?.id.toString() ?? "",
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
        name: form.name.trim(),
        deliveryTypeId: parseInt(form.deliveryTypeId, 10),
        routeIds: [parseInt(form.routeId, 10)],
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

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Areas</h1>
        <Button size="sm" onClick={openAdd}>+ Add Area</Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Area Name</TableHead>
              <TableHead>Delivery Type</TableHead>
              <TableHead>Routes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {areas.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-8">No areas yet.</TableCell>
              </TableRow>
            )}
            {areas.map((area) => (
              <TableRow key={area.id}>
                <TableCell className="font-medium">{area.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{area.deliveryType.name}</Badge>
                </TableCell>
                <TableCell className="text-slate-600 text-sm">
                  {area.routes.length === 0
                    ? <span className="text-slate-400">—</span>
                    : area.routes.map((r) => r.name).join(", ")}
                </TableCell>
                <TableCell>
                  <Badge variant={area.isActive ? "default" : "secondary"}>
                    {area.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(area)}>Edit</Button>
                    <Button
                      size="sm" variant="outline"
                      disabled={togglingId === area.id}
                      onClick={() => handleToggle(area)}
                    >
                      {area.isActive ? "Deactivate" : "Activate"}
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
            <SheetTitle>{editTarget ? "Edit Area" : "Add Area"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="flex flex-col gap-4 py-4">
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
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Area"}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
