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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SalesOfficer {
  id:           number;
  name:         string;
  employeeCode: string;
}

export interface SOGroupRow {
  id:             number;
  name:           string;
  salesOfficerId: number;
  salesOfficer:   SalesOfficer;
  isActive:       boolean;
  _count:         { customers: number };
}

interface Props {
  initialRows:    SOGroupRow[];
  salesOfficers:  SalesOfficer[];
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = { name: "", salesOfficerId: "", isActive: true };

function buildForm(row: SOGroupRow | null): typeof EMPTY_FORM {
  if (!row) return EMPTY_FORM;
  return { name: row.name, salesOfficerId: row.salesOfficerId.toString(), isActive: row.isActive };
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SOGroupsTable({ initialRows, salesOfficers }: Props) {
  const [rows,        setRows]        = useState<SOGroupRow[]>(initialRows);
  const [sheetOpen,   setSheetOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<SOGroupRow | null>(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving,      setSaving]      = useState(false);

  // ── Reassign modal state ─────────────────────────────────────────────────
  const [reassignTarget,   setReassignTarget]   = useState<SOGroupRow | null>(null);
  const [reassignNewSOId,  setReassignNewSOId]  = useState("");
  const [reassignSaving,   setReassignSaving]   = useState(false);

  // ── Sheet helpers ────────────────────────────────────────────────────────

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(row: SOGroupRow) {
    setEditTarget(row);
    setForm(buildForm(row));
    setFieldErrors({});
    setSheetOpen(true);
  }

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim())       errs.name           = "Name is required.";
    if (!form.salesOfficerId)    errs.salesOfficerId  = "Sales officer is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save (create / edit) ─────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = {
        name:           form.name.trim(),
        salesOfficerId: parseInt(form.salesOfficerId, 10),
        isActive:       form.isActive,
      };
      const res = editTarget
        ? await fetch(`/api/admin/so-groups/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/so-groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ name: "A group with this name already exists." });
        } else if (res.status === 422) {
          toast.error(data.error ?? "Cannot perform this action.");
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }

      if (editTarget) {
        setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
        toast.success("Group updated.");
      } else {
        setRows((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(`Group "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Quick active toggle ──────────────────────────────────────────────────

  async function handleToggle(row: SOGroupRow) {
    const newActive = !row.isActive;
    try {
      const res = await fetch(`/api/admin/so-groups/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update.");
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === row.id ? data : r)));
      toast.success(newActive ? "Group activated." : "Group deactivated.");
    } catch {
      toast.error("Network error.");
    }
  }

  // ── Open reassign modal ──────────────────────────────────────────────────

  function openReassign(row: SOGroupRow) {
    setReassignTarget(row);
    setReassignNewSOId("");
  }

  // ── Confirm reassignment ─────────────────────────────────────────────────

  async function handleReassign() {
    if (!reassignTarget || !reassignNewSOId) return;
    setReassignSaving(true);
    try {
      const res = await fetch(`/api/admin/so-groups/${reassignTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesOfficerId: parseInt(reassignNewSOId, 10) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Reassignment failed.");
        return;
      }

      const newSO    = salesOfficers.find((s) => s.id.toString() === reassignNewSOId);
      const newSOName = newSO?.name ?? "new SO";

      setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
      toast.success(
        `All ${reassignTarget._count.customers} customer${reassignTarget._count.customers === 1 ? "" : "s"} in "${reassignTarget.name}" reassigned to ${newSOName}.`
      );
      setReassignTarget(null);
    } catch {
      toast.error("Network error.");
    } finally {
      setReassignSaving(false);
    }
  }

  // ── Available SOs for reassign (exclude current) ─────────────────────────

  const reassignOptions = reassignTarget
    ? salesOfficers.filter((s) => s.id !== reassignTarget.salesOfficerId)
    : [];

  const selectedNewSO = salesOfficers.find((s) => s.id.toString() === reassignNewSOId);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-[#1a237e]">SO Groups</h1>
        <Button size="sm" onClick={openAdd} className="oa-btn-primary">+ Add Group</Button>
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group Name</TableHead>
              <TableHead>Assigned Sales Officer</TableHead>
              <TableHead className="text-center">Customers</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                  No SO groups configured yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-slate-800">{row.name}</TableCell>
                <TableCell className="text-slate-600 text-sm">
                  {row.salesOfficer.name}
                  <span className="ml-1.5 text-slate-400 font-mono text-xs">({row.salesOfficer.employeeCode})</span>
                </TableCell>
                <TableCell className="text-center text-slate-600 font-mono text-sm">
                  {row._count.customers}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openReassign(row)} className="oa-btn-ghost">
                      Reassign SO
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(row)} className="oa-btn-ghost">
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleToggle(row)} className="oa-btn-ghost">
                      {row.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Add / Edit Sheet ──────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? "Edit Group" : "Add Group"}</SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>Group Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="e.g. Varacha North Portfolio"
              />
              {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
            </div>

            {/* Sales Officer */}
            <div className="space-y-1.5">
              <Label>Assigned Sales Officer <span className="text-destructive">*</span></Label>
              <Select
                value={form.salesOfficerId}
                onValueChange={(v) => setField("salesOfficerId", v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select sales officer…" />
                </SelectTrigger>
                <SelectContent>
                  {salesOfficers.map((so) => (
                    <SelectItem key={so.id} value={so.id.toString()}>
                      {so.name} <span className="text-slate-400">({so.employeeCode})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.salesOfficerId && (
                <p className="text-xs text-destructive">{fieldErrors.salesOfficerId}</p>
              )}
              <p className="text-xs text-slate-400">
                To bulk-reassign all customers use the &quot;Reassign SO&quot; button in the table.
              </p>
            </div>

            {/* Is Active */}
            <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-[#e5e7eb] bg-[#f7f8fa]">
              <div>
                <div className="text-sm font-medium text-[#111827]">Active</div>
                <div className="text-xs text-[#6b7280] mt-0.5">
                  Cannot deactivate while active customers are assigned
                </div>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setField("isActive", v)}
                className="data-[state=checked]:bg-[#1a237e] data-[state=unchecked]:bg-[#d1d5db]"
              />
            </div>

            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-[#374151] hover:bg-[#f7f8fa] rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-[#1a237e] hover:bg-[#283593] text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Group"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Bulk Reassign Modal ───────────────────────────────────────────────── */}
      <Dialog open={!!reassignTarget} onOpenChange={(o) => { if (!o) setReassignTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign Sales Officer</DialogTitle>
          </DialogHeader>

          {reassignTarget && (
            <div className="space-y-4 py-1">
              <div className="rounded-md bg-slate-50 border px-4 py-3 space-y-1">
                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Group</p>
                <p className="text-sm font-medium text-slate-800">{reassignTarget.name}</p>
                <p className="text-xs text-slate-500">
                  {reassignTarget._count.customers} customer{reassignTarget._count.customers === 1 ? "" : "s"} will be affected
                </p>
              </div>

              <div className="rounded-md bg-slate-50 border px-4 py-3 space-y-1">
                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Current SO</p>
                <p className="text-sm text-slate-700">
                  {reassignTarget.salesOfficer.name}
                  <span className="ml-1.5 text-slate-400 font-mono text-xs">({reassignTarget.salesOfficer.employeeCode})</span>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>New Sales Officer <span className="text-destructive">*</span></Label>
                <Select
                  value={reassignNewSOId}
                  onValueChange={(v) => setReassignNewSOId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select new SO…" />
                  </SelectTrigger>
                  <SelectContent>
                    {reassignOptions.map((so) => (
                      <SelectItem key={so.id} value={so.id.toString()}>
                        {so.name} <span className="text-slate-400">({so.employeeCode})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => setReassignTarget(null)}
              disabled={reassignSaving}
              className="oa-btn-ghost"
            >
              Cancel
            </Button>
            <Button
              onClick={handleReassign}
              disabled={!reassignNewSOId || reassignSaving}
              className="oa-btn-primary"
            >
              {reassignSaving
                ? "Reassigning…"
                : selectedNewSO
                  ? `Reassign all ${reassignTarget?._count.customers ?? 0} customers to ${selectedNewSO.name}`
                  : "Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
