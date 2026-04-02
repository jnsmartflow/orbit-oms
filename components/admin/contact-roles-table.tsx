"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface ContactRoleRow {
  id:       number;
  name:     string;
  isActive: boolean;
}

interface Props { initialRows: ContactRoleRow[]; }

const EMPTY_FORM = { name: "", isActive: true };

function buildForm(row: ContactRoleRow | null): typeof EMPTY_FORM {
  if (!row) return EMPTY_FORM;
  return { name: row.name, isActive: row.isActive };
}

export function ContactRolesTable({ initialRows }: Props) {
  const [rows,        setRows]        = useState<ContactRoleRow[]>(initialRows);
  const [sheetOpen,   setSheetOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<ContactRoleRow | null>(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving,      setSaving]      = useState(false);

  function openAdd() { setEditTarget(null); setForm(EMPTY_FORM); setFieldErrors({}); setSheetOpen(true); }
  function openEdit(row: ContactRoleRow) { setEditTarget(row); setForm(buildForm(row)); setFieldErrors({}); setSheetOpen(true); }
  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), isActive: form.isActive };
      const res = editTarget
        ? await fetch(`/api/admin/contact-roles/${editTarget.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/admin/contact-roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) setFieldErrors({ name: "A contact role with this name already exists." });
        else toast.error(data.error ?? "Failed to save.");
        return;
      }
      if (editTarget) {
        setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
        toast.success("Contact role updated.");
      } else {
        setRows((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(`Contact role "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch { toast.error("Network error."); }
    finally { setSaving(false); }
  }

  async function handleToggle(row: ContactRoleRow) {
    try {
      const res = await fetch(`/api/admin/contact-roles/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !row.isActive }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to update."); return; }
      setRows((prev) => prev.map((r) => (r.id === row.id ? data : r)));
      toast.success(!row.isActive ? "Contact role activated." : "Contact role deactivated.");
    } catch { toast.error("Network error."); }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-teal-700">Contact Roles</h1>
        <Button size="sm" className="oa-btn-primary" onClick={openAdd}>+ Add Role</Button>
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-gray-500 py-8">No contact roles configured yet.</TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-gray-800">{row.name}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={row.isActive ? "default" : "secondary"}>{row.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" className="oa-btn-ghost" onClick={() => openEdit(row)}>Edit</Button>
                    <Button size="sm" variant="outline" className="oa-btn-ghost" onClick={() => handleToggle(row)}>
                      {row.isActive ? "Deactivate" : "Activate"}
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
            <SheetTitle>{editTarget ? "Edit Contact Role" : "Add Contact Role"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="e.g. Owner, Contractor, Manager" />
              {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
            </div>
            <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-[#e5e7eb] bg-gray-50">
              <div>
                <div className="text-sm font-medium text-gray-900">Active</div>
                <div className="text-xs text-gray-500 mt-0.5">Inactive roles are hidden from customer contact forms</div>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setField("isActive", v)} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-gray-300" />
            </div>
            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-gray-700 hover:bg-gray-50 rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Role"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
