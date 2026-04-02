"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Search, Plus, Download, Upload, Users, MapPin, Truck, BarChart2, Flag, Clock, Mail, User, ChevronRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

import type {
  SubAreaOption, RouteOption, DeliveryTypeOption,
  SOGroupOption, ContactRoleOption, CustomerTypeOption, PremisesTypeOption,
  ContactDraft, CustomerFull,
} from "@/components/admin/customer-sheet";

// ── Local types ────────────────────────────────────────────────────────────────
export interface AreaWithType { id: number; name: string; deliveryType: { id: number; name: string } | null; primaryRoute: { id: number; name: string } | null }

interface CustomerListRow {
  id:                number;
  customerCode:      string;
  customerName:      string;
  area:              { id: number; name: string } | null;
  subArea:           { id: number; name: string } | null;
  salesOfficerGroup: { id: number; name: string } | null;
  premisesType:      { id: number; name: string } | null;
  customerRating:    string | null;
  isKeyCustomer:     boolean;
  isActive:          boolean;
}

interface SalesOfficerOption { id: number; name: string }

export interface CustomersSplitViewProps {
  initialCustomers: CustomerListRow[];
  initialTotal:     number;
  areas:            AreaWithType[];
  subAreas:         SubAreaOption[];
  salesOfficers:    SalesOfficerOption[];
  routes:           RouteOption[];
  deliveryTypes:    DeliveryTypeOption[];
  soGroups:         SOGroupOption[];
  contactRoles:     ContactRoleOption[];
  customerTypes:    CustomerTypeOption[];
  premisesTypes:    PremisesTypeOption[];
  canEdit?:         boolean;
  canImport?:       boolean;
}

interface ImportResult {
  created: number;
  skipped: number;
  failed:  { row: number; reason: string }[];
}

// ── Form state type ────────────────────────────────────────────────────────────
type FormState = {
  customerCode:           string;
  customerName:           string;
  address:                string;
  areaId:                 string;
  subAreaId:              string;
  salesOfficerId:         string;
  primaryRouteId:         string;
  dispatchDeliveryTypeId:  string;
  reportingDeliveryTypeId: string;
  customerTypeId:          string;
  premisesTypeId:          string;
  salesOfficerGroupId:     string;
  customerRating:         string;
  latitude:               string;
  longitude:              string;
  isKeyCustomer:          boolean;
  isKeySite:              boolean;
  acceptsPartialDelivery: boolean;
  isActive:               boolean;
  workingHoursStart:      string;
  workingHoursEnd:        string;
  noDeliveryDays:         string[];
  contacts:               ContactDraft[];
};

// ── Constants ──────────────────────────────────────────────────────────────────
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const TABS = [
  { id: "sec-basic",       label: "Basic info" },
  { id: "sec-location",    label: "Location" },
  { id: "sec-routing",     label: "Routing & delivery" },
  { id: "sec-sales",       label: "Sales & classification" },
  { id: "sec-flags",       label: "Flags" },
  { id: "sec-constraints", label: "Delivery constraints" },
  { id: "sec-contacts",    label: "Contacts" },
] as const;

const EMPTY_FORM: FormState = {
  customerCode: "", customerName: "", address: "",
  areaId: "", subAreaId: "", salesOfficerId: "",
  primaryRouteId: "", dispatchDeliveryTypeId: "", reportingDeliveryTypeId: "",
  customerTypeId: "", premisesTypeId: "", salesOfficerGroupId: "",
  customerRating: "", latitude: "", longitude: "",
  isKeyCustomer: false, isKeySite: false, acceptsPartialDelivery: true, isActive: true,
  workingHoursStart: "", workingHoursEnd: "", noDeliveryDays: [], contacts: [],
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function formFromCustomer(c: CustomerFull): FormState {
  return {
    customerCode:           c.customerCode,
    customerName:           c.customerName,
    address:                c.address ?? "",
    areaId:                 c.areaId.toString(),
    subAreaId:              c.subAreaId?.toString()              ?? "",
    salesOfficerId:         c.salesOfficerId?.toString()         ?? "",
    primaryRouteId:         c.primaryRouteId?.toString()         ?? "",
    dispatchDeliveryTypeId:  c.dispatchDeliveryTypeId?.toString()  ?? "",
    reportingDeliveryTypeId: c.reportingDeliveryTypeId?.toString() ?? "",
    customerTypeId:          c.customerTypeId?.toString()          ?? "",
    premisesTypeId:          c.premisesTypeId?.toString()          ?? "",
    salesOfficerGroupId:     c.salesOfficerGroupId?.toString()     ?? "",
    customerRating:         c.customerRating ?? "",
    latitude:               c.latitude?.toString()  ?? "",
    longitude:              c.longitude?.toString() ?? "",
    isKeyCustomer:          c.isKeyCustomer,
    isKeySite:              c.isKeySite,
    acceptsPartialDelivery: c.acceptsPartialDelivery,
    isActive:               c.isActive,
    workingHoursStart:      c.workingHoursStart ?? "",
    workingHoursEnd:        c.workingHoursEnd   ?? "",
    noDeliveryDays:         c.noDeliveryDays,
    contacts: c.contacts.map((ct) => ({
      _key:          `${ct.id}`,
      id:            ct.id,
      name:          ct.name,
      phone:         ct.phone ?? "",
      email:         ct.email ?? "",
      isPrimary:     ct.isPrimary,
      contactRoleId: ct.contactRoleId?.toString() ?? "",
    })),
  };
}

function newContact(): ContactDraft {
  return { _key: `${Date.now()}-${Math.random()}`, name: "", phone: "", email: "", isPrimary: false, contactRoleId: "" };
}

function getInitials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-[26px] h-[26px] rounded-[7px] bg-teal-50 flex items-center justify-center flex-shrink-0 text-teal-700">
        {icon}
      </div>
      <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">{title}</span>
      <div className="flex-1 h-px bg-[#e5e7eb]" />
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11.5px] font-medium text-gray-700 mb-1">
      {children}{required && <span className="text-red-600 ml-0.5">*</span>}
    </label>
  );
}

const inputCls = "w-full text-[12.5px] text-gray-900 bg-white border border-[#e5e7eb] rounded-lg px-[9px] py-[6px] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition-all";
const hintCls  = "text-[11px] text-[#9ca3af] mt-0.5";

// ── Group type ─────────────────────────────────────────────────────────────────
type CustomerGroup = {
  name:  string;
  items: CustomerListRow[];
};

