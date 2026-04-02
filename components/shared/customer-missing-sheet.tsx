"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  SubAreaOption,
  SalesOfficerOption,
  RouteOption,
  DeliveryTypeOption,
  SOGroupOption,
  ContactRoleOption,
  ContactDraft,
} from "@/components/admin/customer-sheet";

// ── Props ──────────────────────────────────────────────────────────────────────

interface CustomerMissingSheetProps {
  open:               boolean;
  onOpenChange:       (open: boolean) => void;
  shipToCustomerId:   string | null | undefined;
  shipToCustomerName: string | null | undefined;
  onResolved:         () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const RATING_STYLES: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-amber-100 text-amber-800 border-amber-300",
  C: "bg-red-100 text-red-800 border-red-300",
};

const TABS = [
  "Basic info",
  "Location",
  "Routing & delivery",
  "Sales & classification",
  "Flags",
  "Delivery constraints",
  "Contacts",
] as const;
type Tab = typeof TABS[number];

// ── Helpers ────────────────────────────────────────────────────────────────────

function newContact(): ContactDraft {
  return {
    _key:          `${Date.now()}-${Math.random()}`,
    name:          "",
    phone:         "",
    email:         "",
    isPrimary:     false,
    contactRoleId: "",
  };
}

function emptyForm(initialCode?: string, initialName?: string) {
  return {
    customerCode:            initialCode ?? "",
    customerName:            initialName ?? "",
    address:                 "",
    areaId:                  "",
    subAreaId:               "",
    salesOfficerId:          "",
    primaryRouteId:          "",
    dispatchDeliveryTypeId:  "",
    reportingDeliveryTypeId: "",
    customerTypeId:          "",
    premisesTypeId:          "",
    salesOfficerGroupId:     "",
    customerRating:          "",
    latitude:                "",
    longitude:               "",
    isKeyCustomer:           false,
    isKeySite:               false,
    acceptsPartialDelivery:  true,
    isActive:                true,
    workingHoursStart:       "",
    workingHoursEnd:         "",
    noDeliveryDays:          [] as string[],
    contacts:                [] as ContactDraft[],
  };
}

// Extended area type — the /api/admin/areas endpoint returns deliveryType + primaryRoute
interface AreaFull {
  id:           number;
  name:         string;
  deliveryType: { id: number; name: string } | null;
  primaryRoute: { id: number; name: string } | null;
}

