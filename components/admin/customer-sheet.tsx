"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface AreaOption { id: number; name: string }
export interface SubAreaOption { id: number; name: string; areaId: number }

export interface ContactDraft {
  _key: string;
  id?: number;
  name: string;
  phone: string;
  email: string;
  isPrimary: boolean;
}

export interface CustomerFull {
  id: number;
  customerCode: string;
  customerName: string;
  areaId: number;
  subAreaId: number | null;
  latitude: number | null;
  longitude: number | null;
  isKeyCustomer: boolean;
  isKeySite: boolean;
  isActive: boolean;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  noDeliveryDays: string[];
  contacts: { id: number; name: string; phone: string | null; email: string | null; isPrimary: boolean }[];
}

interface CustomerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CustomerFull | null;
  areas: AreaOption[];
  subAreas: SubAreaOption[];
  onSaved: (customer: CustomerFull) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function newContact(): ContactDraft {
  return { _key: `${Date.now()}-${Math.random()}`, name: "", phone: "", email: "", isPrimary: false };
}

function buildInitialForm(editing: CustomerFull | null) {
  if (!editing) {
    return {
      customerCode: "",
      customerName: "",
      areaId: "",
      subAreaId: "",
      latitude: "",
      longitude: "",
      isKeyCustomer: false,
      isKeySite: false,
      isActive: true,
      workingHoursStart: "",
      workingHoursEnd: "",
      noDeliveryDays: [] as string[],
      contacts: [] as ContactDraft[],
    };
  }
  return {
    customerCode: editing.customerCode,
    customerName: editing.customerName,
    areaId: editing.areaId.toString(),
    subAreaId: editing.subAreaId?.toString() ?? "",
    latitude: editing.latitude?.toString() ?? "",
    longitude: editing.longitude?.toString() ?? "",
    isKeyCustomer: editing.isKeyCustomer,
    isKeySite: editing.isKeySite,
    isActive: editing.isActive,
    workingHoursStart: editing.workingHoursStart ?? "",
    workingHoursEnd: editing.workingHoursEnd ?? "",
    noDeliveryDays: editing.noDeliveryDays,
    contacts: editing.contacts.map((c) => ({
      _key: `${c.id}`,
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      isPrimary: c.isPrimary,
    })),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CustomerSheet({ open, onOpenChange, editing, areas, subAreas, onSaved }: CustomerSheetProps) {
  const [form, setForm] = useState(() => buildInitialForm(editing));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Reset form when sheet opens/editing changes
  useEffect(() => {
    if (open) {
      setForm(buildInitialForm(editing));
      setFieldErrors({});
    }
  }, [open, editing]);

  const filteredSubAreas = subAreas.filter((s) => s.areaId === parseInt(form.areaId, 10));

  // ── Form helpers ───────────────────────────────────────────────────────────
  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function handleAreaChange(val: string | null) {
    setForm((prev) => ({ ...prev, areaId: val ?? "", subAreaId: "" }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n.areaId; return n; });
  }

  function toggleDay(day: string) {
    setForm((prev) => ({
      ...prev,
      noDeliveryDays: prev.noDeliveryDays.includes(day)
        ? prev.noDeliveryDays.filter((d) => d !== day)
        : [...prev.noDeliveryDays, day],
    }));
  }

  // ── Contact helpers ────────────────────────────────────────────────────────
  function addContact() {
    setForm((prev) => ({ ...prev, contacts: [...prev.contacts, newContact()] }));
  }

  function removeContact(key: string) {
    setForm((prev) => ({ ...prev, contacts: prev.contacts.filter((c) => c._key !== key) }));
  }

  function updateContact(key: string, field: keyof ContactDraft, value: string | boolean) {
    setForm((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c) => (c._key !== key ? c : { ...c, [field]: value })),
    }));
  }

  function setPrimary(key: string) {
    setForm((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c) => ({ ...c, isPrimary: c._key === key })),
    }));
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.customerCode.trim()) errs.customerCode = "Customer code is required.";
    if (!form.customerName.trim()) errs.customerName = "Customer name is required.";
    if (!form.areaId) errs.areaId = "Area is required.";
    if (form.latitude && isNaN(parseFloat(form.latitude))) errs.latitude = "Must be a number.";
    if (form.longitude && isNaN(parseFloat(form.longitude))) errs.longitude = "Must be a number.";
    for (const c of form.contacts) {
      if (!c.name.trim()) { errs.contacts = "All contacts must have a name."; break; }
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);

    const body = {
      customerCode: form.customerCode.trim().toUpperCase(),
      customerName: form.customerName.trim(),
      areaId: parseInt(form.areaId, 10),
      subAreaId: form.subAreaId ? parseInt(form.subAreaId, 10) : null,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      isKeyCustomer: form.isKeyCustomer,
      isKeySite: form.isKeySite,
      isActive: form.isActive,
      workingHoursStart: form.workingHoursStart || null,
      workingHoursEnd: form.workingHoursEnd || null,
      noDeliveryDays: form.noDeliveryDays,
      contacts: form.contacts.map(({ _key, ...c }) => ({
        ...c,
        phone: c.phone || null,
        email: c.email || null,
      })),
    };

    try {
      const url = editing ? `/api/admin/customers/${editing.id}` : "/api/admin/customers";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ customerCode: "Customer code already exists." });
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }
      toast.success(editing ? "Customer updated." : `Customer "${data.customerName}" created.`);
      onSaved(data);
      onOpenChange(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit Customer" : "Add Customer"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6 py-4">

          {/* ── Section 1: Identity ── */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-3">Identity</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-code">Customer Code</Label>
                <Input
                  id="c-code"
                  value={form.customerCode}
                  onChange={(e) => setField("customerCode", e.target.value.toUpperCase())}
                  placeholder="e.g. CUST001"
                />
                {fieldErrors.customerCode && (
                  <p className="text-xs text-destructive">{fieldErrors.customerCode}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Customer Name</Label>
                <Input
                  id="c-name"
                  value={form.customerName}
                  onChange={(e) => setField("customerName", e.target.value)}
                />
                {fieldErrors.customerName && (
                  <p className="text-xs text-destructive">{fieldErrors.customerName}</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Section 2: Location ── */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-3">Location</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-area">Area</Label>
                <Select value={form.areaId} onValueChange={handleAreaChange}>
                  <SelectTrigger id="c-area">
                    <SelectValue placeholder="Select area" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.areaId && (
                  <p className="text-xs text-destructive">{fieldErrors.areaId}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-subarea">Sub-Area</Label>
                <Select
                  value={form.subAreaId}
                  onValueChange={(v) => setField("subAreaId", !v || v === "none" ? "" : v)}
                  disabled={!form.areaId || filteredSubAreas.length === 0}
                >
                  <SelectTrigger id="c-subarea">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {filteredSubAreas.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-lat">Latitude</Label>
                <Input
                  id="c-lat"
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => setField("latitude", e.target.value)}
                  placeholder="Optional"
                />
                {fieldErrors.latitude && (
                  <p className="text-xs text-destructive">{fieldErrors.latitude}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-lng">Longitude</Label>
                <Input
                  id="c-lng"
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => setField("longitude", e.target.value)}
                  placeholder="Optional"
                />
                {fieldErrors.longitude && (
                  <p className="text-xs text-destructive">{fieldErrors.longitude}</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Section 3: Flags ── */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-3">Flags</p>
            <div className="flex flex-col gap-3">
              {(
                [
                  { key: "isKeyCustomer", label: "Key Customer" },
                  { key: "isKeySite", label: "Key Site" },
                  { key: "isActive", label: "Active" },
                ] as const
              ).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer select-none text-sm">
                  <Checkbox
                    checked={form[key]}
                    onCheckedChange={(v) => setField(key, Boolean(v))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <Separator />

          {/* ── Section 4: Delivery Constraints ── */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-3">Delivery Constraints</p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-whs">Working Hours Start</Label>
                <Input
                  id="c-whs"
                  type="time"
                  value={form.workingHoursStart}
                  onChange={(e) => setField("workingHoursStart", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-whe">Working Hours End</Label>
                <Input
                  id="c-whe"
                  type="time"
                  value={form.workingHoursEnd}
                  onChange={(e) => setField("workingHoursEnd", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>No Delivery Days</Label>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((day) => (
                  <label key={day} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                    <Checkbox
                      checked={form.noDeliveryDays.includes(day)}
                      onCheckedChange={() => toggleDay(day)}
                    />
                    {day}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Section 5: Contacts ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">Contacts</p>
              <Button type="button" size="sm" variant="outline" onClick={addContact}>
                + Add Contact
              </Button>
            </div>
            {fieldErrors.contacts && (
              <p className="text-xs text-destructive mb-2">{fieldErrors.contacts}</p>
            )}
            {form.contacts.length === 0 && (
              <p className="text-sm text-slate-400">No contacts added.</p>
            )}
            <div className="flex flex-col gap-3">
              {form.contacts.map((contact) => (
                <div key={contact._key} className="rounded-md border p-3 bg-slate-50 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Name *"
                      value={contact.name}
                      onChange={(e) => updateContact(contact._key, "name", e.target.value)}
                    />
                    <Input
                      placeholder="Phone"
                      value={contact.phone}
                      onChange={(e) => updateContact(contact._key, "phone", e.target.value)}
                    />
                  </div>
                  <Input
                    placeholder="Email"
                    type="email"
                    value={contact.email}
                    onChange={(e) => updateContact(contact._key, "email", e.target.value)}
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <Checkbox
                        checked={contact.isPrimary}
                        onCheckedChange={(checked) => {
                          if (checked) setPrimary(contact._key);
                          else updateContact(contact._key, "isPrimary", false);
                        }}
                      />
                      Primary contact
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeContact(contact._key)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <SheetFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Customer"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
