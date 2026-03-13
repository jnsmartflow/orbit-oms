"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface OfficerRow {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

interface SalesOfficersTableProps {
  initialOfficers: OfficerRow[];
}

const EMPTY = { name: "", email: "" };

export function SalesOfficersTable({ initialOfficers }: SalesOfficersTableProps) {
  const [officers, setOfficers] = useState<OfficerRow[]>(initialOfficers);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<OfficerRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(officer: OfficerRow) {
    setEditing(officer);
    setForm({ name: officer.name, email: officer.email });
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
    if (!form.email.trim()) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), email: form.email.trim().toLowerCase() };
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

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Sales Officers</h1>
        <Button size="sm" onClick={openAdd}>+ Add Sales Officer</Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {officers.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                  No sales officers yet.
                </TableCell>
              </TableRow>
            )}
            {officers.map((officer) => (
              <TableRow key={officer.id}>
                <TableCell className="font-medium">{officer.name}</TableCell>
                <TableCell className="text-slate-600">{officer.email}</TableCell>
                <TableCell>
                  <Badge variant={officer.isActive ? "default" : "secondary"}>
                    {officer.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(officer)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
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
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit Sales Officer" : "Add Sales Officer"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="so-name">Name</Label>
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
              />
              {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
            </div>
            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Create"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