async function fetchAll<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    if (Array.isArray(json)) return json as T[];
    if (json && Array.isArray(json.data)) return json.data as T[];
    return [];
  } catch {
    return [];
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CustomerMissingSheet({
  open,
  onOpenChange,
  shipToCustomerId,
  shipToCustomerName,
  onResolved,
}: CustomerMissingSheetProps) {
  // ── Dropdown data ──────────────────────────────────────────────────────────
  const [areas,         setAreas]         = useState<AreaFull[]>([]);
  const [subAreas,      setSubAreas]      = useState<SubAreaOption[]>([]);
  const [salesOfficers, setSalesOfficers] = useState<SalesOfficerOption[]>([]);
  const [routes,        setRoutes]        = useState<RouteOption[]>([]);
  const [deliveryTypes, setDeliveryTypes] = useState<DeliveryTypeOption[]>([]);
  const [soGroups,      setSoGroups]      = useState<SOGroupOption[]>([]);
  const [contactRoles,  setContactRoles]  = useState<ContactRoleOption[]>([]);
  const [loaded,        setLoaded]        = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [activeTab,   setActiveTab]   = useState<Tab>("Basic info");
  const [form,        setForm]        = useState(() => emptyForm(shipToCustomerId ?? undefined, shipToCustomerName ?? undefined));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving,      setSaving]      = useState(false);

  // ── Load dropdown data once per open ──────────────────────────────────────
  useEffect(() => {
    if (!open || loaded) return;
    void (async () => {
      const [a, sa, so, r, dt, sog, cr] = await Promise.all([
        fetchAll<AreaFull>("/api/admin/areas"),
        fetchAll<SubAreaOption>("/api/admin/sub-areas?pageSize=9999"),
        fetchAll<SalesOfficerOption>("/api/admin/sales-officers?pageSize=9999"),
        fetchAll<RouteOption>("/api/admin/routes"),
        fetchAll<DeliveryTypeOption>("/api/admin/delivery-types"),
        fetchAll<SOGroupOption>("/api/admin/so-groups?pageSize=9999"),
        fetchAll<ContactRoleOption>("/api/admin/contact-roles"),
      ]);
      setAreas(a);
      setSubAreas(sa);
      setSalesOfficers(so);
      setRoutes(r);
      setDeliveryTypes(dt);
      setSoGroups(sog);
      setContactRoles(cr);
      setLoaded(true);
    })();
  }, [open, loaded]);

  // ── Reset on open/close ───────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setForm(emptyForm(shipToCustomerId ?? undefined, shipToCustomerName ?? undefined));
      setFieldErrors({});
      setActiveTab("Basic info");
    } else {
      setLoaded(false);
    }
  }, [open, shipToCustomerId, shipToCustomerName]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredSubAreas  = subAreas.filter((s) => s.areaId === parseInt(form.areaId, 10));
  const selectedSOGroup   = soGroups.find((g) => g.id.toString() === form.salesOfficerGroupId);
  const selectedAreaInfo  = areas.find((a) => a.id.toString() === form.areaId) ?? null;

  // Completion % — 10 meaningful fields, each worth 10 points
  const _completionFields = [
    form.customerCode.trim(),
    form.customerName.trim(),
    form.areaId,
    form.address.trim(),
    form.salesOfficerId,
    form.dispatchDeliveryTypeId,
    form.salesOfficerGroupId,
    form.customerRating,
    form.subAreaId,
    form.contacts.length > 0 ? "yes" : "",
  ];
  const completionPct = Math.round(_completionFields.filter(Boolean).length / _completionFields.length * 100);

  // ── Form helpers ──────────────────────────────────────────────────────────
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

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): Tab | null {
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
    if (Object.keys(errs).length === 0) return null;

    // Navigate to the first tab with an error
    if (errs.customerCode || errs.customerName) return "Basic info";
    if (errs.areaId || errs.latitude || errs.longitude) return "Location";
    if (errs.contacts) return "Contacts";
    return "Basic info";
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSave() {
    const errorTab = validate();
    if (errorTab) {
      setActiveTab(errorTab);
      return;
    }
    setSaving(true);

    const body = {
      customerCode:            form.customerCode.trim().toUpperCase(),
      customerName:            form.customerName.trim(),
      address:                 form.address.trim() || null,
      areaId:                  parseInt(form.areaId, 10),
      subAreaId:               form.subAreaId             ? parseInt(form.subAreaId, 10)             : null,
      salesOfficerId:          form.salesOfficerId        ? parseInt(form.salesOfficerId, 10)        : null,
      primaryRouteId:          form.primaryRouteId        ? parseInt(form.primaryRouteId, 10)        : null,
      dispatchDeliveryTypeId:  form.dispatchDeliveryTypeId  ? parseInt(form.dispatchDeliveryTypeId, 10)  : null,
      reportingDeliveryTypeId: form.reportingDeliveryTypeId ? parseInt(form.reportingDeliveryTypeId, 10) : null,
      customerTypeId:          form.customerTypeId          ? parseInt(form.customerTypeId, 10)          : null,
      premisesTypeId:          form.premisesTypeId          ? parseInt(form.premisesTypeId, 10)          : null,
      salesOfficerGroupId:     form.salesOfficerGroupId     ? parseInt(form.salesOfficerGroupId, 10)     : null,
      customerRating:          form.customerRating || null,
      latitude:                form.latitude  ? parseFloat(form.latitude)  : null,
      longitude:               form.longitude ? parseFloat(form.longitude) : null,
      isKeyCustomer:           form.isKeyCustomer,
      isKeySite:               form.isKeySite,
      acceptsPartialDelivery:  form.acceptsPartialDelivery,
      isActive:                form.isActive,
      workingHoursStart:       form.workingHoursStart || null,
      workingHoursEnd:         form.workingHoursEnd   || null,
      noDeliveryDays:          form.noDeliveryDays,
      contacts: form.contacts.map(({ _key, contactRoleId, ...c }) => ({
        ...c,
        phone:         c.phone || null,
        email:         c.email || null,
        contactRoleId: contactRoleId ? parseInt(contactRoleId, 10) : null,
      })),
    };

    try {
      const res  = await fetch("/api/admin/customers", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ customerCode: "Customer code already exists." });
          setActiveTab("Basic info");
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }
      toast.success(`Customer "${data.customerName}" created.`);
      onResolved();
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  // ── Tab error indicators ───────────────────────────────────────────────────
  const tabHasError: Record<Tab, boolean> = {
    "Basic info":            !!(fieldErrors.customerCode || fieldErrors.customerName),
    "Location":              !!(fieldErrors.areaId || fieldErrors.latitude || fieldErrors.longitude),
    "Routing & delivery":    false,
    "Sales & classification": false,
    "Flags":                 false,
    "Delivery constraints":  false,
    "Contacts":              !!fieldErrors.contacts,
  };

  // ── Tab content ────────────────────────────────────────────────────────────

  // 1. Basic info — mirrors customer-sheet.tsx in full (all sections)
  const basicInfoContent = (
    <div className="flex flex-col gap-5">

      {/* ── Section 1: Identity ───────────────────────────────────────────── */}
      <div>
        <p className="oa-form-section">Identity</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cm-code">Customer Code</Label>
            <Input
              id="cm-code"
              value={form.customerCode}
              onChange={(e) => setField("customerCode", e.target.value.toUpperCase())}
              placeholder="e.g. CUST001"
            />
            {fieldErrors.customerCode && <p className="text-xs text-destructive">{fieldErrors.customerCode}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-name">Customer Name</Label>
            <Input
              id="cm-name"
              value={form.customerName}
              onChange={(e) => setField("customerName", e.target.value)}
            />
            {fieldErrors.customerName && <p className="text-xs text-destructive">{fieldErrors.customerName}</p>}
          </div>
        </div>
        <div className="space-y-1.5 mt-4">
          <Label htmlFor="cm-address">Address</Label>
          <Textarea
            id="cm-address"
            rows={3}
            value={form.address}
            onChange={(e) => setField("address", e.target.value)}
            placeholder={"Enter address with line breaks e.g.\nShop No. 12, Varacha Main Road\nNear Hirabaug Circle\nSurat - 395006, Gujarat"}
          />
        </div>
      </div>

      <div className="oa-sheet-divider" />

      {/* ── Section 2: Location ───────────────────────────────────────────── */}
      <div className="space-y-4">
        <p className="oa-form-section">Location</p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cm-bi-area">Area <span className="text-destructive">*</span></Label>
            <Select value={form.areaId} onValueChange={handleAreaChange}>
              <SelectTrigger id="cm-bi-area"><SelectValue placeholder="Select area" /></SelectTrigger>
              <SelectContent>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.areaId && <p className="text-xs text-destructive">{fieldErrors.areaId}</p>}
            {selectedAreaInfo && (selectedAreaInfo.deliveryType || selectedAreaInfo.primaryRoute) && (
              <p className="text-xs text-gray-400">
                ↳ Area default:{" "}
                {[selectedAreaInfo.deliveryType?.name, selectedAreaInfo.primaryRoute?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-bi-subarea">Sub-Area</Label>
            <Select
              value={form.subAreaId}
              onValueChange={(v) => setField("subAreaId", !v || v === "none" ? "" : v)}
              disabled={!form.areaId || filteredSubAreas.length === 0}
            >
              <SelectTrigger id="cm-bi-subarea"><SelectValue placeholder="None" /></SelectTrigger>
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
            <p className="text-xs text-gray-400">Overrides the area&apos;s default route for this customer only</p>
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
            <p className="text-xs text-gray-400">Overrides the area&apos;s delivery type for this customer only</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cm-bi-so">Sales Officer</Label>
          <Select
            value={form.salesOfficerId}
            onValueChange={(v) => setField("salesOfficerId", !v || v === "none" ? "" : v)}
          >
            <SelectTrigger id="cm-bi-so"><SelectValue placeholder="None" /></SelectTrigger>
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
            <Label htmlFor="cm-bi-lat">Latitude</Label>
            <Input
              id="cm-bi-lat"
              type="number"
              step="any"
              value={form.latitude}
              onChange={(e) => setField("latitude", e.target.value)}
              placeholder="Optional"
            />
            {fieldErrors.latitude && <p className="text-xs text-destructive">{fieldErrors.latitude}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-bi-lng">Longitude</Label>
            <Input
              id="cm-bi-lng"
              type="number"
              step="any"
              value={form.longitude}
              onChange={(e) => setField("longitude", e.target.value)}
              placeholder="Optional"
            />
            {fieldErrors.longitude && <p className="text-xs text-destructive">{fieldErrors.longitude}</p>}
          </div>
        </div>
      </div>

      <div className="oa-sheet-divider" />

      {/* ── Section 3: Classification ─────────────────────────────────────── */}
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
            <p className="text-xs text-gray-500">
              Sales Officer: <span className="font-medium text-gray-700">{selectedSOGroup.salesOfficer.name}</span>
            </p>
          ) : (
            <p className="text-xs text-gray-400">Customer&apos;s portfolio group. SO is derived from the group.</p>
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
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {r}
              </button>
            ))}
            {form.customerRating && (
              <button
                type="button"
                onClick={() => setField("customerRating", "")}
                className="text-xs text-gray-400 underline ml-1"
              >
                clear
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">
            A = High-value · B = Regular · C = Low-frequency. Set by Admin only.
          </p>
        </div>
      </div>

      <div className="oa-sheet-divider" />

      {/* ── Section 4: Flags ──────────────────────────────────────────────── */}
      <div>
        <p className="oa-form-section">Flags</p>
        <div className="flex flex-col gap-3">
          {(
            [
              { key: "isKeyCustomer",          label: "Key Customer",     desc: "Prioritised in dispatch planning" },
              { key: "isKeySite",              label: "Key Site",         desc: "High-priority delivery site" },
              { key: "acceptsPartialDelivery", label: "Partial Delivery", desc: "Can receive split or partial orders" },
              { key: "isActive",               label: "Active",           desc: "This record is active and visible" },
            ] as const
          ).map(({ key, label, desc }) => (
            <label
              key={key}
              className="flex items-center justify-between p-3 rounded-lg border border-[#e5e7eb] bg-gray-50 cursor-pointer hover:bg-teal-50 hover:border-teal-200 transition-all"
            >
              <div>
                <div className="text-sm font-medium text-gray-900">{label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
              </div>
              <Switch
                checked={form[key]}
                onCheckedChange={(v) => setField(key, v)}
                className="data-[state=checked]:bg-teal-600"
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
            <Label htmlFor="cm-bi-whs">Working Hours Start</Label>
            <Input
              id="cm-bi-whs"
              type="time"
              value={form.workingHoursStart}
              onChange={(e) => setField("workingHoursStart", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-bi-whe">Working Hours End</Label>
            <Input
              id="cm-bi-whe"
              type="time"
              value={form.workingHoursEnd}
              onChange={(e) => setField("workingHoursEnd", e.target.value)}
            />
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
                  className="w-3.5 h-3.5 accent-teal-600"
                />
                <span className="text-xs font-medium text-gray-700">{day}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="oa-sheet-divider" />

      {/* ── Section 6: Contacts ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="oa-form-section" style={{ marginBottom: 0, borderBottom: "none" }}>Contacts</p>
          <Button type="button" size="sm" variant="outline" className="oa-btn-ghost" onClick={addContact}>
            + Add Contact
          </Button>
        </div>
        {fieldErrors.contacts && <p className="text-xs text-destructive mb-2">{fieldErrors.contacts}</p>}
        {form.contacts.length === 0 && <p className="text-sm text-gray-400">No contacts added.</p>}
        <div className="flex flex-col gap-3">
          {form.contacts.map((contact) => (
            <div key={contact._key} className="rounded-md border p-3 bg-gray-50 space-y-2">
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

    </div>
  );

  // 2. Location — mirrors customer-sheet.tsx Location: area/sub-area + lat/lng
  const locationContent = (
    <div className="space-y-4">
      <p className="oa-form-section">Location</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cm-area">Area <span className="text-destructive">*</span></Label>
          <Select value={form.areaId} onValueChange={handleAreaChange}>
            <SelectTrigger id="cm-area"><SelectValue placeholder="Select area" /></SelectTrigger>
            <SelectContent>
              {areas.map((a) => (
                <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.areaId && <p className="text-xs text-destructive">{fieldErrors.areaId}</p>}
          {selectedAreaInfo && (selectedAreaInfo.deliveryType || selectedAreaInfo.primaryRoute) && (
            <p className="text-xs text-gray-400">
              ↳ Area default:{" "}
              {[selectedAreaInfo.deliveryType?.name, selectedAreaInfo.primaryRoute?.name]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-subarea">Sub-Area</Label>
          <Select
            value={form.subAreaId}
            onValueChange={(v) => setField("subAreaId", !v || v === "none" ? "" : v)}
            disabled={!form.areaId || filteredSubAreas.length === 0}
          >
            <SelectTrigger id="cm-subarea"><SelectValue placeholder="None" /></SelectTrigger>
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
          <Label htmlFor="cm-lat">Latitude</Label>
          <Input
            id="cm-lat"
            type="number"
            step="any"
            value={form.latitude}
            onChange={(e) => setField("latitude", e.target.value)}
            placeholder="Optional"
          />
          {fieldErrors.latitude && <p className="text-xs text-destructive">{fieldErrors.latitude}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-lng">Longitude</Label>
          <Input
            id="cm-lng"
            type="number"
            step="any"
            value={form.longitude}
            onChange={(e) => setField("longitude", e.target.value)}
            placeholder="Optional"
          />
          {fieldErrors.longitude && <p className="text-xs text-destructive">{fieldErrors.longitude}</p>}
        </div>
      </div>
    </div>
  );

  // 3. Routing & delivery — mirrors customer-sheet.tsx Location: route + delivery type
  const routingContent = (
    <div className="space-y-4">
      <p className="oa-form-section">Routing &amp; Delivery</p>

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
          <p className="text-xs text-gray-400">Overrides the area&apos;s default route for this customer only</p>
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
          <p className="text-xs text-gray-400">Overrides the area&apos;s delivery type for this customer only</p>
        </div>
      </div>
    </div>
  );

  // 4. Sales & classification — mirrors customer-sheet.tsx Location (SO) + Section 3 (Classification)
  const salesContent = (
    <div className="space-y-4">
      <p className="oa-form-section">Sales &amp; Classification</p>

      <div className="space-y-1.5">
        <Label htmlFor="cm-so">Sales Officer</Label>
        <Select
          value={form.salesOfficerId}
          onValueChange={(v) => setField("salesOfficerId", !v || v === "none" ? "" : v)}
        >
          <SelectTrigger id="cm-so"><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {salesOfficers.map((so) => (
              <SelectItem key={so.id} value={so.id.toString()}>{so.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="oa-sheet-divider" />

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
          <p className="text-xs text-gray-500">
            Sales Officer: <span className="font-medium text-gray-700">{selectedSOGroup.salesOfficer.name}</span>
          </p>
        ) : (
          <p className="text-xs text-gray-400">Customer&apos;s portfolio group. SO is derived from the group.</p>
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
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {r}
            </button>
          ))}
          {form.customerRating && (
            <button
              type="button"
              onClick={() => setField("customerRating", "")}
              className="text-xs text-gray-400 underline ml-1"
            >
              clear
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400">
          A = High-value · B = Regular · C = Low-frequency. Set by Admin only.
        </p>
      </div>
    </div>
  );

  // 5. Flags — mirrors customer-sheet.tsx Section 4
  const flagsContent = (
    <div>
      <p className="oa-form-section">Flags</p>
      <div className="flex flex-col gap-3">
        {(
          [
            { key: "isKeyCustomer",          label: "Key Customer",     desc: "Prioritised in dispatch planning" },
            { key: "isKeySite",              label: "Key Site",         desc: "High-priority delivery site" },
            { key: "acceptsPartialDelivery", label: "Partial Delivery", desc: "Can receive split or partial orders" },
            { key: "isActive",               label: "Active",           desc: "This record is active and visible" },
          ] as const
        ).map(({ key, label, desc }) => (
          <label
            key={key}
            className="flex items-center justify-between p-3 rounded-lg border border-[#e5e7eb] bg-gray-50 cursor-pointer hover:bg-teal-50 hover:border-teal-200 transition-all"
          >
            <div>
              <div className="text-sm font-medium text-gray-900">{label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
            </div>
            <Switch
              checked={form[key]}
              onCheckedChange={(v) => setField(key, v)}
              className="data-[state=checked]:bg-teal-600"
            />
          </label>
        ))}
      </div>
    </div>
  );

  // 6. Delivery constraints — mirrors customer-sheet.tsx Section 5
  const deliveryConstraintsContent = (
    <div>
      <p className="oa-form-section">Delivery Constraints</p>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="space-y-1.5">
          <Label htmlFor="cm-whs">Working Hours Start</Label>
          <Input
            id="cm-whs"
            type="time"
            value={form.workingHoursStart}
            onChange={(e) => setField("workingHoursStart", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-whe">Working Hours End</Label>
          <Input
            id="cm-whe"
            type="time"
            value={form.workingHoursEnd}
            onChange={(e) => setField("workingHoursEnd", e.target.value)}
          />
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
                className="w-3.5 h-3.5 accent-teal-600"
              />
              <span className="text-xs font-medium text-gray-700">{day}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  // 7. Contacts — mirrors customer-sheet.tsx Section 6
  const contactsContent = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="oa-form-section" style={{ marginBottom: 0, borderBottom: "none" }}>Contacts</p>
        <Button type="button" size="sm" variant="outline" className="oa-btn-ghost" onClick={addContact}>
          + Add Contact
        </Button>
      </div>
      {fieldErrors.contacts && <p className="text-xs text-destructive mb-2">{fieldErrors.contacts}</p>}
      {form.contacts.length === 0 && <p className="text-sm text-gray-400">No contacts added.</p>}
      <div className="flex flex-col gap-3">
        {form.contacts.map((contact) => (
          <div key={contact._key} className="rounded-md border p-3 bg-gray-50 space-y-2">
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
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop — left 35% */}
      <div
        className="w-[35%] bg-black/40"
        onClick={() => !saving && onOpenChange(false)}
      />

      {/* Panel — right 65% */}
      <div className="w-[65%] bg-white h-screen flex flex-col shadow-2xl">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 bg-white">
          <div className="flex items-start justify-between">
            <div className="min-w-0 pr-4">
              <h2 className="text-[15px] font-bold text-gray-900">Add Missing Customer</h2>
              {(shipToCustomerId || shipToCustomerName) && (
                <p className="text-[12.5px] text-gray-500 mt-0.5 truncate">
                  {[shipToCustomerId, shipToCustomerName].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => !saving && onOpenChange(false)}
              className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Tab strip ───────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-gray-200 bg-white flex items-stretch">
          {/* scrollable tab buttons */}
          <div className="flex-1 min-w-0 overflow-x-auto px-4">
            <div className="flex">
              {TABS.map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`relative py-2.5 px-3 text-[12px] font-medium whitespace-nowrap transition-colors border-b-2 ${
                      isActive
                        ? "border-teal-600 text-teal-700"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab}
                    {tabHasError[tab] && (
                      <span className="absolute top-1.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {/* completion badge — always visible, outside scroll area */}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 border-l border-[#f0f0f0]">
            <span className={`text-[11px] font-semibold tabular-nums ${
              completionPct >= 67 ? "text-green-600" : completionPct >= 34 ? "text-amber-500" : "text-red-500"
            }`}>
              {completionPct}%
            </span>
            <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  completionPct >= 67 ? "bg-green-500" : completionPct >= 34 ? "bg-amber-500" : "bg-red-400"
                }`}
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Body (scrollable) ────────────────────────────────────────────── */}
        <div className="oa-sheet-form flex-1 overflow-y-auto px-6 py-5">
          {activeTab === "Basic info"            && basicInfoContent}
          {activeTab === "Location"              && locationContent}
          {activeTab === "Routing & delivery"    && routingContent}
          {activeTab === "Sales & classification" && salesContent}
          {activeTab === "Flags"                 && flagsContent}
          {activeTab === "Delivery constraints"  && deliveryConstraintsContent}
          {activeTab === "Contacts"              && contactsContent}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-gray-200 bg-white px-6 py-4 flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-10 text-sm border-[#e5e7eb] text-gray-700 hover:bg-gray-50 rounded-lg oa-btn-ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-[2] h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary flex items-center justify-center gap-2"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving…" : "Create Customer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
