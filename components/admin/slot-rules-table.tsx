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

interface DeliveryType { id: number; name: string; }
interface SlotOption   { id: number; name: string; slotTime: string; isNextDay: boolean; }

export interface SlotRuleRow {
  id:             number;
  deliveryTypeId: number;
  deliveryType:   DeliveryType;
  slotId:         number;
  slot:           SlotOption;
  slotRuleType:   "time_based" | "default";
  windowStart:    string | null;
  windowEnd:      string | null;
  isDefault:      boolean;
  isActive:       boolean;
  sortOrder:      number;
}

interface SlotRulesTableProps {
  initialRules:  SlotRuleRow[];
  deliveryTypes: DeliveryType[];
  slots:         SlotOption[];
}

// ── Empty form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  deliveryTypeId: "",
  slotId:         "",
  slotRuleType:   "time_based" as "time_based" | "default",
  windowStart:    "",
  windowEnd:      "",
  isDefault:      false,
  sortOrder:      "",
  isActive:       true,
};

function buildForm(r: SlotRuleRow | null): typeof EMPTY_FORM {
  if (!r) return EMPTY_FORM;
  return {
    deliveryTypeId: r.deliveryTypeId.toString(),
    slotId:         r.slotId.toString(),
    slotRuleType:   r.slotRuleType,
    windowStart:    r.windowStart ?? "",
    windowEnd:      r.windowEnd   ?? "",
    isDefault:      r.isDefault,
    sortOrder:      r.sortOrder.toString(),
    isActive:       r.isActive,
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SlotRulesTable({ initialRules, deliveryTypes, slots }: SlotRulesTableProps) {
  const [rules,       setRules]       = useState<SlotRuleRow[]>(initialRules);
  const [sheetOpen,   setSheetOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<SlotRuleRow | null>(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving,      setSaving]      = useState(false);

  // Default-conflict warning dialog
  const [warnDialog, setWarnDialog] = useState<{
    payload: Record<string, unknown>;
    isEdit:  boolean;
    id?:     number;
    message: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function sortedRules(list: SlotRuleRow[]) {
    return [...list].sort((a, b) => {
      const dtCmp = a.deliveryType.name.localeCompare(b.deliveryType.name);
      return dtCmp !== 0 ? dtCmp : a.sortOrder - b.sortOrder;
    });
  }

  // Group sorted rules by deliveryTypeId
  function grouped(list: SlotRuleRow[]) {
    const sorted = sortedRules(list);
    const groups: { deliveryType: DeliveryType; rows: SlotRuleRow[] }[] = [];
    for (const row of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.deliveryType.id === row.deliveryTypeId) {
        last.rows.push(row);
      } else {
        groups.push({ deliveryType: row.deliveryType, rows: [row] });
      }
    }
    return groups;
  }

  // ── Sheet ──────────────────────────────────────────────────────────────────

  function openAdd() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, deliveryTypeId: deliveryTypes[0]?.id.toString() ?? "" });
    setFieldErrors({});
    setSheetOpen(true);
  }

  function openEdit(r: SlotRuleRow) {
    setEditTarget(r);
    setForm(buildForm(r));
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
    if (!form.deliveryTypeId) errs.deliveryTypeId = "Delivery type is required.";
    if (!form.slotId)         errs.slotId = "Slot is required.";
    if (!form.sortOrder || isNaN(parseInt(form.sortOrder, 10)) || parseInt(form.sortOrder, 10) < 1) {
      errs.sortOrder = "Sort order must be a positive integer.";
    }
    if (form.slotRuleType === "time_based") {
      if (!form.windowStart || !/^\d{2}:\d{2}$/.test(form.windowStart))
        errs.windowStart = "Required, HH:MM format.";
      if (!form.windowEnd || !/^\d{2}:\d{2}$/.test(form.windowEnd))
        errs.windowEnd = "Required, HH:MM format.";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Build request payload ──────────────────────────────────────────────────

  function buildPayload(force = false): Record<string, unknown> {
    const isEdit  = !!editTarget;
    const payload: Record<string, unknown> = {
      slotRuleType: form.slotRuleType,
      windowStart:  form.slotRuleType === "time_based" ? form.windowStart : null,
      windowEnd:    form.slotRuleType === "time_based" ? form.windowEnd   : null,
      isDefault:    form.isDefault,
      sortOrder:    parseInt(form.sortOrder, 10),
      isActive:     form.isActive,
    };
    if (!isEdit) {
      payload.deliveryTypeId = parseInt(form.deliveryTypeId, 10);
      payload.slotId         = parseInt(form.slotId, 10);
    }
    if (force) payload.forceDefault = true;
    return payload;
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function submitPayload(payload: Record<string, unknown>, isEdit: boolean, id?: number) {
    const url    = isEdit ? `/api/admin/slot-rules/${id}` : "/api/admin/slot-rules";
    const method = isEdit ? "PATCH" : "POST";
    const res    = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { res, data: await res.json() };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const { res, data } = await submitPayload(buildPayload(), !!editTarget, editTarget?.id);

      if (!res.ok) {
        if (res.status === 409 && data.warning) {
          setWarnDialog({
            payload: buildPayload(),
            isEdit:  !!editTarget,
            id:      editTarget?.id,
            message: data.message,
          });
          return;
        }
        if (res.status === 409) {
          toast.error(data.error ?? "Duplicate delivery type + slot combination.");
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }

      applyUpdate(data);
      setSheetOpen(false);
      toast.success(editTarget ? "Rule updated." : "Rule created.");
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Force save after warning confirmed ────────────────────────────────────

  async function handleForceDefault() {
    if (!warnDialog) return;
    setConfirming(true);
    try {
      const { res, data } = await submitPayload(
        { ...warnDialog.payload, forceDefault: true },
        warnDialog.isEdit,
        warnDialog.id
      );
      if (!res.ok) { toast.error(data.error ?? "Failed to save."); return; }
      applyUpdate(data);
      setWarnDialog(null);
      setSheetOpen(false);
      toast.success("Rule saved. Previous default cleared.");
    } catch {
      toast.error("Network error.");
    } finally {
      setConfirming(false);
    }
  }

  // ── Merge update into local state ─────────────────────────────────────────

  function applyUpdate(updated: SlotRuleRow) {
    setRules((prev) => {
      // If we forced a new default, clear the old one in local state
      const cleared = prev.map((r) =>
        r.id !== updated.id &&
        r.deliveryTypeId === updated.deliveryTypeId &&
        r.isDefault &&
        updated.isDefault
          ? { ...r, isDefault: false }
          : r
      );
      const exists = cleared.some((r) => r.id === updated.id);
      return exists
        ? cleared.map((r) => (r.id === updated.id ? updated : r))
        : [...cleared, updated];
    });
  }

  // ── Quick active toggle ────────────────────────────────────────────────────

  async function handleToggle(rule: SlotRuleRow) {
    try {
      const res  = await fetch(`/api/admin/slot-rules/${rule.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ isActive: !rule.isActive }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to update."); return; }
      setRules((prev) => prev.map((r) => (r.id === rule.id ? data : r)));
      toast.success(data.isActive ? "Rule activated." : "Rule deactivated.");
    } catch {
      toast.error("Network error.");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const tableGroups = grouped(rules);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-teal-700">Slot Rules</h1>
        <Button size="sm" onClick={openAdd} className="oa-btn-primary">+ Add Rule</Button>
      </div>

      <div className="oa-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Delivery Type</TableHead>
              <TableHead>Slot</TableHead>
              <TableHead>Rule Type</TableHead>
              <TableHead>Window Start</TableHead>
              <TableHead>Window End</TableHead>
              <TableHead className="text-center">Default</TableHead>
              <TableHead className="text-center">Sort</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableGroups.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                  No slot rules configured yet.
                </TableCell>
              </TableRow>
            )}
            {tableGroups.map(({ deliveryType, rows }) => (
              <>
                {/* Delivery type group header */}
                <TableRow key={`hdr-${deliveryType.id}`} className="bg-gray-50 hover:bg-gray-50">
                  <TableCell
                    colSpan={9}
                    className="py-1.5 px-4 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {deliveryType.name}
                  </TableCell>
                </TableRow>

                {/* Rule rows */}
                {rows.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="text-gray-400 text-xs pl-6">—</TableCell>
                    <TableCell>
                      <div>
                        <span className="text-sm font-medium text-gray-800">{rule.slot.name}</span>
                        <span className="ml-1.5 font-mono text-xs text-gray-400">{rule.slot.slotTime}</span>
                        {rule.slot.isNextDay && (
                          <Badge variant="outline" className="ml-1.5 text-[10px] bg-amber-50 text-amber-700 border-amber-200 py-0">
                            +1
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          rule.slotRuleType === "time_based"
                            ? "text-xs bg-blue-50 text-blue-700 border-blue-200"
                            : "text-xs bg-gray-50 text-gray-600 border-gray-200"
                        }
                      >
                        {rule.slotRuleType === "time_based" ? "Time Based" : "Default"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-gray-600">
                      {rule.windowStart ?? <span className="text-gray-300">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-gray-600">
                      {rule.windowEnd ?? <span className="text-gray-300">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {rule.isDefault ? (
                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-300">
                          ★ Default
                        </Badge>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm text-gray-500">
                      {rule.sortOrder}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={rule.isActive ? "default" : "secondary"}>
                        {rule.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(rule)} className="oa-btn-ghost">Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => handleToggle(rule)} className="oa-btn-ghost">
                          {rule.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Add / Edit Sheet ───────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? "Edit Slot Rule" : "Add Slot Rule"}</SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSave} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
            {/* Delivery Type */}
            <div className="space-y-1.5">
              <Label>Delivery Type <span className="text-destructive">*</span></Label>
              {editTarget ? (
                <p className="text-sm font-medium text-gray-700 px-3 py-2 rounded-md bg-gray-50 border">
                  {editTarget.deliveryType.name}
                </p>
              ) : (
                <>
                  <Select
                    value={form.deliveryTypeId}
                    onValueChange={(v) => setField("deliveryTypeId", v ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select delivery type" />
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
                </>
              )}
            </div>

            {/* Slot */}
            <div className="space-y-1.5">
              <Label>Slot <span className="text-destructive">*</span></Label>
              {editTarget ? (
                <p className="text-sm font-medium text-gray-700 px-3 py-2 rounded-md bg-gray-50 border">
                  {editTarget.slot.name} <span className="font-mono text-gray-400">{editTarget.slot.slotTime}</span>
                </p>
              ) : (
                <>
                  <Select
                    value={form.slotId}
                    onValueChange={(v) => setField("slotId", v ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select slot" />
                    </SelectTrigger>
                    <SelectContent>
                      {slots.map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>
                          {s.name} — {s.slotTime}{s.isNextDay ? " (+1)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldErrors.slotId && (
                    <p className="text-xs text-destructive">{fieldErrors.slotId}</p>
                  )}
                </>
              )}
            </div>

            {/* Rule Type */}
            <div className="space-y-2">
              <Label>Rule Type <span className="text-destructive">*</span></Label>
              <div className="flex gap-3">
                {(["time_based", "default"] as const).map((type) => (
                  <label
                    key={type}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                      form.slotRuleType === type
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      checked={form.slotRuleType === type}
                      onChange={() => {
                        setField("slotRuleType", type);
                        if (type === "default") {
                          setField("windowStart", "");
                          setField("windowEnd", "");
                        }
                      }}
                    />
                    {type === "time_based" ? "Time Based" : "Default"}
                  </label>
                ))}
              </div>
            </div>

            {/* Window Start / End (time_based only) */}
            {form.slotRuleType === "time_based" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Window Start <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.windowStart}
                    onChange={(e) => setField("windowStart", e.target.value)}
                    placeholder="HH:MM"
                    className="font-mono"
                  />
                  {fieldErrors.windowStart && (
                    <p className="text-xs text-destructive">{fieldErrors.windowStart}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Window End <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.windowEnd}
                    onChange={(e) => setField("windowEnd", e.target.value)}
                    placeholder="HH:MM"
                    className="font-mono"
                  />
                  {fieldErrors.windowEnd && (
                    <p className="text-xs text-destructive">{fieldErrors.windowEnd}</p>
                  )}
                </div>
              </div>
            )}

            {/* Sort Order */}
            <div className="space-y-1.5">
              <Label>Sort Order <span className="text-destructive">*</span></Label>
              <Input
                type="number" min="1" step="1"
                value={form.sortOrder}
                onChange={(e) => setField("sortOrder", e.target.value)}
                placeholder="Evaluation order for time_based rules"
              />
              {fieldErrors.sortOrder && (
                <p className="text-xs text-destructive">{fieldErrors.sortOrder}</p>
              )}
            </div>

            {/* Is Default */}
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Fallback Default</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Fallback slot when no time window matches
                </p>
              </div>
              <Switch
                checked={form.isDefault}
                onCheckedChange={(v) => setField("isDefault", v)}
              />
            </div>

            {/* Is Active */}
            <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-[#e5e7eb] bg-gray-50">
              <div>
                <div className="text-sm font-medium text-gray-900">Active</div>
                <div className="text-xs text-gray-500 mt-0.5">Inactive rules are excluded from slot matching</div>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setField("isActive", v)}
                className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-gray-300"
              />
            </div>

            <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
              <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-gray-700 hover:bg-gray-50 rounded-lg oa-btn-ghost" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="flex-1 h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editTarget ? "Save Changes" : "Create Rule"}</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Duplicate default warning dialog ──────────────────────────────── */}
      <Dialog open={!!warnDialog} onOpenChange={(o) => { if (!o) setWarnDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace Existing Default?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">{warnDialog?.message}</p>
          <p className="text-sm text-gray-500 mt-1">
            Only one default is allowed per delivery type. The existing default will be cleared.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setWarnDialog(null)} disabled={confirming} className="oa-btn-ghost">
              Cancel
            </Button>
            <Button onClick={handleForceDefault} disabled={confirming} className="oa-btn-danger">
              {confirming ? "Saving…" : "Replace Default"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
