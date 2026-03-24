"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface AreaOption         { id: number; name: string }
export interface SubAreaOption      { id: number; name: string; areaId: number }
export interface SalesOfficerOption { id: number; name: string }
export interface RouteOption        { id: number; name: string }
export interface DeliveryTypeOption { id: number; name: string }
export interface SOGroupOption      { id: number; name: string; salesOfficer: { name: string } }
export interface ContactRoleOption  { id: number; name: string }
export interface CustomerTypeOption { id: number; name: string }
export interface PremisesTypeOption { id: number; name: string }

export interface ContactDraft {
  _key:          string;
  id?:           number;
  name:          string;
  phone:         string;
  email:         string;
  isPrimary:     boolean;
  contactRoleId: string;
}

export interface CustomerFull {
  id:                    number;
  customerCode:          string;
  customerName:          string;
  address:               string | null;
  areaId:                number;
  subAreaId:             number | null;
  salesOfficerId:        number | null;
  primaryRouteId:        number | null;
  dispatchDeliveryTypeId:  number | null;
  reportingDeliveryTypeId: number | null;
  customerTypeId:          number | null;
  premisesTypeId:          number | null;
  salesOfficerGroupId:     number | null;
  customerRating:        string | null;
  latitude:              number | null;
  longitude:             number | null;
  isKeyCustomer:         boolean;
  isKeySite:             boolean;
  acceptsPartialDelivery: boolean;
  isActive:              boolean;
  workingHoursStart:     string | null;
  workingHoursEnd:       string | null;
  noDeliveryDays:        string[];
  contacts: {
    id:            number;
    name:          string;
    phone:         string | null;
    email:         string | null;
    isPrimary:     boolean;
    contactRoleId: number | null;
  }[];
}

interface CustomerSheetProps {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  editing:        CustomerFull | null;
  areas:          AreaOption[];
  subAreas:       SubAreaOption[];
  salesOfficers:  SalesOfficerOption[];
  routes:         RouteOption[];
  deliveryTypes:  DeliveryTypeOption[];
  soGroups:       SOGroupOption[];
  contactRoles:   ContactRoleOption[];
  customerTypes:  CustomerTypeOption[];
  premisesTypes:  PremisesTypeOption[];
  onSaved:        (customer: CustomerFull) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const RATING_STYLES: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-amber-100 text-amber-800 border-amber-300",
  C: "bg-red-100 text-red-800 border-red-300",
};

function newContact(): ContactDraft {
  return { _key: `${Date.now()}-${Math.random()}`, name: "", phone: "", email: "", isPrimary: false, contactRoleId: "" };
}

