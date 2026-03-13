"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";

interface RouteRow {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
  areaCount: number;
}

interface RoutesTableProps {
  initialRoutes: RouteRow[];
}

const EMPTY_FORM = { name: "", description: "" };

export function RoutesTable({ initialRoutes }: RoutesTableProps) {
  const [routes, setRoutes] = useState<RouteRow[]>(initialRoutes);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RouteRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

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

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Routes</h1>
        <Button size="sm" onClick={openAdd}>+ Add Route</Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Areas</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                  No routes yet.
                </TableCell>
              </TableRow>
            )}
            {routes.map((route) => (
              <TableRow key={route.id}>
                <TableCell className="font-medium">{route.name}</TableCell>
                <TableCell className="text-slate-500 text-sm">
                  {route.description ?? <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell className="text-slate-500">{route.areaCount}</TableCell>
                <TableCell>
                  <Badge variant={route.isActive ? "default" : "secondary"}>
                    {route.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(route)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={togglingId === route.id}
                      onClick={() => handleToggle(route)}
                    >
                      {route.isActive ? "Deactivate" : "Activate"}
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
            <SheetTitle>{editTarget ? "Edit Route" : "Add Route"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="flex flex-col gap-4 py-4">
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
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editTarget ? "Save Changes" : "Create Route"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
