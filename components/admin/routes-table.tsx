"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Pencil, X } from "lucide-react";

interface RouteRow {
  id: number;
  name: string;
  isActive: boolean;
  areaCount: number;
}

interface RoutesTableProps {
  initialRoutes: RouteRow[];
}

export function RoutesTable({ initialRoutes }: RoutesTableProps) {
  const [routes, setRoutes] = useState<RouteRow[]>(initialRoutes);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to create route."); return; }
      setRoutes((prev) => [...prev, data]);
      setAddName("");
      toast.success(`Route "${data.name}" created.`);
    } catch { toast.error("Network error."); } finally { setAdding(false); }
  }

  function startEdit(route: RouteRow) {
    setEditingId(route.id);
    setEditName(route.name);
    setTimeout(() => editInputRef.current?.focus(), 50);
  }

  async function commitEdit(id: number) {
    if (!editName.trim()) { cancelEdit(); return; }
    try {
      const res = await fetch(`/api/admin/routes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to update route."); return; }
      setRoutes((prev) => prev.map((r) => (r.id === id ? data : r)));
      toast.success("Route updated.");
    } catch { toast.error("Network error."); } finally { cancelEdit(); }
  }

  function cancelEdit() { setEditingId(null); setEditName(""); }

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
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Routes</h1>
      </div>

      {/* Add route form */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <Input
          placeholder="New route name…"
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
          className="max-w-xs"
        />
        <Button type="submit" size="sm" disabled={adding || !addName.trim()}>
          {adding ? "Adding…" : "Add Route"}
        </Button>
      </form>

      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route Name</TableHead>
              <TableHead>Areas</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                  No routes yet.
                </TableCell>
              </TableRow>
            )}
            {routes.map((route) => (
              <TableRow key={route.id}>
                <TableCell>
                  {editingId === route.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        ref={editInputRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(route.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        className="h-7 py-0 text-sm w-44"
                      />
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => commitEdit(route.id)}>
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit}>
                        <X className="h-3.5 w-3.5 text-slate-400" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{route.name}</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6 opacity-50 hover:opacity-100" onClick={() => startEdit(route)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-slate-500">{route.areaCount}</TableCell>
                <TableCell>
                  <Badge variant={route.isActive ? "default" : "secondary"}>
                    {route.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={togglingId === route.id}
                    onClick={() => handleToggle(route)}
                  >
                    {route.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
