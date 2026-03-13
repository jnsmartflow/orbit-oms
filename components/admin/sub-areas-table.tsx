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

export function SubAreasTable({ initialSubAreas, areas }: SubAreasTableProps) {
  const [subAreas, setSubAreas] = useState<SubAreaRow[]>(initialSubAreas);
  const [filterAreaId, setFilterAreaId] = useState<string>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SubAreaRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

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

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Sub-areas</h1>
        <Button size="sm" onClick={openAdd}>+ Add Sub-area</Button>
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

      <div className="rounded-md border bg-white overflow-x-auto">
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
                    <Button size="sm" variant="outline" onClick={() => openEdit(sub)}>Edit</Button>
                    <Button
                      size="sm" variant="outline"
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
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editTarget ? "Edit Sub-area" : "Add Sub-area"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="flex flex-col gap-4 py-4">
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
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create"}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