function buildInitialForm(editing: CustomerFull | null) {
  if (!editing) {
    return {
      customerCode:          "",
      customerName:          "",
      address:               "",
      areaId:                "",
      subAreaId:             "",
      salesOfficerId:        "",
      primaryRouteId:        "",
      dispatchDeliveryTypeId:  "",
      reportingDeliveryTypeId: "",
      customerTypeId:          "",
      premisesTypeId:          "",
      salesOfficerGroupId:     "",
      customerRating:        "",
      latitude:              "",
      longitude:             "",
      isKeyCustomer:         false,
      isKeySite:             false,
      acceptsPartialDelivery: true,
      isActive:              true,
      workingHoursStart:     "",
      workingHoursEnd:       "",
      noDeliveryDays:        [] as string[],
      contacts:              [] as ContactDraft[],
    };
  }
  return {
    customerCode:          editing.customerCode,
    customerName:          editing.customerName,
    address:               editing.address ?? "",
    areaId:                editing.areaId.toString(),
    subAreaId:             editing.subAreaId?.toString() ?? "",
    salesOfficerId:        editing.salesOfficerId?.toString() ?? "",
    primaryRouteId:        editing.primaryRouteId?.toString() ?? "",
    dispatchDeliveryTypeId:  editing.dispatchDeliveryTypeId?.toString()  ?? "",
    reportingDeliveryTypeId: editing.reportingDeliveryTypeId?.toString() ?? "",
    customerTypeId:          editing.customerTypeId?.toString()          ?? "",
    premisesTypeId:          editing.premisesTypeId?.toString()          ?? "",
    salesOfficerGroupId:     editing.salesOfficerGroupId?.toString()     ?? "",
    customerRating:        editing.customerRating ?? "",
    latitude:              editing.latitude?.toString() ?? "",
    longitude:             editing.longitude?.toString() ?? "",
    isKeyCustomer:         editing.isKeyCustomer,
    isKeySite:             editing.isKeySite,
    acceptsPartialDelivery: editing.acceptsPartialDelivery,
    isActive:              editing.isActive,
    workingHoursStart:     editing.workingHoursStart ?? "",
    workingHoursEnd:       editing.workingHoursEnd ?? "",
    noDeliveryDays:        editing.noDeliveryDays,
    contacts:              editing.contacts.map((c) => ({
      _key:          `${c.id}`,
      id:            c.id,
      name:          c.name,
      phone:         c.phone ?? "",
      email:         c.email ?? "",
      isPrimary:     c.isPrimary,
      contactRoleId: c.contactRoleId?.toString() ?? "",
    })),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CustomerSheet({
  open, onOpenChange, editing,
  areas, subAreas, salesOfficers,
  routes, deliveryTypes, soGroups, contactRoles,
  customerTypes, premisesTypes,
  onSaved,
}: CustomerSheetProps) {
  const [form, setForm] = useState(() => buildInitialForm(editing));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setForm(buildInitialForm(editing)); setFieldErrors({}); }
  }, [open, editing]);

  const filteredSubAreas = subAreas.filter((s) => s.areaId === parseInt(form.areaId, 10));
  const selectedSOGroup  = soGroups.find((g) => g.id.toString() === form.salesOfficerGroupId);

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
    if (!form.areaId)              errs.areaId       = "Area is required.";
    if (form.latitude  && isNaN(parseFloat(form.latitude)))  errs.latitude  = "Must be a number.";
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
      customerCode:           form.customerCode.trim().toUpperCase(),
      customerName:           form.customerName.trim(),
      address:                form.address.trim() || null,
      areaId:                 parseInt(form.areaId, 10),
      subAreaId:              form.subAreaId             ? parseInt(form.subAreaId, 10)              : null,
      salesOfficerId:         form.salesOfficerId        ? parseInt(form.salesOfficerId, 10)         : null,
      primaryRouteId:         form.primaryRouteId        ? parseInt(form.primaryRouteId, 10)         : null,
      dispatchDeliveryTypeId:  form.dispatchDeliveryTypeId  ? parseInt(form.dispatchDeliveryTypeId, 10)  : null,
      reportingDeliveryTypeId: form.reportingDeliveryTypeId ? parseInt(form.reportingDeliveryTypeId, 10) : null,
      customerTypeId:          form.customerTypeId          ? parseInt(form.customerTypeId, 10)          : null,
      premisesTypeId:          form.premisesTypeId          ? parseInt(form.premisesTypeId, 10)          : null,
      salesOfficerGroupId:     form.salesOfficerGroupId     ? parseInt(form.salesOfficerGroupId, 10)     : null,
      customerRating:         form.customerRating || null,
      latitude:               form.latitude  ? parseFloat(form.latitude)  : null,
      longitude:              form.longitude ? parseFloat(form.longitude) : null,
      isKeyCustomer:          form.isKeyCustomer,
      isKeySite:              form.isKeySite,
      acceptsPartialDelivery: form.acceptsPartialDelivery,
      isActive:               form.isActive,
      workingHoursStart:      form.workingHoursStart || null,
      workingHoursEnd:        form.workingHoursEnd   || null,
      noDeliveryDays:         form.noDeliveryDays,
      contacts: form.contacts.map(({ _key, contactRoleId, ...c }) => ({
        ...c,
        phone:         c.phone || null,
        email:         c.email || null,
        contactRoleId: contactRoleId ? parseInt(contactRoleId, 10) : null,
      })),
    };

    try {
      const url    = editing ? `/api/admin/customers/${editing.id}` : "/api/admin/customers";
      const method = editing ? "PATCH" : "POST";
      const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data   = await res.json();
      if (!res.ok) {
        if (res.status === 409) { setFieldErrors({ customerCode: "Customer code already exists." }); }
        else { toast.error(data.error ?? "Failed to save."); }
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
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit Customer" : "Add Customer"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">

          {/* ── Section 1: Identity ─────────────────────────────────────────── */}
          <div>
            <p className="oa-form-section">Identity</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-code">Customer Code</Label>
                <Input
                  id="c-code"
                  value={form.customerCode}
                  onChange={(e) => setField("customerCode", e.target.value.toUpperCase())}
                  placeholder="e.g. CUST001"
                />
                {fieldErrors.customerCode && <p className="text-xs text-destructive">{fieldErrors.customerCode}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Customer Name</Label>
                <Input
                  id="c-name"
                  value={form.customerName}
                  onChange={(e) => setField("customerName", e.target.value)}
                />
                {fieldErrors.customerName && <p className="text-xs text-destructive">{fieldErrors.customerName}</p>}
              </div>
            </div>
            <div className="space-y-1.5 mt-4">
              <Label htmlFor="c-address">Address</Label>
              <Textarea
                id="c-address"
                rows={3}
                value={form.address}
                onChange={(e) => setField("address", e.target.value)}
                placeholder={"Enter address with line breaks e.g.\nShop No. 12, Varacha Main Road\nNear Hirabaug Circle\nSurat - 395006, Gujarat"}
              />
            </div>
          </div>

          <div className="oa-sheet-divider" />

          {/* ── Section 2: Location ─────────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="oa-form-section">Location</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-area">Area <span className="text-destructive">*</span></Label>
                <Select value={form.areaId} onValueChange={handleAreaChange}>
                  <SelectTrigger id="c-area"><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    {areas.map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.areaId && <p className="text-xs text-destructive">{fieldErrors.areaId}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-subarea">Sub-Area</Label>
                <Select
                  value={form.subAreaId}
                  onValueChange={(v) => setField("subAreaId", !v || v === "none" ? "" : v)}
                  disabled={!form.areaId || filteredSubAreas.length === 0}
                >
                  <SelectTrigger id="c-subarea"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {filteredSubAreas.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Route Override</Label>
                <Select
                  value={form.primaryRouteId}
                  onValueChange={(v) => setField("primaryRouteId", !v || v === "none" ? "" : v)}
                >
                  <SelectTrigger><SelectValue placeholder="Use area default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Use area default</SelectItem>
                    {routes.map((r) => (
                      <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400">Overrides the area&apos;s default route for this customer only</p>
              </div>
              <div className="space-y-1.5">
                <Label>Delivery Type Override</Label>
                <Select
                  value={form.dispatchDeliveryTypeId}
                  onValueChange={(v) => setField("dispatchDeliveryTypeId", !v || v === "none" ? "" : v)}
                >
                  <SelectTrigger><SelectValue placeholder="Use area default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Use area default</SelectItem>
                    {deliveryTypes.map((dt) => (
                      <SelectItem key={dt.id} value={dt.id.toString()}>{dt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400">Overrides the area&apos;s delivery type for this customer only</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-so">Sales Officer</Label>
              <Select
                value={form.salesOfficerId}
                onValueChange={(v) => setField("salesOfficerId", !v || v === "none" ? "" : v)}
              >
                <SelectTrigger id="c-so"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {salesOfficers.map((so) => (
                    <SelectItem key={so.id} value={so.id.toString()}>{so.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-lat">Latitude</Label>
                <Input
                  id="c-lat" type="number" step="any"
                  value={form.latitude}
                  onChange={(e) => setField("latitude", e.target.value)}
                  placeholder="Optional"
                />
                {fieldErrors.latitude && <p className="text-xs text-destructive">{fieldErrors.latitude}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-lng">Longitude</Label>
                <Input
                  id="c-lng" type="number" step="any"
                  value={form.longitude}
                  onChange={(e) => setField("longitude", e.target.value)}
                  placeholder="Optional"
                />
                {fieldErrors.longitude && <p className="text-xs text-destructive">{fieldErrors.longitude}</p>}
              </div>
            </div>
          </div>

          <div className="oa-sheet-divider" />

          {/* ── Section 3: Classification ────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="oa-form-section">Classification</p>

            <div className="space-y-1.5">
              <Label>Sales Officer Group</Label>
              <Select
                value={form.salesOfficerGroupId}
                onValueChange={(v) => setField("salesOfficerGroupId", !v || v === "none" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {soGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSOGroup ? (
                <p className="text-xs text-slate-500">
                  Sales Officer: <span className="font-medium text-slate-700">{selectedSOGroup.salesOfficer.name}</span>
                </p>
              ) : (
                <p className="text-xs text-slate-400">Customer&apos;s portfolio group. SO is derived from the group.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Customer Rating (A/B/C)</Label>
              <div className="flex items-center gap-2">
                {(["A", "B", "C"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setField("customerRating", form.customerRating === r ? "" : r)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                      form.customerRating === r
                        ? RATING_STYLES[r]
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {r}
                  </button>
                ))}
                {form.customerRating && (
                  <button
                    type="button"
                    onClick={() => setField("customerRating", "")}
                    className="text-xs text-slate-400 underline ml-1"
                  >
                    clear
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400">
                A = High-value · B = Regular · C = Low-frequency. Set by Admin only.
              </p>
            </div>
          </div>

          <div className="oa-sheet-divider" />

          {/* ── Section 4: Flags ─────────────────────────────────────────────── */}
          <div>
            <p className="oa-form-section">Flags</p>
            <div className="flex flex-col gap-3">
              {(
                [
                  { key: "isKeyCustomer",         label: "Key Customer",     desc: "Prioritised in dispatch planning" },
                  { key: "isKeySite",             label: "Key Site",         desc: "High-priority delivery site" },
                  { key: "acceptsPartialDelivery", label: "Partial Delivery", desc: "Can receive split or partial orders" },
                  { key: "isActive",              label: "Active",           desc: "This record is active and visible" },
                ] as const
              ).map(({ key, label, desc }) => (
                <label key={key} className="flex items-center justify-between p-3 rounded-lg border border-[#e5e7eb] bg-[#f7f8fa] cursor-pointer hover:bg-[#eef2ff] hover:border-[#c7d2fe] transition-all">
                  <div>
                    <div className="text-sm font-medium text-[#111827]">{label}</div>
                    <div className="text-xs text-[#6b7280] mt-0.5">{desc}</div>
                  </div>
                  <Switch
                    checked={form[key]}
                    onCheckedChange={(v) => setField(key, v)}
                    className="data-[state=checked]:bg-[#1a237e]"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="oa-sheet-divider" />

          {/* ── Section 5: Delivery Constraints ──────────────────────────────── */}
          <div>
            <p className="oa-form-section">Delivery Constraints</p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-whs">Working Hours Start</Label>
                <Input id="c-whs" type="time" value={form.workingHoursStart} onChange={(e) => setField("workingHoursStart", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-whe">Working Hours End</Label>
                <Input id="c-whe" type="time" value={form.workingHoursEnd} onChange={(e) => setField("workingHoursEnd", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>No Delivery Days</Label>
              <div className="flex flex-row flex-nowrap gap-4 mt-2">
                {DAYS.map((day) => (
                  <label key={day} className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap min-w-fit">
                    <input
                      type="checkbox"
                      checked={form.noDeliveryDays.includes(day)}
                      onChange={() => toggleDay(day)}
                      className="w-3.5 h-3.5 accent-[#1a237e]"
                    />
                    <span className="text-xs font-medium text-[#374151]">{day}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="oa-sheet-divider" />

          {/* ── Section 6: Contacts ──────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="oa-form-section" style={{ marginBottom: 0, borderBottom: "none" }}>Contacts</p>
              <Button type="button" size="sm" variant="outline" className="oa-btn-ghost" onClick={addContact}>+ Add Contact</Button>
            </div>
            {fieldErrors.contacts && <p className="text-xs text-destructive mb-2">{fieldErrors.contacts}</p>}
            {form.contacts.length === 0 && <p className="text-sm text-slate-400">No contacts added.</p>}
            <div className="flex flex-col gap-3">
              {form.contacts.map((contact) => (
                <div key={contact._key} className="rounded-md border p-3 bg-slate-50 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Select
                        value={contact.contactRoleId}
                        onValueChange={(v) => updateContact(contact._key, "contactRoleId", !v || v === "none" ? "" : v)}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Role (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No role</SelectItem>
                          {contactRoles.map((r) => (
                            <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      placeholder="Name *"
                      value={contact.name}
                      onChange={(e) => updateContact(contact._key, "name", e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Phone"
                      value={contact.phone}
                      onChange={(e) => updateContact(contact._key, "phone", e.target.value)}
                    />
                    <Input
                      placeholder="Email"
                      type="email"
                      value={contact.email}
                      onChange={(e) => updateContact(contact._key, "email", e.target.value)}
                    />
                  </div>
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
                      type="button" size="sm" variant="ghost"
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

          <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
            <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-[#374151] hover:bg-[#f7f8fa] rounded-lg oa-btn-ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" className="flex-1 h-10 text-sm bg-[#1a237e] hover:bg-[#283593] text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Customer"}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
