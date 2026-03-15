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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SlotRow {
  id:        number;
  name:      string;
  slotTime:  string;
  isNextDay: boolean;
  isActive:  boolean;
  sortOrder: number;
}

interface SlotsTableProps {
  initialSlots: SlotRow[];
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name:      "",
  slotTime:  "",
  isNextDay: false,
  sortOrder: "",
  isActive:  true,
};

function buildForm(editing: SlotRow | null): typeof EMPTY_FORM {
  if (!editing) return EMPTY_FORM;
  return {
    name:      editing.name,
    slotTime:  editing.slotTime,
    isNextDay: editing.isNextDay,
    sortOrder: editing.sortOrder.toString(),
    isActive:  editing.isActive,
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SlotsTable({ initialSlots }: SlotsTableProps) {
  const [slots,       setSlots]       = useState<SlotRow[]>(initialSlots);
  const [sheetOpen,   setSheetOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<SlotRow | null>(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving,      setSaving]      = useState(false);

  // Deactivation warning dialog state
  const [warnDialog,  setWarnDialog]  = useState<{ slotId: number; message: string } | null>(null);
  const [confirming,  setConfirming]  = useState(false);

  // ── Sheet helpers ──────────────────────────────────────────────────────────

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(slot: SlotRow) {
    setEditTarget(slot);
    setForm(buildForm(slot));
    setFieldErrors({});
    setSheetOpen(true);
  }

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim())             errs.name = "Name is required.";
    if (!form.slotTime.trim()) {
      errs.slotTime = "Slot time is required.";
    } else if (!/^\d{2}:\d{2}$/.test(form.slotTime)) {
      errs.slotTime = "Must be HH:MM format (e.g. 18:00).";
    }
    if (!form.sortOrder) {
      errs.sortOrder = "Sort order is required.";
    } else if (isNaN(parseInt(form.sortOrder, 10)) || parseInt(form.sortOrder, 10) < 1) {
      errs.sortOrder = "Must be a positive integer.";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save (create / update) ─────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = {
        name:      form.name.trim(),
        slotTime:  form.slotTime.trim(),
        isNextDay: form.isNextDay,
        sortOrder: parseInt(form.sortOrder, 10),
        isActive:  form.isActive,
      };

      const res = editTarget
        ? await fetch(`/api/admin/slots/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/slots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.warning) {
          // Deactivation warning — show confirm dialog
          setWarnDialog({ slotId: editTarget!.id, message: data.message });
          return;
        }
        if (res.status === 409) {
          setFieldErrors({ name: "A slot with this name already exists." });
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }

      if (editTarget) {
        setSlots((prev) => prev.map((s) => (s.id === data.id ? data : s)));
        toast.success("Slot updated.");
      } else {
        setSlots((prev) => [...prev, data].sort((a, b) => a.sortOrder - b.sortOrder));
        toast.success(`Slot "${data.name}" created.`);
      }
      setSheetOpen(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Force deactivate (after warning confirmed) ─────────────────────────────

  async function handleForceDeactivate() {
    if (!warnDialog) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/admin/slots/${warnDialog.slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false, force: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to deactivate.");
        return;
      }
      setSlots((prev) => prev.map((s) => (s.id === data.id ? data : s)));
      toast.success("Slot deactivated.");
      setWarnDialog(null);
      setSheetOpen(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setConfirming(false);
    }
  }

  // ── Quick toggle from table ────────────────────────────────────────────────

  async function handleToggle(slot: SlotRow) {
    const newActive = !slot.isActive;
    try {
      const res = await fetch(`/api/admin/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newActive }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.warning) {
          setWarnDialog({ slotId: slot.id, message: data.message });
          return;
        }
        toast.error(data.error ?? "Failed to update.");
        return;
      }

      setSlots((prev) => prev.map((s) => (s.id === slot.id ? data : s)));
      toast.success(newActive ? "Slot activated." : "Slot deactivated.");
    } catch {
      toast.error("Network error.");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-[#1a237e]">Slot Master</h1>
        <Button size="sm" className="oa-btn-primary" onClick={openAdd}>+ Add Slot</Button>
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 text-center">Sort Order</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Slot Time</TableHead>
              <TableHead className="text-center">Next Day</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                  No slots configured yet.
                </TableCell>
              </TableRow>
            )}
            {slots.map((slot) => (
              <TableRow key={slot.id}>
                <TableCell className="text-center font-mono text-sm text-slate-500">
                  {slot.sortOrder}
                </TableCell>
                <TableCell className="font-medium text-slate-800">{slot.name}</TableCell>
                <TableCell className="font-mono text-sm text-slate-600">{slot.slotTime}</TableCell>
                <TableCell className="text-center">
                  {slot.isNextDay ? (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                      Next Day
                    </Badge>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={slot.isActive ? "default" : "secondary"}>
                    {slot.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" className="oa-btn-ghost" onClick={() => openEdit(slot)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="oa-btn-ghost"
                      onClick={() => handleToggle(slot)}
                    >
                      {slot.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Add / Edit Sheet ─────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? "Edit Slot" : "Add Slot"}</SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="e.g. Morning, Night, Next Day Morning"
              />
              {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
            </div>

            {/* Slot Time */}
            <div className="space-y-1.5">
              <Label>Slot Time <span className="text-destructive">*</span></Label>
              <Input
                value={form.slotTime}
                onChange={(e) => setField("slotTime", e.target.value)}
                placeholder="HH:MM — e.g. 10:30"
                className="font-mono"
              />
              {fieldErrors.slotTime ? (
                <p className="text-xs text-destructive">{fieldErrors.slotTime}</p>
              ) : (
                <p className="text-xs text-slate-400">
                  This is a display reference only. Actual cutoff windows are configured in Slot Rules.
                </p>
              )}
            </div>

            {/* Sort Order */}
            <div className="space-y-1.5">
              <Label>Sort Order <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={form.sortOrder}
                onChange={(e) => setField("sortOrder", e.target.value)}
                placeholder="e.g. 1, 2, 3…"
              />
              {fieldErrors.sortOrder && <p className="text-xs text-destructive">{fieldErrors.sortOrder}</p>}
            </div>

            {/* Is Next Day */}
            <label className="flex items-center justify-between p-3 rounded-lg border border-[#e5e7eb] bg-[#f7f8fa] cursor-pointer hover:bg-[#eef2ff] hover:border-[#c7d2fe] transition-all">
              <div>
                <div className="text-sm font-medium text-[#111827]">Next Day Slot</div>
                <div className="text-xs text-[#6b7280] mt-0.5">Belongs to the following calendar day</div>
              </div>
              <Switch
                checked={form.isNextDay}
                onCheckedChange={(v) => setField("isNextDay", v)}
                className="data-[state=checked]:bg-[#1a237e]"
              />
            </label>

            {/* Is Active */}
            <label className="flex items-center justify-between p-3 rounded-lg border border-[#e5e7eb] bg-[#f7f8fa] cursor-pointer hover:bg-[#eef2ff] hover:border-[#c7d2fe] transition-all">
              <div>
                <div className="text-sm font-medium text-[#111827]">Active</div>
                <div className="text-xs text-[#6b7280] mt-0.5">Inactive slots cannot be assigned to new orders</div>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setField("isActive", v)}
                className="data-[state=checked]:bg-[#1a237e]"
              />
            </label>

            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-[#374151] hover:bg-[#f7f8fa] rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-[#1a237e] hover:bg-[#283593] text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Slot"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Deactivation warning dialog ──────────────────────────────────────── */}
      <Dialog open={!!warnDialog} onOpenChange={(o) => { if (!o) setWarnDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate Slot?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">{warnDialog?.message}</p>
          <p className="text-sm text-slate-600 mt-1">
            You can deactivate it anyway, but those slot rules will still reference this slot.
            Consider updating the slot rules first.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" className="oa-btn-ghost" onClick={() => setWarnDialog(null)} disabled={confirming}>
              Cancel
            </Button>
            <Button variant="destructive" className="oa-btn-danger" onClick={handleForceDeactivate} disabled={confirming}>
              {confirming ? "Deactivating…" : "Deactivate Anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