// ── Main component ─────────────────────────────────────────────────────────────
export function CustomersSplitView({
  initialCustomers, initialTotal,
  areas, subAreas, salesOfficers, routes, deliveryTypes,
  soGroups, contactRoles, customerTypes, premisesTypes,
  canEdit = false, canImport = false,
}: CustomersSplitViewProps) {

  // ── List state ──────────────────────────────────────────────────────────────
  const [customers, setCustomers]     = useState<CustomerListRow[]>(initialCustomers ?? []);
  const [total, setTotal]             = useState(initialTotal);
  const [page, setPage]               = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterArea, setFilterArea]           = useState("");
  const [filterDeliveryType, setFilterDeliveryType] = useState("");
  const [filterPremisesType, setFilterPremisesType] = useState("");
  const [filterKey, setFilterKey]             = useState(false);
  const [filterActive, setFilterActive]       = useState(false);
  const [groupByName, setGroupByName]         = useState(false);
  const [expandedGroups, setExpandedGroups]   = useState<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / 25));

  // ── Form/selection state ────────────────────────────────────────────────────
  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [editingFull, setEditingFull]   = useState<CustomerFull | null>(null);
  const [loadingEdit, setLoadingEdit]   = useState(false);
  const [isNew, setIsNew]               = useState(false);
  const [form, setForm]                 = useState<FormState>(EMPTY_FORM);
  const [savedForm, setSavedForm]       = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors]   = useState<Record<string, string>>({});
  const [saving, setSaving]             = useState(false);

  // ── Dirty state ─────────────────────────────────────────────────────────────
  const dirty = savedForm
    ? JSON.stringify(form) !== JSON.stringify(savedForm)
    : isNew && (form.customerCode !== "" || form.customerName !== "");

  // ── Confirm dialog state ────────────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen]       = useState(false);
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(null);
  const [pendingNew, setPendingNew]           = useState(false);

  // ── Tab / scroll-spy state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab]   = useState<string>("sec-basic");
  const formScrollRef               = useRef<HTMLDivElement>(null);
  const sectionRefs                 = useRef<Record<string, HTMLDivElement | null>>({});
  const observerRef                 = useRef<IntersectionObserver | null>(null);
  const isScrollingToRef            = useRef(false);

  // ── Resize state ────────────────────────────────────────────────────────────
  const [panelWidth, setPanelWidth]   = useState(340);
  const isResizingRef                 = useRef(false);
  const resizeStartXRef               = useRef(0);
  const resizeStartWidthRef           = useRef(340);

  // ── Import state ─────────────────────────────────────────────────────────────
  const fileInputRef                    = useRef<HTMLInputElement>(null);
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // ── Debounce search ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Fetch list ──────────────────────────────────────────────────────────────
  const fetchList = useCallback(async (
    pg: number, search: string, areaId: string, deliveryType: string, premisesType: string, keyOnly: boolean, activeOnly: boolean, pageSize = 25,
  ) => {
    setListLoading(true);
    try {
      const params = new URLSearchParams({ page: pg.toString() });
      if (search)       params.set("search", search);
      if (areaId)       params.set("areaId", areaId);
      if (deliveryType) params.set("dispatchDeliveryTypeId", deliveryType);
      if (premisesType) params.set("premisesTypeId", premisesType);
      if (keyOnly)      params.set("isKeyCustomer", "true");
      if (activeOnly)   params.set("isActive", "true");
      params.set("pageSize", pageSize.toString());
      const res  = await fetch(`/api/admin/customers?${params}`);
      const data = await res.json();
      if (res.ok) { setCustomers(data.data ?? []); setTotal(data.total ?? 0); }
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    const pageSize = groupByName ? 250 : 25;
    fetchList(page, debouncedSearch, filterArea, filterDeliveryType, filterPremisesType, filterKey, filterActive, pageSize);
  }, [page, debouncedSearch, filterArea, filterDeliveryType, filterPremisesType, filterKey, filterActive, groupByName, fetchList]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [debouncedSearch, filterArea, filterDeliveryType, filterPremisesType, filterKey, filterActive]);

  // ── Load full customer ──────────────────────────────────────────────────────
  async function loadCustomer(id: number) {
    setLoadingEdit(true);
    setFieldErrors({});
    try {
      const res  = await fetch(`/api/admin/customers/${id}`);
      const data = await res.json();
      if (res.ok) {
        setEditingFull(data);
        const f = formFromCustomer(data);
        setForm(f);
        setSavedForm(f);
        setIsNew(false);
        setActiveTab("sec-basic");
        setTimeout(() => formScrollRef.current?.scrollTo({ top: 0 }), 0);
      } else {
        toast.error(data.error ?? `Failed to load customer (${res.status})`);
        setSelectedId(null);
      }
    } catch (err) {
      toast.error("Network error loading customer.");
      setSelectedId(null);
    } finally {
      setLoadingEdit(false);
    }
  }

  // ── Selection logic ─────────────────────────────────────────────────────────
  function requestSelectId(id: number) {
    if (id === selectedId) return;
    if (dirty) { setPendingSelectId(id); setConfirmOpen(true); return; }
    doSelectId(id);
  }
  function doSelectId(id: number) {
    setSelectedId(id);
    loadCustomer(id);
  }

  function requestNew() {
    if (dirty) { setPendingNew(true); setConfirmOpen(true); return; }
    doNew();
  }
  function doNew() {
    setSelectedId(null);
    setEditingFull(null);
    setForm(EMPTY_FORM);
    setSavedForm(null);
    setIsNew(true);
    setFieldErrors({});
    setActiveTab("sec-basic");
    setTimeout(() => formScrollRef.current?.scrollTo({ top: 0 }), 0);
  }

  function handleConfirmDiscard() {
    setConfirmOpen(false);
    if (pendingNew) { setPendingNew(false); doNew(); return; }
    if (pendingSelectId !== null) { const id = pendingSelectId; setPendingSelectId(null); doSelectId(id); }
  }
  function handleCancelDiscard() {
    setConfirmOpen(false); setPendingSelectId(null); setPendingNew(false);
  }

  // ── Form helpers ────────────────────────────────────────────────────────────
  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function handleAreaChange(val: string) {
    setForm((prev) => ({ ...prev, areaId: val === "none" ? "" : val, subAreaId: "" }));
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

  // ── Validation ──────────────────────────────────────────────────────────────
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

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const body = {
      customerCode:           form.customerCode.trim().toUpperCase(),
      customerName:           form.customerName.trim(),
      address:                form.address.trim() || null,
      areaId:                 parseInt(form.areaId, 10),
      subAreaId:              form.subAreaId              ? parseInt(form.subAreaId, 10)              : null,
      salesOfficerId:         form.salesOfficerId         ? parseInt(form.salesOfficerId, 10)         : null,
      primaryRouteId:         form.primaryRouteId         ? parseInt(form.primaryRouteId, 10)         : null,
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
      const url    = editingFull ? `/api/admin/customers/${editingFull.id}` : "/api/admin/customers";
      const method = editingFull ? "PATCH" : "POST";
      const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data   = await res.json();
      if (!res.ok) {
        if (res.status === 409) setFieldErrors({ customerCode: "Customer code already exists." });
        else toast.error(data.error ?? "Failed to save.");
        return;
      }
      toast.success(editingFull ? "Customer updated." : `Customer "${data.customerName}" created.`);
      // Update list row in-place or prepend
      setCustomers((prev) => {
        const idx = prev.findIndex((c) => c.id === data.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = {
            id: data.id, customerCode: data.customerCode, customerName: data.customerName,
            area: data.area, subArea: data.subArea, salesOfficerGroup: data.salesOfficerGroup,
            premisesType: data.premisesType ?? null,
            customerRating: data.customerRating, isKeyCustomer: data.isKeyCustomer, isActive: data.isActive,
          };
          return next;
        }
        return [{ id: data.id, customerCode: data.customerCode, customerName: data.customerName,
          area: data.area, subArea: data.subArea, salesOfficerGroup: data.salesOfficerGroup,
          premisesType: data.premisesType ?? null,
          customerRating: data.customerRating, isKeyCustomer: data.isKeyCustomer, isActive: data.isActive,
        }, ...prev];
      });
      if (!editingFull) setTotal((t) => t + 1);
      // Switch to edit mode for newly created
      setEditingFull(data);
      const f = formFromCustomer(data);
      setForm(f);
      setSavedForm(f);
      setIsNew(false);
      setSelectedId(data.id);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  // ── Scroll-spy ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = formScrollRef.current;
    if (!container || (!editingFull && !isNew)) return;

    observerRef.current?.disconnect();
    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingToRef.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTab(entry.target.id);
            break;
          }
        }
      },
      { root: container, threshold: 0.2 },
    );
    observerRef.current = observer;
    Object.values(sectionRefs.current).forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [editingFull, isNew]);

  function scrollToSection(id: string) {
    const el = sectionRefs.current[id];
    if (!el || !formScrollRef.current) return;
    isScrollingToRef.current = true;
    setActiveTab(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => { isScrollingToRef.current = false; }, 800);
  }

  // ── Resize handle ────────────────────────────────────────────────────────────
  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    isResizingRef.current    = true;
    resizeStartXRef.current  = e.clientX;
    resizeStartWidthRef.current = panelWidth;
    document.body.style.cursor   = "col-resize";
    document.body.style.userSelect = "none";
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizingRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      const next  = Math.min(420, Math.max(280, resizeStartWidthRef.current + delta));
      setPanelWidth(next);
    }
    function onMouseUp() {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor    = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, []);

  // ── CSV template download ────────────────────────────────────────────────────
  function downloadTemplate() {
    const csv = [
      "customerCode,customerName,address,areaName,subAreaName,salesOfficerName,routeName,deliveryTypeName,customerTypeName,premisesTypeName,customerRating,isKeyCustomer,isKeySite,acceptsPartialDelivery,isActive,latitude,longitude,workingHoursStart,workingHoursEnd,noDeliveryDays,contact1_name,contact1_phone,contact1_role,contact1_isPrimary,contact2_name,contact2_phone,contact2_role,contact2_isPrimary,contact3_name,contact3_phone,contact3_role,contact3_isPrimary",
      'C001,Ambika Paints,"Shop No 1, Varacha Road",Varacha Road,Varacha North,Rajesh Shah,Varacha,Local,Retail,Shop,A,true,false,true,true,21.1702,72.8311,09:00,18:00,,Ramesh Patel,9876543210,Owner,true,Suresh Shah,9876543211,Manager,false,,,,',
      'C002,Mahadev Traders,,Adajan,,,,,,,B,false,false,true,true,,,,,Sat|Sun,Mahesh Kumar,9876543212,Owner,true,,,,,,,',
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a   = document.createElement("a"); a.href = url; a.download = "template-customers.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res  = await fetch("/api/admin/customers/import", { method: "POST", body: formData });
      const data: ImportResult = await res.json();
      if (!res.ok) { toast.error((data as any).error ?? "Import failed."); return; }
      setImportResult(data);
      if (data.created > 0) fetchList(1, debouncedSearch, filterArea, filterDeliveryType, filterPremisesType, filterKey, filterActive, groupByName ? 250 : 25);
    } catch {
      toast.error("Network error during import.");
    } finally {
      setImporting(false);
    }
  }

  // ── Derived helpers ──────────────────────────────────────────────────────────
  const filteredSubAreas  = subAreas.filter((s) => s.areaId === parseInt(form.areaId, 10));
  const selectedSOGroup   = soGroups.find((g) => g.id.toString() === form.salesOfficerGroupId);
  const selectedArea      = areas.find((a) => a.id.toString() === form.areaId);
  const showForm          = editingFull !== null || isNew;

  const ratingStyles: Record<string, string> = {
    A: "bg-green-100 text-green-800 border border-green-300",
    B: "bg-amber-100 text-amber-800 border border-amber-300",
    C: "bg-red-100 text-red-800 border border-red-300",
  };

  const groups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerListRow[]>();
    for (const c of customers) {
      if (!map.has(c.customerName)) map.set(c.customerName, []);
      map.get(c.customerName)!.push(c);
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) =>
        b.length - a.length ||
        a[0].customerName.localeCompare(b[0].customerName)
      )
      .map(([name, items]) => ({
        name,
        items: [...items].sort((a, b) => a.customerCode.localeCompare(b.customerCode)),
      }));
  }, [customers]);

  function toggleGroup(name: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  const completionScore = useMemo(() => {
    let score = 0;
    if (form.customerName.trim())                                          score++;
    if (form.address.trim())                                               score++;
    if (form.areaId)                                                       score++;
    if (form.primaryRouteId)                                               score++;
    if (form.salesOfficerGroupId)                                          score++;
    if (form.customerTypeId)                                               score++;
    if (form.premisesTypeId)                                               score++;
    if (form.latitude.trim() && form.longitude.trim())                     score++;
    if (form.workingHoursStart.trim() && form.workingHoursEnd.trim())      score++;
    if (form.contacts.length > 0 && form.contacts[0].name.trim())         score++;
    return score;
  }, [form]);

  const completionPct = Math.round((completionScore / 10) * 100);

  const completionColor =
    completionPct <= 40 ? "red"
    : completionPct <= 70 ? "amber"
    : completionPct < 100 ? "blue"
    : "green";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Component header ──────────────────────────────────────────────── */}
      <div className="h-[52px] bg-white border-b border-[#e5e7eb] flex items-center px-5 gap-3 flex-shrink-0">
        <span className="text-[15px] font-semibold text-gray-900">Customers</span>
        <span className="text-[12px] text-[#9ca3af] bg-gray-50 border border-[#e5e7eb] px-2 py-0.5 rounded-full">{total} customers</span>
        <div className="flex-1" />
        {canImport && (
          <>
            <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-[12.5px] font-medium text-gray-700 border border-[#e5e7eb] bg-white hover:bg-gray-50 px-3.5 py-[7px] rounded-lg transition-colors">
              <Download className="w-3.5 h-3.5" />CSV template
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-gray-700 border border-[#e5e7eb] bg-white hover:bg-gray-50 px-3.5 py-[7px] rounded-lg transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />{importing ? "Importing…" : "Import CSV"}
            </button>
          </>
        )}
        {canEdit && (
          <button onClick={requestNew} className="flex items-center gap-1.5 text-[12.5px] font-medium text-white bg-teal-600 hover:bg-teal-700 px-3.5 py-[7px] rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" />Add customer
          </button>
        )}
        {canImport && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
          />
        )}
      </div>

      {/* ── Split ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── List panel ──────────────────────────────────────────────────── */}
        <div
          style={{ width: panelWidth, minWidth: 280, maxWidth: 420 }}
          className="flex-shrink-0 flex flex-col border-r border-[#e5e7eb] bg-white overflow-hidden"
        >
          {/* Filters */}
          <div className="px-3.5 py-3 border-b border-[#e5e7eb] flex flex-col gap-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9ca3af] pointer-events-none" />
              <input
                type="text"
                placeholder="Search name or code…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full text-[13px] text-gray-900 bg-gray-50 border border-[#e5e7eb] rounded-lg pl-8 pr-3 py-[7px] outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/10 transition-all"
              />
            </div>
            <div className="flex gap-1.5 items-center">
              <Select value={filterArea || "all"} onValueChange={(v) => setFilterArea(!v || v === "all" ? "" : v)}>
                <SelectTrigger className="flex-1 h-8 text-[12px] border-[#e5e7eb] bg-gray-50">
                  <SelectValue>{(v: any) => !v || v === "all" ? "All areas" : (areas.find((a) => a.id.toString() === v)?.name ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All areas</SelectItem>
                  {areas.map((a) => <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterDeliveryType || "all"} onValueChange={(v) => setFilterDeliveryType(!v || v === "all" ? "" : v)}>
                <SelectTrigger className="flex-1 h-8 text-[12px] border-[#e5e7eb] bg-gray-50">
                  <SelectValue>{(v: any) => !v || v === "all" ? "All types" : (deliveryTypes.find((dt) => dt.id.toString() === v)?.name ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {deliveryTypes.map((dt) => <SelectItem key={dt.id} value={dt.id.toString()}>{dt.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterPremisesType || "all"} onValueChange={(v) => setFilterPremisesType(!v || v === "all" ? "" : v)}>
                <SelectTrigger className="flex-1 h-8 text-[12px] border-[#e5e7eb] bg-gray-50">
                  <SelectValue>{(v: any) => !v || v === "all" ? "All premises" : (premisesTypes.find((p) => p.id.toString() === v)?.name ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All premises</SelectItem>
                  {premisesTypes.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1.5 items-center">
              <button
                onClick={() => setFilterKey((v) => !v)}
                className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-[5px] rounded-full border transition-all flex-shrink-0 ${filterKey ? "bg-teal-50 text-teal-700 border-teal-200" : "bg-gray-50 text-gray-500 border-[#e5e7eb] hover:border-gray-300"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${filterKey ? "bg-teal-600" : "bg-gray-400"}`} />Key
              </button>
              <button
                onClick={() => setFilterActive((v) => !v)}
                className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-[5px] rounded-full border transition-all flex-shrink-0 ${filterActive ? "bg-teal-50 text-teal-700 border-teal-200" : "bg-gray-50 text-gray-500 border-[#e5e7eb] hover:border-gray-300"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${filterActive ? "bg-teal-600" : "bg-gray-400"}`} />Active
              </button>
              <button
                onClick={() => { setGroupByName((v) => !v); setPage(1); }}
                className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-[5px] rounded-full border transition-all flex-shrink-0 ${groupByName ? "bg-teal-50 text-teal-700 border-teal-200" : "bg-gray-50 text-gray-500 border-[#e5e7eb] hover:border-gray-300"}`}
              >
                <Layers className="w-3 h-3" />Group
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto [scrollbar-width:thin]">
            {listLoading ? (
              <div className="flex items-center justify-center h-20 text-[12px] text-[#9ca3af]">Loading…</div>
            ) : customers.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-[12px] text-[#9ca3af]">No customers found</div>
            ) : !groupByName ? customers.map((c) => (
              <div
                key={c.id}
                onClick={() => requestSelectId(c.id)}
                className={`flex items-stretch border-b border-[#e5e7eb] cursor-pointer transition-colors ${c.id === selectedId ? "bg-[#eef0fb]" : "hover:bg-gray-50"}`}
              >
                <div className={`w-[3px] flex-shrink-0 rounded-r-[2px] transition-colors ${c.id === selectedId ? "bg-teal-600" : "bg-transparent"}`} />
                <div className="flex-1 px-3.5 py-[11px] min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[13px] font-medium text-gray-900 truncate">{c.customerName}</span>
                    {c.customerRating && (
                      <span className={`text-[10px] font-bold px-1.5 py-px rounded flex-shrink-0 ${ratingStyles[c.customerRating] ?? ""}`}>{c.customerRating}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="font-mono text-[10.5px] text-[#9ca3af]">{c.customerCode}</span>
                    {c.area && <><span className="w-[3px] h-[3px] rounded-full bg-gray-300 flex-shrink-0" /><span className="text-[11.5px] text-gray-500 truncate">{c.area.name}{c.subArea ? ` · ${c.subArea.name}` : ""}</span></>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className={`text-[10px] font-medium px-1.5 py-px rounded-full border ${c.isActive ? "bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]" : "bg-[#f0f1f5] text-[#9ca3af] border-[#e5e7eb]"}`}>{c.isActive ? "Active" : "Inactive"}</span>
                    {c.isKeyCustomer && <span className="text-[10px] font-medium px-1.5 py-px rounded-full border bg-[#fef3c7] text-[#b45309] border-[#fcd34d]">Key</span>}
                    {c.premisesType && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#f3e8ff] text-[#7c3aed] border border-[#e9d5ff]">{c.premisesType.name}</span>}
                    {c.salesOfficerGroup && <span className="text-[10px] font-medium px-1.5 py-px rounded-full border bg-teal-50 text-teal-700 border-teal-200 truncate max-w-[100px]">{c.salesOfficerGroup.name}</span>}
                  </div>
                </div>
              </div>
            )) : groups.map((group) => {
              const isExpanded = expandedGroups.has(group.name);
              return (
                <div key={group.name}>
                  {/* Group header */}
                  <div
                    onClick={() => toggleGroup(group.name)}
                    className="flex items-center gap-2 px-3.5 py-[8px] border-b border-[#e5e7eb] cursor-pointer bg-gray-50 hover:bg-white transition-colors sticky top-0 z-[5]"
                  >
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-[#9ca3af] flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                    />
                    <span className="text-[12.5px] font-semibold text-gray-900 flex-1 truncate">
                      {group.name}
                    </span>
                    <span className="text-[10px] font-bold px-[7px] py-[1px] rounded-full bg-teal-50 text-teal-700 border border-teal-200 flex-shrink-0">
                      {group.items.length}
                    </span>
                  </div>
                  {/* Customer item rows */}
                  {isExpanded && group.items.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => requestSelectId(c.id)}
                      className={`flex items-stretch border-b border-[#e5e7eb] cursor-pointer transition-colors ${c.id === selectedId ? "bg-[#eef0fb]" : "hover:bg-gray-50"}`}
                    >
                      <div className="w-[23px] flex-shrink-0" />
                      <div className={`w-[3px] flex-shrink-0 rounded-r-[2px] transition-colors ${c.id === selectedId ? "bg-teal-600" : "bg-transparent"}`} />
                      <div className="flex-1 px-3 py-[9px] min-w-0">
                        {/* Row 1: code · area */}
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="font-mono text-[11px] text-gray-700 font-medium">
                            {c.customerCode}
                          </span>
                          {c.area && (
                            <>
                              <span className="w-[3px] h-[3px] rounded-full bg-gray-300 flex-shrink-0" />
                              <span className="text-[11.5px] text-gray-500 truncate">
                                {c.area.name}{c.subArea ? ` · ${c.subArea.name}` : ""}
                              </span>
                            </>
                          )}
                          {c.customerRating && (
                            <span className={`text-[10px] font-bold px-1.5 py-px rounded flex-shrink-0 ml-auto ${ratingStyles[c.customerRating] ?? ""}`}>
                              {c.customerRating}
                            </span>
                          )}
                        </div>
                        {/* Row 2: badges */}
                        <div className="flex flex-wrap gap-1">
                          <span className={`text-[10px] font-medium px-1.5 py-px rounded-full border ${c.isActive ? "bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]" : "bg-[#f0f1f5] text-[#9ca3af] border-[#e5e7eb]"}`}>
                            {c.isActive ? "Active" : "Inactive"}
                          </span>
                          {c.isKeyCustomer && (
                            <span className="text-[10px] font-medium px-1.5 py-px rounded-full border bg-[#fef3c7] text-[#b45309] border-[#fcd34d]">Key</span>
                          )}
                          {c.salesOfficerGroup && (
                            <span className="text-[10px] font-medium px-1.5 py-px rounded-full border bg-teal-50 text-teal-700 border-teal-200 truncate max-w-[100px]">
                              {c.salesOfficerGroup.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          {groupByName ? (
            <div className="px-3.5 py-2.5 border-t border-[#e5e7eb] flex-shrink-0 bg-white">
              <span className="text-[11px] text-[#9ca3af]">Showing {customers.length} of {total} · Search first to narrow results</span>
            </div>
          ) : (
            <div className="px-3.5 py-2.5 border-t border-[#e5e7eb] flex items-center justify-between flex-shrink-0 bg-white">
              <span className="text-[11px] text-[#9ca3af]">Showing {customers.length} of {total}</span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-[#e5e7eb] bg-gray-50 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-gray-300 transition-colors"
                >← Prev</button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-[#e5e7eb] bg-gray-50 text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:border-gray-300 transition-colors"
                >Next →</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Resize handle ──────────────────────────────────────────────────── */}
        <div
          onMouseDown={onResizeMouseDown}
          className="w-1 bg-transparent hover:bg-teal-100 cursor-col-resize flex-shrink-0 relative z-10 transition-colors group"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 rounded-sm bg-gray-300 group-hover:bg-gray-400" />
        </div>

        {/* ── Form panel ─────────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[#f0f2f7]">

          {/* Empty state */}
          {!showForm && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#9ca3af]">
              <div className="w-[52px] h-[52px] rounded-xl bg-white border border-[#e5e7eb] flex items-center justify-center">
                <Users className="w-[22px] h-[22px] text-[#9ca3af]" />
              </div>
              <div className="text-[14px] font-medium text-gray-500">No customer selected</div>
              <div className="text-[12px] text-[#9ca3af]">Click a row on the left to edit, or add a new customer</div>
            </div>
          )}

          {/* Loading */}
          {loadingEdit && (
            <div className="flex-1 flex items-center justify-center text-[12px] text-[#9ca3af]">Loading…</div>
          )}

          {/* Form content */}
          {showForm && !loadingEdit && (
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">

              {/* Form header */}
              <div className="h-[52px] bg-white border-b border-[#e5e7eb] flex items-center px-5 gap-2.5 flex-shrink-0">
                <span className="text-[14px] font-semibold text-gray-900 truncate">
                  {isNew ? "New customer" : (editingFull?.customerName ?? "")}
                </span>
                {!isNew && editingFull && (
                  <span className="font-mono text-[11px] text-[#9ca3af] bg-gray-50 border border-[#e5e7eb] px-1.5 py-0.5 rounded flex-shrink-0">
                    {editingFull.customerCode}
                  </span>
                )}
                <div className="flex-1" />
                {!isNew && editingFull && (
                  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${editingFull.isActive ? "bg-[#e8f5e9] text-[#2e7d32]" : "bg-[#f0f1f5] text-gray-500"}`}>
                    {editingFull.isActive ? "Active" : "Inactive"}
                  </span>
                )}
              </div>

              {/* Tab rail */}
              <div className="bg-white border-b border-[#e5e7eb] flex items-stretch px-5 flex-shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => scrollToSection(tab.id)}
                    className={`flex items-center gap-1.5 px-3 text-[11.5px] font-medium border-b-2 h-[38px] whitespace-nowrap transition-colors ${activeTab === tab.id ? "text-teal-700 border-teal-600" : "text-gray-500 border-transparent hover:text-gray-700"}`}
                  >
                    {tab.label}
                    {tab.id === "sec-contacts" && form.contacts.length > 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-px rounded-lg bg-teal-50 text-teal-700">{form.contacts.length}</span>
                    )}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2 pr-4 flex-shrink-0">
                  <span className={`text-[11px] font-bold px-2 py-[2px] rounded-full border flex-shrink-0 ${
                    completionColor === "red"   ? "bg-red-50 text-red-600 border-red-200"
                    : completionColor === "amber" ? "bg-amber-50 text-amber-600 border-amber-200"
                    : completionColor === "blue"  ? "bg-blue-50 text-blue-600 border-blue-200"
                    : "bg-green-50 text-green-700 border-green-200"
                  }`}>
                    {completionPct}%
                  </span>
                  <div className="w-[72px] h-[5px] bg-[#f0f1f5] rounded-full overflow-hidden flex-shrink-0">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        completionColor === "red"   ? "bg-red-500"
                        : completionColor === "amber" ? "bg-amber-400"
                        : completionColor === "blue"  ? "bg-blue-500"
                        : "bg-green-500"
                      }`}
                      style={{ width: `${completionPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* ── Save bar ──────────────────────────────────────────────── */}
              <div className="h-[54px] bg-white border-b border-[#e5e7eb] flex items-center justify-between px-5 flex-shrink-0">
                <div className="flex items-center gap-2 text-[12px] text-gray-500">
                  {dirty && <><span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" /><span>Unsaved changes</span></>}
                </div>
                <div className="flex gap-2">
                  {dirty && (
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setForm(savedForm ?? EMPTY_FORM); setFieldErrors({}); }}
                      className="text-[12.5px] border-[#e5e7eb] text-gray-700 hover:bg-gray-50"
                    >Discard</Button>
                  )}
                  <Button
                    type="submit" size="sm" disabled={saving || !canEdit}
                    className="text-[12.5px] bg-teal-600 hover:bg-teal-700 text-white"
                  >{saving ? "Saving…" : (editingFull ? "Save changes" : "Create customer")}</Button>
                </div>
              </div>

              {/* Scroll area */}
              <div ref={formScrollRef} className="flex-1 overflow-y-auto px-5 pt-4 pb-0 flex flex-col gap-3.5 [scrollbar-width:thin]">

                {/* ── Basic info ──────────────────────────────────────────── */}
                <div ref={(el) => { sectionRefs.current["sec-basic"] = el; }} id="sec-basic" className="bg-white border border-[#e5e7eb] rounded-xl p-[18px_20px] scroll-mt-3">
                  <SectionHead icon={<User className="w-[13px] h-[13px]" />} title="Basic info" />
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <FieldLabel required>Customer code</FieldLabel>
                      <input type="text" className={`${inputCls} font-mono`} value={form.customerCode} onChange={(e) => setField("customerCode", e.target.value.toUpperCase())} placeholder="e.g. C-00142" />
                      {fieldErrors.customerCode && <p className="text-[11px] text-red-600 mt-0.5">{fieldErrors.customerCode}</p>}
                    </div>
                    <div>
                      <FieldLabel required>Customer name</FieldLabel>
                      <input type="text" className={inputCls} value={form.customerName} onChange={(e) => setField("customerName", e.target.value)} />
                      {fieldErrors.customerName && <p className="text-[11px] text-red-600 mt-0.5">{fieldErrors.customerName}</p>}
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Address</FieldLabel>
                    <textarea rows={3} className={`${inputCls} resize-y leading-relaxed`} value={form.address} onChange={(e) => setField("address", e.target.value)} placeholder={"Shop No. 12, Varacha Main Road\nNear Hirabaug Circle\nSurat - 395006"} />
                  </div>
                </div>

                {/* ── Location ────────────────────────────────────────────── */}
                <div ref={(el) => { sectionRefs.current["sec-location"] = el; }} id="sec-location" className="bg-white border border-[#e5e7eb] rounded-xl p-[18px_20px] scroll-mt-3">
                  <SectionHead icon={<MapPin className="w-[13px] h-[13px]" />} title="Location" />
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <FieldLabel required>Area</FieldLabel>
                      <Select value={form.areaId || "none"} onValueChange={(v) => handleAreaChange(v ?? "none")}>
                        <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "Select area" : (areas.find((a) => a.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Select area</SelectItem>
                          {areas.map((a) => <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {fieldErrors.areaId && <p className="text-[11px] text-red-600 mt-0.5">{fieldErrors.areaId}</p>}
                      {selectedArea && (selectedArea.deliveryType || selectedArea.primaryRoute) && (
                        <p className="text-[11px] text-[#1565c0] mt-0.5">↳ Area default: {[selectedArea.deliveryType?.name, selectedArea.primaryRoute?.name].filter(Boolean).join(" · ")}</p>
                      )}
                    </div>
                    <div>
                      <FieldLabel>Sub-area</FieldLabel>
                      <Select value={form.subAreaId || "none"} onValueChange={(v) => setField("subAreaId", !v || v === "none" ? "" : v)} disabled={!form.areaId || filteredSubAreas.length === 0}>
                        <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "None" : (filteredSubAreas.find((s) => s.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {filteredSubAreas.map((s) => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Latitude</FieldLabel>
                      <input type="number" step="any" className={inputCls} value={form.latitude} onChange={(e) => setField("latitude", e.target.value)} placeholder="Optional" />
                      {fieldErrors.latitude ? <p className="text-[11px] text-red-600 mt-0.5">{fieldErrors.latitude}</p> : <p className={hintCls}>For route optimisation</p>}
                    </div>
                    <div>
                      <FieldLabel>Longitude</FieldLabel>
                      <input type="number" step="any" className={inputCls} value={form.longitude} onChange={(e) => setField("longitude", e.target.value)} placeholder="Optional" />
                      {fieldErrors.longitude && <p className="text-[11px] text-red-600 mt-0.5">{fieldErrors.longitude}</p>}
                    </div>
                  </div>
                </div>

                {/* ── Routing & delivery ──────────────────────────────────── */}
                <div ref={(el) => { sectionRefs.current["sec-routing"] = el; }} id="sec-routing" className="bg-white border border-[#e5e7eb] rounded-xl p-[18px_20px] scroll-mt-3">
                  <SectionHead icon={<Truck className="w-[13px] h-[13px]" />} title="Routing & delivery" />
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <FieldLabel>Route override</FieldLabel>
                      <Select value={form.primaryRouteId || "none"} onValueChange={(v) => setField("primaryRouteId", !v || v === "none" ? "" : v)}>
                        <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "Use area default" : (routes.find((r) => r.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Use area default</SelectItem>
                          {routes.map((r) => <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {!form.primaryRouteId && selectedArea?.primaryRoute && (
                        <p className="text-[11px] text-[#1565c0] mt-0.5">↳ Area default: {selectedArea.primaryRoute.name}</p>
                      )}
                    </div>
                    <div>
                      <FieldLabel>Dispatch delivery type</FieldLabel>
                      <Select value={form.dispatchDeliveryTypeId || "none"} onValueChange={(v) => setField("dispatchDeliveryTypeId", !v || v === "none" ? "" : v)}>
                        <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "Use area default" : (deliveryTypes.find((dt) => dt.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Use area default</SelectItem>
                          {deliveryTypes.map((dt) => <SelectItem key={dt.id} value={dt.id.toString()}>{dt.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {!form.dispatchDeliveryTypeId && selectedArea?.deliveryType && (
                        <p className="text-[11px] text-[#1565c0] mt-0.5">↳ Area default: {selectedArea.deliveryType.name}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Reporting delivery type</FieldLabel>
                    <Select value={form.reportingDeliveryTypeId || "none"} onValueChange={(v) => setField("reportingDeliveryTypeId", !v || v === "none" ? "" : v)}>
                      <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "None" : (deliveryTypes.find((dt) => dt.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {deliveryTypes.map((dt) => <SelectItem key={dt.id} value={dt.id.toString()}>{dt.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className={hintCls}>Used in reports and analytics (may differ from dispatch type)</p>
                  </div>
                </div>

                {/* ── Sales & classification ───────────────────────────────── */}
                <div ref={(el) => { sectionRefs.current["sec-sales"] = el; }} id="sec-sales" className="bg-white border border-[#e5e7eb] rounded-xl p-[18px_20px] scroll-mt-3">
                  <SectionHead icon={<BarChart2 className="w-[13px] h-[13px]" />} title="Sales & classification" />
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <FieldLabel>Sales officer group</FieldLabel>
                      <Select value={form.salesOfficerGroupId || "none"} onValueChange={(v) => setField("salesOfficerGroupId", !v || v === "none" ? "" : v)}>
                        <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "None" : (soGroups.find((g) => g.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {soGroups.map((g) => <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {selectedSOGroup ? (
                        <p className={hintCls}>SO: <span className="text-[#1565c0] font-medium">{selectedSOGroup.salesOfficer.name}</span></p>
                      ) : (
                        <p className={hintCls}>SO is derived from the group</p>
                      )}
                    </div>
                    <div>
                      <FieldLabel>Sales officer (direct)</FieldLabel>
                      <Select value={form.salesOfficerId || "none"} onValueChange={(v) => setField("salesOfficerId", !v || v === "none" ? "" : v)}>
                        <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "None" : (salesOfficers.find((so) => so.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {salesOfficers.map((so) => <SelectItem key={so.id} value={so.id.toString()}>{so.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <FieldLabel>Customer type</FieldLabel>
                      <Select value={form.customerTypeId || "none"} onValueChange={(v) => setField("customerTypeId", !v || v === "none" ? "" : v)}>
                        <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "None" : (customerTypes.find((ct) => ct.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {customerTypes.map((ct) => <SelectItem key={ct.id} value={ct.id.toString()}>{ct.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <FieldLabel>Premises type</FieldLabel>
                      <Select value={form.premisesTypeId || "none"} onValueChange={(v) => setField("premisesTypeId", !v || v === "none" ? "" : v)}>
                        <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "None" : (premisesTypes.find((pt) => pt.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {premisesTypes.map((pt) => <SelectItem key={pt.id} value={pt.id.toString()}>{pt.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Customer rating</FieldLabel>
                    <div className="flex items-center gap-1.5 mt-1">
                      {(["A", "B", "C"] as const).map((r) => (
                        <button
                          key={r} type="button"
                          onClick={() => setField("customerRating", form.customerRating === r ? "" : r)}
                          className={`w-[38px] h-[30px] rounded-md text-[12px] font-semibold border transition-all ${form.customerRating === r ? ratingStyles[r] : "bg-gray-50 text-gray-500 border-[#e5e7eb] hover:border-gray-300"}`}
                        >{r}</button>
                      ))}
                      {form.customerRating && (
                        <button type="button" onClick={() => setField("customerRating", "")} className="text-[11px] text-[#9ca3af] underline ml-1">clear</button>
                      )}
                      <span className="text-[11px] text-[#9ca3af] ml-1">A = High-value · B = Regular · C = Low-frequency</span>
                    </div>
                  </div>
                </div>

                {/* ── Flags ───────────────────────────────────────────────── */}
                <div ref={(el) => { sectionRefs.current["sec-flags"] = el; }} id="sec-flags" className="bg-white border border-[#e5e7eb] rounded-xl p-[18px_20px] scroll-mt-3">
                  <SectionHead icon={<Flag className="w-[13px] h-[13px]" />} title="Flags" />
                  <div className="grid grid-cols-2 gap-[7px]">
                    {([
                      { key: "isKeyCustomer",          label: "Key Customer",     desc: "Prioritised in dispatch planning" },
                      { key: "isKeySite",              label: "Key Site",         desc: "High-priority delivery site" },
                      { key: "acceptsPartialDelivery", label: "Partial Delivery", desc: "Can receive split or partial orders" },
                      { key: "isActive",               label: "Active",           desc: "Record is active and visible" },
                    ] as const).map(({ key, label, desc }) => {
                      const on = form[key] as boolean;
                      return (
                        <div
                          key={key}
                          onClick={() => setField(key, !on)}
                          className={`flex items-center justify-between p-[10px_12px] rounded-lg border cursor-pointer transition-all ${on ? "bg-[#eef0fb] border-teal-200" : "bg-gray-50 border-[#e5e7eb] hover:border-gray-300"}`}
                        >
                          <div>
                            <div className="text-[12.5px] font-medium text-gray-900">{label}</div>
                            <div className="text-[10.5px] text-[#9ca3af] mt-0.5">{desc}</div>
                          </div>
                          <div className={`w-[30px] h-[17px] rounded-full relative flex-shrink-0 transition-colors ${on ? "bg-teal-600" : "bg-gray-300"}`}>
                            <div className={`absolute w-[13px] h-[13px] rounded-full bg-white top-[2px] transition-transform shadow-sm ${on ? "translate-x-[15px]" : "translate-x-[2px]"}`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Delivery constraints ─────────────────────────────────── */}
                <div ref={(el) => { sectionRefs.current["sec-constraints"] = el; }} id="sec-constraints" className="bg-white border border-[#e5e7eb] rounded-xl p-[18px_20px] scroll-mt-3">
                  <SectionHead icon={<Clock className="w-[13px] h-[13px]" />} title="Delivery constraints" />
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <FieldLabel>Working hours start</FieldLabel>
                      <input type="time" className={inputCls} value={form.workingHoursStart} onChange={(e) => setField("workingHoursStart", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Working hours end</FieldLabel>
                      <input type="time" className={inputCls} value={form.workingHoursEnd} onChange={(e) => setField("workingHoursEnd", e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>No delivery days</FieldLabel>
                    <div className="flex flex-wrap gap-[5px] mt-1.5">
                      {DAYS.map((day) => {
                        const blocked = form.noDeliveryDays.includes(day);
                        return (
                          <button
                            key={day} type="button"
                            onClick={() => toggleDay(day)}
                            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all ${blocked ? "bg-[#fee2e2] text-[#b91c1c] border-[#fca5a5] font-semibold" : "bg-gray-50 text-gray-500 border-[#e5e7eb] hover:border-gray-300"}`}
                          >{day}</button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* ── Contacts ─────────────────────────────────────────────── */}
                <div ref={(el) => { sectionRefs.current["sec-contacts"] = el; }} id="sec-contacts" className="bg-white border border-[#e5e7eb] rounded-xl p-[18px_20px] scroll-mt-3">
                  <SectionHead icon={<Mail className="w-[13px] h-[13px]" />} title="Contacts" />
                  {fieldErrors.contacts && <p className="text-[11px] text-red-600 mb-2">{fieldErrors.contacts}</p>}
                  <div className="flex flex-col gap-2 mb-2">
                    {form.contacts.map((contact) => (
                      <div key={contact._key} className="bg-gray-50 border border-[#e5e7eb] rounded-lg p-[11px_13px] relative">
                        <div className="flex gap-2.5 items-start">
                          <div className="w-[30px] h-[30px] rounded-full bg-teal-50 flex items-center justify-center text-[10px] font-semibold text-teal-700 flex-shrink-0 mt-0.5 font-mono">
                            {getInitials(contact.name) || "?"}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                            <div className="grid grid-cols-2 gap-2">
                              <input type="text" className={inputCls} placeholder="Contact name" value={contact.name} onChange={(e) => updateContact(contact._key, "name", e.target.value)} />
                              <Select value={contact.contactRoleId || "none"} onValueChange={(v) => updateContact(contact._key, "contactRoleId", !v || v === "none" ? "" : v)}>
                                <SelectTrigger className="h-[34px] text-[12.5px] border-[#e5e7eb]"><SelectValue>{(v: any) => !v || v === "none" ? "Role (optional)" : (contactRoles.find((r) => r.id.toString() === v)?.name ?? v)}</SelectValue></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No role</SelectItem>
                                  {contactRoles.map((r) => <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input type="text" className={inputCls} placeholder="Phone" value={contact.phone} onChange={(e) => updateContact(contact._key, "phone", e.target.value)} />
                              <input type="email" className={inputCls} placeholder="Email" value={contact.email} onChange={(e) => updateContact(contact._key, "email", e.target.value)} />
                            </div>
                          </div>
                          <button type="button" onClick={() => removeContact(contact._key)} className="w-[22px] h-[22px] rounded flex items-center justify-center text-[#9ca3af] hover:bg-[#fee2e2] hover:text-[#b91c1c] transition-all flex-shrink-0">×</button>
                        </div>
                        <div className="flex items-center gap-2 mt-2 pl-[38px]">
                          <div
                            onClick={() => setPrimary(contact._key)}
                            className={`w-[13px] h-[13px] rounded-[3px] border flex items-center justify-center cursor-pointer flex-shrink-0 transition-all ${contact.isPrimary ? "bg-teal-600 border-teal-600" : "bg-white border-gray-300"}`}
                          >
                            {contact.isPrimary && <div className="w-[7px] h-[4px] border-l-[1.5px] border-b-[1.5px] border-white -rotate-45 -translate-y-[1px]" />}
                          </div>
                          <span className="text-[11.5px] text-gray-500 cursor-pointer" onClick={() => setPrimary(contact._key)}>Primary contact</span>
                          {contact.isPrimary && <span className="text-[10px] font-semibold px-1.5 py-px rounded-full bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]">Primary</span>}
                          {contact.contactRoleId && (
                            <span className="text-[10px] font-semibold px-1.5 py-px rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                              {contactRoles.find((r) => r.id.toString() === contact.contactRoleId)?.name}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button" onClick={addContact}
                    className="flex items-center justify-center gap-1.5 w-full py-[9px] rounded-lg border-[1.5px] border-dashed border-teal-200 text-teal-700 text-[12px] font-medium hover:bg-teal-50 transition-colors"
                  >
                    <Plus className="w-3 h-3" />Add contact
                  </button>
                </div>

                {/* spacer for save bar */}
              </div>
            </form>
          )}
        </div>
      </div>

      {/* ── Confirm discard dialog ─────────────────────────────────────────── */}
      <Dialog open={!!importResult} onOpenChange={(o) => { if (!o) setImportResult(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Complete</DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="space-y-3 text-sm">
              <div className="flex gap-6">
                <span className="text-green-700 font-medium">{importResult.created} created</span>
                {importResult.skipped > 0 && (
                  <span className="text-gray-500 font-medium">{importResult.skipped} skipped (already exist)</span>
                )}
                {importResult.failed.length > 0 && (
                  <span className="text-destructive font-medium">{importResult.failed.length} failed</span>
                )}
              </div>
              {importResult.failed.length > 0 && (
                <div className="max-h-60 overflow-y-auto rounded-md border bg-gray-50 p-3 space-y-1">
                  {importResult.failed.map((f) => (
                    <p key={f.row} className="text-gray-700">
                      <span className="font-medium">Row {f.row}:</span> {f.reason}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white" onClick={() => setImportResult(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) handleCancelDiscard(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-gray-700">You have unsaved changes. If you leave now, your changes will be lost.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={handleCancelDiscard}>Keep editing</Button>
            <Button variant="destructive" size="sm" onClick={handleConfirmDiscard}>Discard changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
