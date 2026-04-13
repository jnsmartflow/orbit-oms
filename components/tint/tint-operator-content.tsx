"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { Loader2, ChevronDown, ChevronLeft, ChevronRight, Palette } from "lucide-react";
import { UniversalHeader } from "@/components/universal-header";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";


// ── Types ─────────────────────────────────────────────────────────────────────

interface SplitLineItem {
  rawLineItemId?: number;
  rawLineItem: {
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
  };
}

interface OperatorSplit {
  id:               number;
  splitNumber:      number;
  status:           string;
  totalVolume:      number | null;
  articleTag:       string | null;
  createdAt:        string;
  tiSubmitted:       boolean;
  tiCoveredLines:    number;
  totalTintingLines: number;
  operatorSequence:  number;
  startedAt:         string | null;
  completedAt:       string | null;
  orderId:           number;
  order: {
    obdNumber:          string;
    shipToCustomerId:   string;
    shipToCustomerName: string | null;
    billToCustomerId:   string | null;
    billToCustomerName: string | null;
    areaName:           string | null;
    routeName:          string | null;
    deliveryTypeName:   string | null;
    dispatchSlot:       string | null;
    customer: {
      customerName: string;
      area: { name: string };
    } | null;
  };
  lineItems: SplitLineItem[];
}

interface OperatorOrder {
  id:                 number;
  obdNumber:          string;
  workflowStage:      string;
  dispatchSlot:       string | null;
  createdAt:          string;
  shipToCustomerId:   string;
  shipToCustomerName: string | null;
  billToCustomerId:   string | null;
  billToCustomerName: string | null;
  areaName:           string | null;
  routeName:          string | null;
  deliveryTypeName:   string | null;
  customer: {
    customerName: string;
    area:         { name: string };
  } | null;
  tiCoveredLines:    number;
  totalTintingLines: number;
  tintAssignments: {
    id:               number;
    status:           string;
    startedAt:        string | null;
    tiSubmitted:      boolean;
    operatorSequence: number;
  }[];
  querySnapshot: {
    totalUnitQty: number;
    totalVolume:  number;
    articleTag:   string | null;
    totalLines:   number;
  } | null;
  rawLineItems: {
    id:                number;
    obdNumber:         string;
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
  }[];
}

interface ShadeMasterRecord {
  id:                number;
  shadeName:         string;
  shipToCustomerId:  string;
  shipToCustomerName: string;
  tinterType:        "TINTER" | "ACOTONE";
  packCode:          string | null;
  skuCode:           string | null;
  baseSku:           string;
  tinQty:            number;
  YOX: number; LFY: number; GRN: number; TBL: number; WHT: number;
  MAG: number; FFR: number; BLK: number; OXR: number; HEY: number;
  HER: number; COB: number; COG: number;
  YE2: number; YE1: number; XY1: number; XR1: number; WH1: number;
  RE2: number; RE1: number; OR1: number; NO2: number; NO1: number;
  MA1: number; GR1: number; BU2: number; BU1: number;
}

interface TintingLine {
  rawLineItemId:     number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  packCode:          string;
}

interface TIFormEntry {
  id:                  string;
  rawLineItemId:       number | null;
  skuCodeRaw:          string;
  skuDescriptionRaw:   string;
  unitQty:             number;
  packCode:            string;
  tinQty:              number;
  shadeValues:         Record<string, number>;
  suggestions:         ShadeSuggestion[];
  suggestionsLoading:  boolean;
  suggestionsExpanded: boolean;
  saveAsShade:         boolean;
  shadeName:           string;
  shadeNameError:      string;
  flashActive:         boolean;
  selectedShadeName:   string | null;
  selectedShadeId:     number | null;
  showAllColumns:      boolean;
}

interface ShadeSuggestion extends ShadeMasterRecord {
  lastUsedAt: string | null;
}

interface TIEntryRecord {
  id:            number;
  table:         "TINTER" | "ACOTONE";
  rawLineItemId: number | null;
  baseSku:       string;
  tinQty:        number;
  packCode:      string | null;
  shadeValues:   Record<string, number>;
  createdAt:     string;
}

interface Job {
  id:               number;
  type:             "split" | "order";
  operatorSequence: number;
  status:           string;
  tiSubmitted:      boolean;
  startedAt:        string | null;
  customerName:     string;
  obdNumber:        string;
  splitNumber?:     number;
  dispatchSlot:     string | null;
  articleTag:       string | null;
  totalVolume:      number | null;
  lineItems:        SplitLineItem[];
  orderId:          number;
  tintAssignmentId:   number | null;
  shipToCustomerId:   string;
  shipToCustomerName: string | null;
  billToCustomerId:   string | null;
  billToCustomerName: string | null;
  areaName:           string | null;
  routeName:          string | null;
  deliveryTypeName:   string | null;
  tiCoveredLines:     number;
  totalTintingLines:  number;
}

interface CompletedAssignment {
  id:          number;
  completedAt: string | null;
  order: {
    obdNumber:          string;
    shipToCustomerId:   string;
    shipToCustomerName: string | null;
    customer:           { customerName: string; area: { name: string } } | null;
    querySnapshot:      { totalVolume: number } | null;
  };
}

interface CompletedSplit {
  id:          number;
  splitNumber: number;
  totalVolume: number | null;
  completedAt: string | null;
  orderId:     number;
  order: {
    obdNumber:          string;
    shipToCustomerId:   string;
    shipToCustomerName: string | null;
    customer:           { customerName: string; area: { name: string } } | null;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SHADES = [
  { code: "YOX", bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  { code: "LFY", bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  { code: "GRN", bg: "#bbf7d0", border: "#16a34a", text: "#14532d" },
  { code: "TBL", bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
  { code: "WHT", bg: "#f9fafb", border: "#9ca3af", text: "#374151" },
  { code: "MAG", bg: "#fce7f3", border: "#ec4899", text: "#831843" },
  { code: "FFR", bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
  { code: "BLK", bg: "#1f2937", border: "#374151", text: "#f9fafb" },
  { code: "OXR", bg: "#ffedd5", border: "#f97316", text: "#7c2d12" },
  { code: "HEY", bg: "#fef9c3", border: "#eab308", text: "#713f12" },
  { code: "HER", bg: "#ffe4e6", border: "#f43f5e", text: "#881337" },
  { code: "COB", bg: "#e0e7ff", border: "#6366f1", text: "#312e81" },
  { code: "COG", bg: "#ecfdf5", border: "#059669", text: "#064e3b" },
] as const;

const ACOTONE_SHADES = [
  { code: "YE2", bg: "#fef9c3", border: "#eab308", text: "#713f12" },
  { code: "YE1", bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  { code: "XY1", bg: "#fde68a", border: "#d97706", text: "#78350f" },
  { code: "XR1", bg: "#ffedd5", border: "#f97316", text: "#7c2d12" },
  { code: "WH1", bg: "#f9fafb", border: "#9ca3af", text: "#374151" },
  { code: "RE2", bg: "#fce7f3", border: "#ec4899", text: "#831843" },
  { code: "RE1", bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
  { code: "OR1", bg: "#fff7ed", border: "#fb923c", text: "#9a3412" },
  { code: "NO2", bg: "#f1f5f9", border: "#94a3b8", text: "#334155" },
  { code: "NO1", bg: "#e2e8f0", border: "#64748b", text: "#1e293b" },
  { code: "MA1", bg: "#ede9fe", border: "#8b5cf6", text: "#4c1d95" },
  { code: "GR1", bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  { code: "BU2", bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
  { code: "BU1", bg: "#e0e7ff", border: "#6366f1", text: "#312e81" },
] as const;

const PACK_CODES = [
  { value: "ml_500", label: "500ml" },
  { value: "L_1",    label: "1L" },
  { value: "L_4",    label: "4L" },
  { value: "L_10",   label: "10L" },
  { value: "L_20",   label: "20L" },
] as const;

function defaultTIFormEntry(): TIFormEntry {
  return {
    id:                  Math.random().toString(36).slice(2),
    rawLineItemId:       null,
    skuCodeRaw:          "",
    skuDescriptionRaw:   "",
    unitQty:             0,
    packCode:            "",
    tinQty:              0,
    shadeValues:         {},
    suggestions:         [],
    suggestionsLoading:  false,
    suggestionsExpanded: false,
    saveAsShade:         false,
    shadeName:           "",
    shadeNameError:      "",
    flashActive:         false,
    selectedShadeName:   null,
    selectedShadeId:     null,
    showAllColumns:      true,
  };
}

function derivePackCode(volumeLine: number | null, unitQty: number): string {
  const perUnit = (unitQty > 0 && volumeLine != null) ? volumeLine / unitQty : 0;
  if (perUnit >= 20) return "L_20";
  if (perUnit >= 10) return "L_10";
  if (perUnit >= 4)  return "L_4";
  if (perUnit >= 1)  return "L_1";
  return "ml_500";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deliveryDotClass(type: string | null | undefined): string {
  if (type === "Local") return "bg-blue-600";
  if (type === "Upcountry") return "bg-orange-600";
  if (type === "IGT") return "bg-teal-600";
  if (type === "Cross Depot") return "bg-rose-600";
  return "bg-gray-400";
}

// ── Page Content ──────────────────────────────────────────────────────────────

export function TintOperatorContent() {
  const [assignedSplits,   setAssignedSplits]   = useState<OperatorSplit[]>([]);
  const [assignedOrders,   setAssignedOrders]   = useState<OperatorOrder[]>([]);
  const [completedOrders,  setCompletedOrders]  = useState<CompletedAssignment[]>([]);
  const [completedSplits,  setCompletedSplits]  = useState<CompletedSplit[]>([]);
  const [isLoading,        setIsLoading]        = useState(true);
  const [splitActionLoading, setSplitActionLoading] = useState<number | null>(null);
  const [orderActionLoading, setOrderActionLoading] = useState<number | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [hasActiveJob,    setHasActiveJob]    = useState(false);
  const [selectedJobId,   setSelectedJobId]   = useState<number | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<"split" | "order" | null>(null);
  const [queueDropdownOpen, setQueueDropdownOpen] = useState(false);
  const [totalAssignedToday, setTotalAssignedToday] = useState(0);
  const [totalDoneToday,     setTotalDoneToday]     = useState(0);
  const [selectedLineIdx,    setSelectedLineIdx]    = useState(0);
  const [elapsed,         setElapsed]         = useState("00:00:00");
  // ── TI form state ────────────────────────────────────────────────────────
  const [tinterType,         setTinterType]         = useState<"TINTER" | "ACOTONE">("TINTER");
  const [tiEntries,          setTiEntries]          = useState<TIFormEntry[]>(() => [defaultTIFormEntry()]);
  const [allSavedShades,     setAllSavedShades]     = useState<ShadeMasterRecord[]>([]);
  const [allShadesLoading,   setAllShadesLoading]   = useState(false);
  const [allShadesComboOpen, setAllShadesComboOpen] = useState<string | null>(null);
  const [allShadesSearch,    setAllShadesSearch]    = useState("");
  const [tiActionLoading,    setTiActionLoading]    = useState(false);
  const [conflictDialog,     setConflictDialog]     = useState<{
    existingId:   number;
    shadeName:    string;
    entryId:      string;
    job:          Job;
    remainingIds: string[];
  } | null>(null);
  const [tiSuccessToast,      setTiSuccessToast]      = useState(false);
  const [tiUpdateToast,       setTiUpdateToast]       = useState(false);
  const [tiIncompleteWarning, setTiIncompleteWarning] = useState<{
    rawLineItemId:     number;
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
  }[] | null>(null);
  const [existingTIEntries,  setExistingTIEntries]  = useState<Map<number, TIEntryRecord>>(new Map());
  const [tiEntriesLoading,   setTiEntriesLoading]   = useState(false);
  const [editingEntryId,     setEditingEntryId]     = useState<{ id: number; table: "TINTER" | "ACOTONE" } | null>(null);
  const [expandedLineId,     setExpandedLineId]     = useState<number | null>(null);

  const coverageStripRef  = useRef<HTMLDivElement>(null);
  const autoSelectDoneRef = useRef(false);

  const fetchOrders = useCallback(async () => {
    try {
      const res  = await fetch("/api/tint/operator/my-orders");
      const data = (await res.json()) as {
        assignedOrders:  OperatorOrder[];
        assignedSplits:  OperatorSplit[];
        hasActiveJob:    boolean;
        completedOrders: CompletedAssignment[];
        completedSplits: CompletedSplit[];
        totalAssignedToday: number;
        totalDoneToday:     number;
      };
      setAssignedOrders(data.assignedOrders ?? []);
      setAssignedSplits(data.assignedSplits ?? []);
      setHasActiveJob(data.hasActiveJob);
      setCompletedOrders(data.completedOrders ?? []);
      setCompletedSplits(data.completedSplits ?? []);
      setTotalAssignedToday(data.totalAssignedToday ?? 0);
      setTotalDoneToday(data.totalDoneToday ?? 0);

      const allJobs = [
        ...(data.assignedSplits ?? [])
          .filter(s => ["tint_assigned", "tinting_in_progress"].includes(s.status))
          .map(s => ({ id: s.id, type: "split" as const, seq: s.operatorSequence, status: s.status })),
        ...(data.assignedOrders ?? [])
          .filter(o => ["tint_assigned", "assigned", "tinting_in_progress"].includes(o.tintAssignments[0]?.status ?? ""))
          .map(o => ({ id: o.id, type: "order" as const, seq: o.tintAssignments[0]?.operatorSequence ?? 0, status: o.tintAssignments[0]?.status ?? "" })),
      ].sort((a, b) => a.seq - b.seq);

      const active = allJobs.find(j => j.status === "tinting_in_progress");
      const toSelect = active ?? allJobs[0] ?? null;
      if (toSelect) {
        setSelectedJobId(toSelect.id);
        setSelectedJobType(toSelect.type);
      }
    } catch {
      // leave stale
    }
  }, []);

  const loadExistingTIEntries = useCallback(async (job: Job) => {
    const fetchId   = job.type === "split" ? job.id : job.tintAssignmentId;
    const fetchType = job.type === "split" ? "split" : "assignment";
    if (!fetchId) { setExistingTIEntries(new Map()); return; }
    setTiEntriesLoading(true);
    try {
      const [resA, resB] = await Promise.all([
        fetch(`/api/tint/operator/tinter-issue/${fetchId}?type=${fetchType}`),
        fetch(`/api/tint/operator/tinter-issue-b/${fetchId}?type=${fetchType}`),
      ]);
      type RawEntry = Record<string, unknown> & {
        id: number; rawLineItemId: number | null; baseSku: string;
        tinQty: unknown; packCode: string | null; createdAt: string;
      };
      const rawA = resA.ok ? (await resA.json()) as { entries: RawEntry[] } : null;
      const rawB = resB.ok ? (await resB.json()) as { entries: RawEntry[] } : null;

      const TINTER_COLS  = ["YOX","LFY","GRN","TBL","WHT","MAG","FFR","BLK","OXR","HEY","HER","COB","COG"] as const;
      const ACOTONE_COLS = ["YE2","YE1","XY1","XR1","WH1","RE2","RE1","OR1","NO2","NO1","MA1","GR1","BU2","BU1"] as const;

      const map = new Map<number, TIEntryRecord>();

      for (const e of rawA?.entries ?? []) {
        if (e.rawLineItemId == null) continue;
        const sv: Record<string, number> = {};
        for (const col of TINTER_COLS) sv[col] = Number(e[col] ?? 0);
        const rec: TIEntryRecord = { id: e.id, table: "TINTER", rawLineItemId: e.rawLineItemId, baseSku: e.baseSku, tinQty: Number(e.tinQty), packCode: e.packCode, shadeValues: sv, createdAt: e.createdAt };
        const ex = map.get(e.rawLineItemId);
        if (!ex || new Date(e.createdAt) > new Date(ex.createdAt)) map.set(e.rawLineItemId, rec);
      }
      for (const e of rawB?.entries ?? []) {
        if (e.rawLineItemId == null) continue;
        const sv: Record<string, number> = {};
        for (const col of ACOTONE_COLS) sv[col] = Number(e[col] ?? 0);
        const rec: TIEntryRecord = { id: e.id, table: "ACOTONE", rawLineItemId: e.rawLineItemId, baseSku: e.baseSku, tinQty: Number(e.tinQty), packCode: e.packCode, shadeValues: sv, createdAt: e.createdAt };
        const ex = map.get(e.rawLineItemId);
        if (!ex || new Date(e.createdAt) > new Date(ex.createdAt)) map.set(e.rawLineItemId, rec);
      }
      setExistingTIEntries(map);
    } catch {
      // leave stale
    } finally {
      setTiEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchOrders().finally(() => setIsLoading(false));
  }, [fetchOrders]);


  async function postSplitAction(endpoint: string, splitId: number) {
    setSplitActionLoading(splitId);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ splitId }),
      });
      if (!res.ok) {
        let message = "Action failed";
        try {
          const err = (await res.json()) as { error?: string };
          if (typeof err.error === "string") message = err.error;
        } catch {
          // empty body — use default message
        }
        console.log("Action error:", res.status, message);
        throw new Error(message);
      }
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSplitActionLoading(null);
    }
  }

  async function postOrderAction(endpoint: string, orderId: number) {
    setOrderActionLoading(orderId);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        let message = "Action failed";
        try {
          const err = (await res.json()) as { error?: string };
          if (typeof err.error === "string") message = err.error;
        } catch {
          // empty body — use default message
        }
        console.log("Action error:", res.status, message);
        throw new Error(message);
      }
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setOrderActionLoading(null);
    }
  }

  // ── Memos ─────────────────────────────────────────────────────────────────

  const jobs = useMemo<Job[]>(() => {
    const splitJobs: Job[] = assignedSplits
      .filter(s => ["tint_assigned", "tinting_in_progress"].includes(s.status))
      .map(s => ({
        id:               s.id,
        type:             "split" as const,
        operatorSequence: s.operatorSequence,
        status:           s.status,
        tiSubmitted:      s.tiSubmitted,
        startedAt:        s.startedAt,
        customerName:      s.order.customer?.customerName ?? s.order.shipToCustomerName ?? "—",
        obdNumber:         s.order.obdNumber,
        splitNumber:       s.splitNumber,
        dispatchSlot:      s.order.dispatchSlot,
        articleTag:        s.articleTag,
        totalVolume:       s.totalVolume,
        lineItems:         s.lineItems,
        orderId:           s.orderId,
        tintAssignmentId:  null,
        shipToCustomerId:  s.order.shipToCustomerId,
        shipToCustomerName: s.order.shipToCustomerName,
        billToCustomerId:   s.order.billToCustomerId ?? null,
        billToCustomerName: s.order.billToCustomerName ?? null,
        areaName:           s.order.areaName ?? null,
        routeName:          s.order.routeName ?? null,
        deliveryTypeName:   s.order.deliveryTypeName ?? null,
        tiCoveredLines:    s.tiCoveredLines,
        totalTintingLines: s.totalTintingLines,
      }));

    const orderJobs: Job[] = assignedOrders
      .filter(o => ["tint_assigned", "assigned", "tinting_in_progress"].includes(o.tintAssignments[0]?.status ?? ""))
      .map(o => ({
        id:               o.id,
        type:             "order" as const,
        operatorSequence: o.tintAssignments[0]?.operatorSequence ?? 0,
        status:           o.tintAssignments[0]?.status === "assigned"
          ? "tint_assigned"
          : o.tintAssignments[0]?.status ?? "",
        tiSubmitted:      o.tintAssignments[0]?.tiSubmitted ?? false,
        startedAt:        o.tintAssignments[0]?.startedAt ?? null,
        customerName:      o.customer?.customerName ?? o.shipToCustomerName ?? "—",
        obdNumber:         o.obdNumber,
        splitNumber:       undefined,
        dispatchSlot:      o.dispatchSlot,
        articleTag:        o.querySnapshot?.articleTag ?? null,
        totalVolume:       o.querySnapshot?.totalVolume ?? null,
        lineItems:         o.rawLineItems.map(li => ({ rawLineItemId: li.id, rawLineItem: li })),
        orderId:           o.id,
        tintAssignmentId:  o.tintAssignments[0]?.id ?? null,
        shipToCustomerId:  o.shipToCustomerId,
        shipToCustomerName: o.shipToCustomerName,
        billToCustomerId:   o.billToCustomerId ?? null,
        billToCustomerName: o.billToCustomerName ?? null,
        areaName:           o.areaName ?? null,
        routeName:          o.routeName ?? null,
        deliveryTypeName:   o.deliveryTypeName ?? null,
        tiCoveredLines:    o.tiCoveredLines,
        totalTintingLines: o.totalTintingLines,
      }));

    return [...splitJobs, ...orderJobs].sort(
      (a, b) => a.operatorSequence - b.operatorSequence,
    );
  }, [assignedSplits, assignedOrders]);

  const selectedJob = useMemo(
    () => jobs.find(j => j.id === selectedJobId && j.type === selectedJobType) ?? null,
    [jobs, selectedJobId, selectedJobType],
  );

  const tintingLines = useMemo<TintingLine[]>(() => {
    if (!selectedJob) return [];
    return selectedJob.lineItems
      .filter(li => li.rawLineItem.isTinting)
      .map(li => ({
        rawLineItemId:     li.rawLineItemId ?? 0,
        skuCodeRaw:        li.rawLineItem.skuCodeRaw,
        skuDescriptionRaw: li.rawLineItem.skuDescriptionRaw,
        unitQty:           li.rawLineItem.unitQty,
        volumeLine:        li.rawLineItem.volumeLine,
        packCode:          derivePackCode(li.rawLineItem.volumeLine, li.rawLineItem.unitQty),
      }));
  }, [selectedJob]);

  useEffect(() => {
    if (!selectedJob?.startedAt || selectedJob.status !== "tinting_in_progress") {
      setElapsed("00:00:00");
      return;
    }
    const start = new Date(selectedJob.startedAt).getTime();
    const update = () => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(diff / 3600).toString().padStart(2, "0");
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, "0");
      const s = (diff % 60).toString().padStart(2, "0");
      setElapsed(`${h}:${m}:${s}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [selectedJob?.startedAt, selectedJob?.status]);

  // Reset TI form state when job changes
  useEffect(() => {
    setTinterType("TINTER");
    setTiEntries([defaultTIFormEntry()]);
    setAllSavedShades([]);
    setAllShadesLoading(false);
    setAllShadesComboOpen(null);
    setAllShadesSearch("");
    setConflictDialog(null);
    setTiSuccessToast(false);
    setTiUpdateToast(false);
    setTiIncompleteWarning(null);
    setExistingTIEntries(new Map());
    setEditingEntryId(null);
    setExpandedLineId(null);
    autoSelectDoneRef.current = false;
  }, [selectedJobId, selectedJobType]);

  // Load all saved shades when job or tinterType changes
  useEffect(() => {
    if (!selectedJob?.shipToCustomerId) { setAllSavedShades([]); return; }
    setAllShadesLoading(true);
    fetch(`/api/tint/operator/shades?shipToCustomerId=${encodeURIComponent(selectedJob.shipToCustomerId)}&tinterType=${tinterType}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { data: ShadeMasterRecord[] } | null) => { if (d) setAllSavedShades(d.data); })
      .catch(() => {})
      .finally(() => setAllShadesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.shipToCustomerId, tinterType]);

  // Load existing TI entries when job changes
  useEffect(() => {
    if (selectedJob) loadExistingTIEntries(selectedJob);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.id, selectedJob?.type, selectedJob?.tintAssignmentId]);

  // Auto-select single tinting line when there is exactly one line and no TI entry yet
  useEffect(() => {
    if (tiEntriesLoading) return;
    if (autoSelectDoneRef.current) return;
    if (tintingLines.length !== 1) return;
    if (existingTIEntries.size !== 0) return;
    autoSelectDoneRef.current = true;
    handleSkuSelect(tiEntries[0].id, tintingLines[0].rawLineItemId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiEntriesLoading, tintingLines.length, existingTIEntries.size]);

  const inProgressCount = jobs.filter(j => j.status === "tinting_in_progress").length;
  const completedCount  = completedOrders.length + completedSplits.length;
  // (volumeDone, remainingVolume, sortedSplits, sortedOrders removed — no longer displayed)

  // ── TI form functions ─────────────────────────────────────────────────────

  function handleTinterTypeChange(type: "TINTER" | "ACOTONE") {
    setTinterType(type);
    setTiEntries(prev => prev.map(e => ({
      ...e,
      shadeValues: {}, suggestions: [], suggestionsLoading: false,
      selectedShadeName: null, selectedShadeId: null, showAllColumns: true,
    })));
    setAllSavedShades([]);
  }

  function handleSkuSelect(entryId: string, rawLineItemId: number) {
    const line = tintingLines.find(l => l.rawLineItemId === rawLineItemId);
    if (!line || !selectedJob) return;

    const existing = existingTIEntries.get(rawLineItemId);

    setTiEntries(prev => prev.map(e => e.id !== entryId ? e : {
      ...e,
      rawLineItemId:      line.rawLineItemId,
      skuCodeRaw:         line.skuCodeRaw,
      skuDescriptionRaw:  line.skuDescriptionRaw ?? "",
      unitQty:            line.unitQty,
      packCode:           line.packCode,
      tinQty:             existing ? existing.tinQty : line.unitQty,
      shadeValues:        existing ? existing.shadeValues : {},
      suggestions:        [],
      suggestionsLoading: !existing && !!line.packCode,
      suggestionsExpanded: false,
      flashActive:        !!existing,
      selectedShadeName:  null,
      selectedShadeId:    null,
      showAllColumns:     existing ? false : true,
    }));

    if (existing) {
      setTinterType(existing.table);
      setEditingEntryId({ id: existing.id, table: existing.table });
      setTimeout(() => {
        setTiEntries(prev => prev.map(e => e.id !== entryId ? e : { ...e, flashActive: false }));
      }, 1500);
      return;
    }

    // No existing entry — new entry mode
    setEditingEntryId(null);
    if (!line.packCode) return;
    const url = `/api/tint/operator/shades?shipToCustomerId=${encodeURIComponent(selectedJob.shipToCustomerId)}&tinterType=${tinterType}&skuCode=${encodeURIComponent(line.skuCodeRaw)}&packCode=${encodeURIComponent(line.packCode)}`;
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then((d: { data: ShadeSuggestion[] } | null) => {
        setTiEntries(prev => prev.map(e => e.id !== entryId ? e : {
          ...e, suggestions: d?.data ?? [], suggestionsLoading: false,
        }));
      })
      .catch(() => {
        setTiEntries(prev => prev.map(e => e.id !== entryId ? e : { ...e, suggestionsLoading: false }));
      });
  }

  function applyShadeToEntry(entryId: string, shade: ShadeMasterRecord) {
    const cols = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
    const shadeValues: Record<string, number> = {};
    for (const col of cols) {
      shadeValues[col.code] = Number(shade[col.code as keyof ShadeMasterRecord]) || 0;
    }

    // Auto-match SKU line if the shade has a skuCode
    const matchedLine = shade.skuCode
      ? (tintingLines.find(l => l.skuCodeRaw === shade.skuCode) ?? null)
      : null;

    setTiEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      return {
        ...e,
        tinQty:            matchedLine ? matchedLine.unitQty : shade.tinQty,
        shadeValues,
        flashActive:       true,
        selectedShadeName: shade.shadeName,
        selectedShadeId:   shade.id,
        showAllColumns:    false,
        ...(matchedLine ? {
          rawLineItemId:     matchedLine.rawLineItemId,
          skuCodeRaw:        matchedLine.skuCodeRaw,
          skuDescriptionRaw: matchedLine.skuDescriptionRaw ?? "",
          unitQty:           matchedLine.unitQty,
          packCode:          matchedLine.packCode,
          suggestions:       [],
          suggestionsLoading: false,
        } : {}),
      };
    }));
    setTimeout(() => {
      setTiEntries(prev => prev.map(e => e.id !== entryId ? e : { ...e, flashActive: false }));
    }, 1500);
  }

  function buildShadeBody(entry: TIFormEntry, job: Job): Record<string, unknown> {
    const cols = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
    const body: Record<string, unknown> = {
      shadeName:          entry.shadeName.trim(),
      shipToCustomerId:   job.shipToCustomerId,
      shipToCustomerName: job.shipToCustomerName ?? job.customerName,
      tinterType,
      packCode:           entry.packCode || null,
      skuCode:            entry.skuCodeRaw || null,
      baseSku:            entry.skuCodeRaw,
      tinQty:             entry.tinQty,
    };
    for (const col of cols) {
      body[col.code] = entry.shadeValues[col.code] ?? 0;
    }
    return body;
  }

  async function saveShadesThenSubmitTI(job: Job, entryIds: string[]) {
    for (const entryId of entryIds) {
      const entry = tiEntries.find(e => e.id === entryId);
      if (!entry?.saveAsShade) continue;
      const shadeRes = await fetch("/api/tint/operator/shades", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildShadeBody(entry, job)),
      });
      if (shadeRes.status === 409) {
        const data = (await shadeRes.json()) as { existingId: number; shadeName: string };
        setConflictDialog({
          existingId:   data.existingId,
          shadeName:    data.shadeName,
          entryId,
          job,
          remainingIds: entryIds.slice(entryIds.indexOf(entryId) + 1),
        });
        setTiActionLoading(false);
        return;
      }
      if (!shadeRes.ok) throw new Error("Failed to save shade formula");
    }
    // All shades saved — submit TI
    const cols    = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
    const entries = tiEntries.filter(e => e.skuCodeRaw && e.tinQty > 0);
    if (tinterType === "TINTER") {
      const res = await fetch("/api/tint/operator/tinter-issue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId:          job.orderId,
          splitId:          job.type === "split" ? job.id : undefined,
          tintAssignmentId: job.type === "order" ? job.tintAssignmentId : undefined,
          entries: entries.map(e => ({
            rawLineItemId: e.rawLineItemId || undefined,
            baseSku: e.skuCodeRaw, tinQty: e.tinQty, packCode: e.packCode || null,
            ...Object.fromEntries(cols.map(c => [c.code, e.shadeValues[c.code] ?? 0])),
          })),
        }),
      });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; throw new Error(err.error ?? "Failed to submit TI"); }
    } else {
      const res = await fetch("/api/tint/operator/tinter-issue-b", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splitId:          job.type === "split" ? job.id : undefined,
          tintAssignmentId: job.type === "order" ? job.tintAssignmentId : undefined,
          entries: entries.map(e => ({
            rawLineItemId: e.rawLineItemId || undefined,
            baseSku: e.skuCodeRaw, tinQty: e.tinQty, packCode: e.packCode || null,
            ...Object.fromEntries(cols.map(c => [c.code, e.shadeValues[c.code] ?? 0])),
          })),
        }),
      });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; throw new Error(err.error ?? "Failed to submit TI"); }
    }
    await fetchOrders();
    await loadExistingTIEntries(job);
    setTimeout(() => coverageStripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    if (job.status === "tinting_in_progress") {
      setTiEntries([defaultTIFormEntry()]);
      setTiIncompleteWarning(null);
      setTiSuccessToast(true);
      setTimeout(() => setTiSuccessToast(false), 3000);
    } else {
      await startJob(job);
    }
  }

  async function handleSubmitTIAndStart(job: Job) {
    if (tiEntries.length === 0) { setError("Add at least one entry"); return; }
    for (const e of tiEntries) {
      if (!e.skuCodeRaw) { setError("Select a SKU line for all entries"); return; }
      if (e.tinQty <= 0) { setError("Tin Qty must be greater than 0 for all entries"); return; }
    }
    for (const e of tiEntries) {
      if (e.saveAsShade && !e.shadeName.trim()) {
        setTiEntries(prev => prev.map(en => en.id === e.id ? { ...en, shadeNameError: "Shade name is required" } : en));
        return;
      }
    }
    setTiActionLoading(true);
    setError(null);
    try {
      const saveIds = tiEntries.filter(e => e.saveAsShade).map(e => e.id);
      await saveShadesThenSubmitTI(job, saveIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit TI");
    } finally {
      setTiActionLoading(false);
    }
  }

  async function handleConflictOverwrite() {
    if (!conflictDialog) return;
    const { existingId, job, entryId, remainingIds } = conflictDialog;
    setConflictDialog(null);
    setTiActionLoading(true);
    setError(null);
    try {
      const entry = tiEntries.find(e => e.id === entryId);
      if (entry) {
        const res = await fetch(`/api/tint/operator/shades/${existingId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildShadeBody(entry, job)),
        });
        if (!res.ok) throw new Error("Failed to overwrite shade formula");
      }
      if (remainingIds[0] === "__EDIT__") {
        await doPatchEntry(job);
      } else {
        await saveShadesThenSubmitTI(job, remainingIds);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to overwrite shade");
    } finally {
      setTiActionLoading(false);
    }
  }

  function handleStripRowClick(rawLineItemId: number) {
    const line = tintingLines.find(l => l.rawLineItemId === rawLineItemId);
    if (!line) return;
    const existing = existingTIEntries.get(rawLineItemId);
    if (existing) {
      setTinterType(existing.table);
      setEditingEntryId({ id: existing.id, table: existing.table });
      setTiEntries(prev => {
        const first = prev[0] ?? defaultTIFormEntry();
        return [{
          ...first,
          rawLineItemId:      line.rawLineItemId,
          skuCodeRaw:         line.skuCodeRaw,
          skuDescriptionRaw:  line.skuDescriptionRaw ?? "",
          unitQty:            line.unitQty,
          packCode:           line.packCode,
          tinQty:             existing.tinQty,
          shadeValues:        existing.shadeValues,
          suggestions:        [],
          suggestionsLoading: false,
          suggestionsExpanded: false,
          flashActive:        true,
          selectedShadeName:  null,
          selectedShadeId:    null,
          showAllColumns:     false,
        }, ...prev.slice(1)];
      });
      setTimeout(() => {
        setTiEntries(prev => prev.map((e, i) => i === 0 ? { ...e, flashActive: false } : e));
      }, 1500);
    } else {
      setEditingEntryId(null);
      const firstId = tiEntries[0]?.id;
      if (firstId) handleSkuSelect(firstId, rawLineItemId);
    }
    document.getElementById("ti-form-section")?.scrollIntoView({ behavior: "smooth" });
  }

  async function doPatchEntry(job: Job) {
    if (!editingEntryId) return;
    const entry = tiEntries[0];
    if (!entry) return;
    const cols = editingEntryId.table === "TINTER" ? SHADES : ACOTONE_SHADES;
    const endpoint = editingEntryId.table === "TINTER"
      ? `/api/tint/operator/tinter-issue/${editingEntryId.id}`
      : `/api/tint/operator/tinter-issue-b/${editingEntryId.id}`;
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseSku:       entry.skuCodeRaw,
        tinQty:        entry.tinQty,
        packCode:      entry.packCode || null,
        rawLineItemId: entry.rawLineItemId ?? undefined,
        ...Object.fromEntries(cols.map(c => [c.code, entry.shadeValues[c.code] ?? 0])),
      }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? "Failed to update entry");
    }
    await loadExistingTIEntries(job);
    setTimeout(() => coverageStripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    setEditingEntryId(null);
    setTiEntries(prev => [defaultTIFormEntry(), ...prev.slice(1)]);
    setTiUpdateToast(true);
    setTimeout(() => setTiUpdateToast(false), 3000);
  }

  async function handleUpdateEntry(job: Job) {
    const entry = tiEntries[0];
    if (!entry || !editingEntryId) return;
    if (!entry.skuCodeRaw) { setError("Select a SKU line for entry 1"); return; }
    if (entry.tinQty <= 0) { setError("Tin Qty must be greater than 0 for entry 1"); return; }
    if (entry.saveAsShade && !entry.shadeName.trim()) {
      setTiEntries(prev => prev.map((en, i) => i === 0 ? { ...en, shadeNameError: "Shade name is required" } : en));
      return;
    }
    setTiActionLoading(true);
    setError(null);
    try {
      if (entry.saveAsShade) {
        const shadeRes = await fetch("/api/tint/operator/shades", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildShadeBody(entry, job)),
        });
        if (shadeRes.status === 409) {
          const data = (await shadeRes.json()) as { existingId: number; shadeName: string };
          setConflictDialog({ existingId: data.existingId, shadeName: data.shadeName, entryId: entry.id, job, remainingIds: ["__EDIT__"] });
          setTiActionLoading(false);
          return;
        }
        if (!shadeRes.ok) throw new Error("Failed to save shade formula");
      }
      await doPatchEntry(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update entry");
    } finally {
      setTiActionLoading(false);
    }
  }

  async function startJob(job: Job) {
    if (job.type === "split") {
      await postSplitAction("/api/tint/operator/split/start", job.id);
    } else {
      await postOrderAction("/api/tint/operator/start", job.id);
    }
  }

  async function markDone(job: Job) {
    setTiIncompleteWarning(null);
    type DoneErrBody = { error?: string; message?: string; missingLines?: { rawLineItemId: number; skuCodeRaw: string; skuDescriptionRaw: string | null }[] };
    if (job.type === "split") {
      setSplitActionLoading(job.id);
      setError(null);
      try {
        const res = await fetch("/api/tint/operator/split/done", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body:   JSON.stringify({ splitId: job.id }),
        });
        if (!res.ok) {
          const data = (await res.json()) as DoneErrBody;
          if (data.error === "TI incomplete") {
            setTiIncompleteWarning(data.missingLines ?? []);
            return;
          }
          throw new Error(data.error ?? "Action failed");
        }
        await fetchOrders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setSplitActionLoading(null);
      }
    } else {
      setOrderActionLoading(job.id);
      setError(null);
      try {
        const res = await fetch("/api/tint/operator/done", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body:   JSON.stringify({ orderId: job.id }),
        });
        if (!res.ok) {
          const data = (await res.json()) as DoneErrBody;
          if (data.error === "TI incomplete") {
            setTiIncompleteWarning(data.missingLines ?? []);
            return;
          }
          throw new Error(data.error ?? "Action failed");
        }
        await fetchOrders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setOrderActionLoading(null);
      }
    }
  }

  // ── Derived for layout ──────────────────────────────────────────────────────
  const progressPct = totalAssignedToday > 0 ? (totalDoneToday / totalAssignedToday) * 100 : 0;
  const progressColor = progressPct < 25 ? "bg-amber-600" : progressPct <= 75 ? "bg-teal-600" : "bg-green-600";

  const currentTintingLines = selectedJob
    ? selectedJob.lineItems.filter(li => li.rawLineItem.isTinting)
    : [];
  const currentNonTintingLines = selectedJob
    ? selectedJob.lineItems.filter(li => !li.rawLineItem.isTinting)
    : [];

  const queueBadgeRef = useRef<HTMLDivElement>(null);

  // Close queue dropdown on outside click
  useEffect(() => {
    if (!queueDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (queueBadgeRef.current && !queueBadgeRef.current.contains(e.target as Node)) {
        setQueueDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [queueDropdownOpen]);

  // Reset selectedLineIdx when job changes
  useEffect(() => {
    setSelectedLineIdx(0);
  }, [selectedJobId, selectedJobType]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* Row 1: UniversalHeader */}
      <UniversalHeader
        title="My Jobs"
        stats={[
          { label: "in queue", value: jobs.length },
          { label: "active", value: inProgressCount },
          { label: "done today", value: completedCount },
        ]}
        showDatePicker={false}
      />

      {/* Row 2: Job Context Bar */}
      <div className="h-[40px] min-h-[40px] sticky top-[52px] z-30 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        {/* LEFT: Job Pill + Bill To + Ship To */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Job Pill (clickable) */}
          {selectedJob ? (
            <div className="relative" ref={queueBadgeRef}>
              <button
                onClick={() => setQueueDropdownOpen(!queueDropdownOpen)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-[11px] font-medium rounded-[6px] px-2.5 py-1 cursor-pointer transition-colors border",
                  queueDropdownOpen
                    ? "bg-teal-50 border-teal-600 text-teal-800"
                    : "bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300"
                )}
              >
                <span className="text-gray-400 font-mono">#{jobs.indexOf(selectedJob) + 1}</span>
                <span className="font-semibold truncate max-w-[120px]">{selectedJob.customerName}</span>
                <span className="font-mono text-gray-500">{selectedJob.obdNumber}</span>
                {selectedJob.status === "tinting_in_progress" ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 border border-green-200 text-green-700">Active</span>
                ) : (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">Assigned</span>
                )}
                {/* Mini progress bar */}
                <div className="w-[40px] h-[4px] bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
                  <div className={`h-full rounded-full ${progressColor}`} style={{ width: `${Math.min(progressPct, 100)}%` }} />
                </div>
                <span className="text-[9px] font-semibold text-gray-500">{totalDoneToday}/{totalAssignedToday}</span>
                <ChevronDown size={12} className={cn("transition-transform", queueDropdownOpen && "rotate-180")} />
              </button>

              {/* Queue Dropdown */}
              {queueDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 w-[380px] bg-white border border-gray-200 rounded-[10px] shadow-[0_8px_24px_rgba(0,0,0,0.1)] overflow-hidden">
                  {/* Scoreboard header */}
                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <p className="text-[12px] font-bold text-gray-900">Today&apos;s Target</p>
                        <p className="text-[10px] text-gray-400">Assigned by Chandresh</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[18px] font-bold text-gray-900">{totalDoneToday}</span>
                        <span className="text-[13px] text-gray-400"> of {totalAssignedToday}</span>
                      </div>
                    </div>
                    <div className="w-full h-[6px] bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${Math.min(progressPct, 100)}%` }} />
                    </div>
                  </div>
                  {/* Job list */}
                  <div className="max-h-[480px] overflow-y-auto py-2">
                    <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Remaining ({jobs.length} jobs)</p>
                    {jobs.map((job, idx) => {
                      const isCurrent = selectedJobId === job.id && selectedJobType === job.type;
                      const isActive = job.status === "tinting_in_progress";
                      const hasActive = jobs.some(j => j.status === "tinting_in_progress");
                      const isFuture = !isActive && !isCurrent && (hasActive || idx > 0);
                      return (
                        <button
                          key={`q-${job.type}-${job.id}`}
                          onClick={() => { setSelectedJobId(job.id); setSelectedJobType(job.type); setQueueDropdownOpen(false); }}
                          className={cn(
                            "w-full text-left px-3 py-2 transition-colors",
                            isCurrent ? "bg-teal-50 border-l-[3px] border-l-teal-600" : "border-l-[3px] border-l-transparent hover:bg-gray-50",
                            isFuture && "opacity-[0.45]"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-gray-400">#{idx + 1}</span>
                            <span className="text-[12px] font-semibold text-gray-900 truncate flex-1">{job.customerName}</span>
                            <span className="font-mono text-[11px] text-gray-500">{job.obdNumber}</span>
                            {isCurrent && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-teal-600 text-white">Current</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                            {job.articleTag && <span>{job.articleTag}</span>}
                            {job.totalVolume != null && <span>· {Math.round(job.totalVolume)} L</span>}
                            {job.totalTintingLines > 0 && (
                              <span className={cn("font-semibold", job.tiCoveredLines >= job.totalTintingLines ? "text-green-600" : "text-amber-600")}>
                                TI {job.tiCoveredLines}/{job.totalTintingLines}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-gray-400">No jobs assigned</span>
          )}

          {/* Separator */}
          {selectedJob && <div className="w-px h-4 bg-gray-200" />}

          {/* Bill To pill */}
          {selectedJob && (
            <div className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1 flex items-center gap-1.5">
              <span className="text-[8px] font-bold uppercase text-gray-400">Bill To</span>
              <span className="text-[11px] font-semibold text-gray-800 truncate max-w-[100px]">{selectedJob.billToCustomerName ?? "—"}</span>
              {selectedJob.billToCustomerId && <span className="text-[10px] font-mono text-gray-400">{selectedJob.billToCustomerId}</span>}
            </div>
          )}

          {/* Ship To pill */}
          {selectedJob && (
            <div className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1 flex items-center gap-1.5">
              <span className="text-[8px] font-bold uppercase text-gray-400">Ship To</span>
              {selectedJob.deliveryTypeName && (
                <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${deliveryDotClass(selectedJob.deliveryTypeName)}`} />
              )}
              <span className="text-[11px] font-semibold text-gray-800 truncate max-w-[100px]">{selectedJob.customerName}</span>
              {(selectedJob.areaName || selectedJob.routeName) && (
                <span className="text-[10px] text-gray-400">{[selectedJob.areaName, selectedJob.routeName].filter(Boolean).join(" · ")}</span>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Queue/Done counts */}
        <div className="flex items-center gap-0 flex-shrink-0">
          <span className="text-[10px] font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-l-[5px] px-2.5 py-1">Queue · {jobs.length}</span>
          <span className="text-[10px] font-medium text-gray-500 bg-gray-50 border border-gray-200 border-l-0 rounded-r-[5px] px-2.5 py-1">Done · {completedCount}</span>
        </div>
      </div>

      {/* ── MAIN SPLIT ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL — SKU Lines (320px) ──────────────────────────── */}
        <div className="w-[320px] flex-shrink-0 border-r border-gray-200 flex flex-col bg-white overflow-hidden">

          {selectedJob ? (
            <>
              {/* SKU Lines header */}
              <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                <span className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400">SKU Lines</span>
                <span className="text-[10px] text-gray-400">
                  {selectedJob.articleTag ?? "—"} · {selectedJob.totalVolume != null ? `${Math.round(selectedJob.totalVolume)} L` : "—"} · {currentTintingLines.length} tinting
                </span>
              </div>

              {/* Tinting line cards (scrollable) */}
              <div className="flex-1 overflow-y-auto">
                {currentTintingLines.map((item, idx) => {
                  const rawId = item.rawLineItemId ?? 0;
                  const tiEntry = existingTIEntries.get(rawId) ?? null;
                  const isSelected = idx === selectedLineIdx;
                  return (
                    <div
                      key={rawId}
                      onClick={() => { setSelectedLineIdx(idx); handleStripRowClick(rawId); }}
                      className={cn(
                        "px-3 py-2 border-b border-gray-100 cursor-pointer transition-colors",
                        isSelected
                          ? "bg-teal-50 border-l-[3px] border-l-teal-600"
                          : tiEntry
                            ? "border-l-[3px] border-l-green-200 hover:bg-gray-50"
                            : "border-l-[3px] border-l-amber-200 bg-amber-50/30 hover:bg-amber-50/50"
                      )}
                    >
                      {/* Line 1: SKU code + TINT badge */}
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono text-[11px] text-gray-700">{item.rawLineItem.skuCodeRaw}</span>
                        <span className="bg-purple-50 border border-purple-200 text-purple-700 text-[8px] font-bold uppercase px-1 py-px rounded">TINT</span>
                      </div>
                      {/* Line 2: Description */}
                      <div className="text-[12px] font-semibold text-gray-900 truncate mb-0.5">
                        {item.rawLineItem.skuDescriptionRaw ?? "—"}
                      </div>
                      {/* Line 3: Qty · Volume · TI status */}
                      <div className="flex items-center justify-between text-[10px] text-gray-400">
                        <span>{item.rawLineItem.unitQty} qty · {item.rawLineItem.volumeLine != null ? `${item.rawLineItem.volumeLine} L` : "—"}</span>
                        {tiEntry ? (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 border border-green-200 text-green-700">✓ Done</span>
                        ) : (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">Pending</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Non-tinting lines */}
                {currentNonTintingLines.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Non-Tinting ({currentNonTintingLines.length})</span>
                    </div>
                    {currentNonTintingLines.map((item, idx) => (
                      <div key={`nt-${idx}`} className="px-3 py-1.5 border-b border-gray-50 text-[11px] text-gray-400">
                        <span className="font-mono">{item.rawLineItem.skuCodeRaw}</span>
                        <span className="ml-2">{item.rawLineItem.unitQty} qty</span>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Coverage footer (pinned) */}
              {currentTintingLines.length > 0 && (() => {
                const covered = currentTintingLines.filter(l => existingTIEntries.has(l.rawLineItemId ?? 0)).length;
                const total = currentTintingLines.length;
                const allDone = covered === total;
                const pct = total > 0 ? (covered / total) * 100 : 0;
                return (
                  <div className="px-3 py-2 border-t border-gray-200 flex-shrink-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn("text-[11px] font-semibold", allDone ? "text-green-700" : "text-amber-600")}>
                        {covered} of {total} covered
                      </span>
                    </div>
                    <div className="w-full h-[4px] bg-gray-200 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", allDone ? "bg-green-600" : "bg-amber-600")} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })()}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[12px] text-gray-400">No job selected</div>
          )}
        </div>

        {/* ── RIGHT PANEL — TI Form (flex-1) ─────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

          {/* Toasts */}
          {tiUpdateToast && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border-b border-green-200 flex-shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600 flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
              <span className="text-[12.5px] font-semibold text-green-700">TI entry updated</span>
            </div>
          )}
          {tiSuccessToast && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border-b border-green-200 flex-shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600 flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
              <span className="text-[12.5px] font-semibold text-green-700">TI entries saved</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border-b border-red-200 flex-shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-600 flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span className="text-[12.5px] font-medium text-red-700 flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} className="text-[12px] text-red-600 bg-transparent border-none cursor-pointer underline">Dismiss</button>
            </div>
          )}

          {!selectedJob ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-center p-10">
              <div className="w-11 h-11 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>
              </div>
              <p className="text-[14px] font-bold text-gray-500">No job selected</p>
              <p className="text-[12px] text-gray-400">Tap a job in the queue to view details</p>
            </div>
          ) : (
            <>
              {/* TI Header (pinned) */}
              <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-gray-500">Line {selectedLineIdx + 1} of {currentTintingLines.length}</span>
                  {currentTintingLines[selectedLineIdx] && (
                    <>
                      <span className="bg-purple-50 border border-purple-200 text-purple-700 text-[8px] font-bold uppercase px-1 py-px rounded">TINT</span>
                      <span className="font-mono text-[11px] text-gray-500 truncate">
                        {currentTintingLines[selectedLineIdx].rawLineItem.skuCodeRaw} · {currentTintingLines[selectedLineIdx].rawLineItem.skuDescriptionRaw ?? ""} · {currentTintingLines[selectedLineIdx].rawLineItem.unitQty} qty
                      </span>
                    </>
                  )}
                </div>
                {/* Tinter type toggle */}
                <div className="flex border border-gray-200 rounded-md overflow-hidden flex-shrink-0">
                  <button type="button" onClick={() => handleTinterTypeChange("TINTER")}
                    className={`px-3.5 py-1 text-[11px] font-semibold transition-colors ${tinterType === "TINTER" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                    TINTER
                  </button>
                  <button type="button" onClick={() => handleTinterTypeChange("ACOTONE")}
                    className={`px-3.5 py-1 text-[11px] font-semibold transition-colors border-l border-gray-200 ${tinterType === "ACOTONE" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                    ACOTONE
                  </button>
                </div>
              </div>

              {/* Scrollable TI form content */}
              <div className="flex-1 overflow-y-auto px-4 py-3">

                {tintingLines.length === 0 && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
                    <p className="text-[12px] text-gray-400">No tinting lines in this job — start directly.</p>
                  </div>
                )}

                {tintingLines.length > 0 && tiEntries.map((entry, idx) => {
                  const shadeColumns = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
                  const flash = entry.flashActive;
                  const entryId = entry.id;

                  return (
                    <div key={entryId} className="mb-4">
                      {/* Entry header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-extrabold uppercase tracking-[.5px] text-gray-400">Entry {idx + 1}</span>
                          {idx === 0 && editingEntryId && (
                            <>
                              <span className="text-[9.5px] font-bold px-1.5 py-px rounded-[4px] bg-gray-100 border border-gray-300 text-gray-700">Editing</span>
                              <button type="button"
                                onClick={() => { setEditingEntryId(null); setTiEntries(prev => [defaultTIFormEntry(), ...prev.slice(1)]); }}
                                className="text-[10.5px] font-semibold text-gray-500 bg-transparent border-none cursor-pointer underline p-0">
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                        {tiEntries.length > 1 && (
                          <button type="button"
                            onClick={() => setTiEntries(prev => prev.filter(e => e.id !== entryId))}
                            className="w-[22px] h-[22px] rounded-[5px] border border-red-200 bg-red-50 flex items-center justify-center cursor-pointer text-red-600">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        )}
                      </div>

                      {/* Base SKU Dropdown */}
                      <div className="mb-2.5">
                        <select
                          value={entry.rawLineItemId ?? ""}
                          onChange={e => { const val = Number(e.target.value); if (val) handleSkuSelect(entryId, val); }}
                          className={`w-full border border-gray-200 rounded-md h-[34px] text-[12px] px-2 font-medium focus:border-gray-900 focus:outline-none ${entry.rawLineItemId ? "text-gray-900" : "text-gray-400"}`}>
                          <option value="">Select SKU line…</option>
                          {tintingLines.map(line => (
                            <option key={line.rawLineItemId} value={line.rawLineItemId}>
                              {line.skuCodeRaw}{line.skuDescriptionRaw ? ` · ${line.skuDescriptionRaw}` : ""} · {line.unitQty} qty · {PACK_CODES.find(p => p.value === line.packCode)?.label ?? line.packCode}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Horizontal suggestion strip */}
                      {entry.skuCodeRaw && (entry.suggestionsLoading || entry.suggestions.length > 0) && (
                        <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
                          {entry.suggestionsLoading && (
                            <div className="flex-shrink-0 border border-gray-200 rounded-lg px-3.5 py-2 min-w-[140px] bg-gray-50">
                              <span className="text-[11px] text-gray-400">Loading…</span>
                            </div>
                          )}
                          {entry.suggestions.map(sug => (
                            <div key={sug.id}
                              onClick={() => applyShadeToEntry(entryId, sug)}
                              className={cn(
                                "flex-shrink-0 border rounded-lg px-3.5 py-2 cursor-pointer min-w-[140px] transition-colors",
                                entry.selectedShadeId === sug.id
                                  ? "border-teal-600 bg-teal-50"
                                  : "border-gray-200 bg-white hover:border-teal-600"
                              )}>
                              <div className="text-[12px] font-semibold text-gray-900">{sug.shadeName}</div>
                              <div className="text-[10px] text-gray-400">
                                {PACK_CODES.find(p => p.value === sug.packCode)?.label ?? sug.packCode ?? "—"} · {sug.lastUsedAt ? new Date(sug.lastUsedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "New"}
                              </div>
                            </div>
                          ))}
                          {/* All shades card */}
                          <Popover open={allShadesComboOpen === entryId} onOpenChange={(open) => {
                            if (!open) { setAllShadesComboOpen(null); setAllShadesSearch(""); }
                          }}>
                            <PopoverTrigger
                              onClick={() => setAllShadesComboOpen(entryId)}
                              className="flex-shrink-0 border border-gray-200 rounded-lg px-3.5 py-2 cursor-pointer min-w-[100px] flex items-center justify-center hover:border-gray-300">
                              <span className="text-[11px] font-medium text-gray-500">{allShadesLoading ? "Loading…" : "All shades…"}</span>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-72 p-0">
                              <div style={{ padding: 8 }}>
                                <input type="text" placeholder="Search shades…" value={allShadesSearch}
                                  onChange={e => setAllShadesSearch(e.target.value)}
                                  className="w-full h-[30px] border border-gray-200 rounded-md px-2 text-[11.5px] focus:border-gray-900 focus:outline-none" />
                              </div>
                              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                                {allSavedShades
                                  .filter(s => !allShadesSearch || s.shadeName.toLowerCase().includes(allShadesSearch.toLowerCase()))
                                  .map(shade => (
                                    <div key={shade.id}
                                      onClick={() => { applyShadeToEntry(entryId, shade); setAllShadesComboOpen(null); setAllShadesSearch(""); }}
                                      className="px-3 py-[7px] cursor-pointer text-[12px] font-medium text-gray-900 border-t border-gray-100 hover:bg-gray-50">
                                      <span className="font-semibold">{shade.shadeName}</span>
                                      <span className="text-gray-400 text-[11px]"> · {PACK_CODES.find(p => p.value === shade.packCode)?.label ?? shade.packCode ?? "—"}</span>
                                    </div>
                                  ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}

                      {/* Form card */}
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">

                        {/* Applied shade bar (pinned top) */}
                        {entry.selectedShadeName !== null && (
                          <div className="flex items-center justify-between px-3.5 py-2 bg-gray-50 border-b border-gray-200">
                            <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-300 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-gray-900">
                              <Palette size={11} />
                              {entry.selectedShadeName}
                            </span>
                            <button type="button"
                              onClick={() => setTiEntries(prev => prev.map(en => en.id === entryId ? { ...en, selectedShadeName: null, selectedShadeId: null, shadeValues: {}, showAllColumns: true } : en))}
                              className="text-[10px] font-bold text-red-600 bg-transparent border-none cursor-pointer">
                              Clear ×
                            </button>
                          </div>
                        )}

                        {/* Compact qty row: Tin Qty + Pack Size + Save shade toggle */}
                        <div className="px-3.5 py-2.5 flex items-end gap-3 border-b border-gray-200">
                          <div className="flex flex-col gap-0.5" style={{ width: 80 }}>
                            <span className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400">Tin Qty</span>
                            <input type="number" min={0} step={0.1} placeholder="0" value={entry.tinQty || ""}
                              onChange={e => setTiEntries(prev => prev.map(en => en.id === entryId ? { ...en, tinQty: Number(e.target.value) } : en))}
                              className={`border rounded-[5px] h-[32px] w-full text-center text-[13px] font-bold text-gray-900 focus:border-gray-900 focus:outline-none transition-colors ${flash ? "border-amber-300 bg-amber-50" : "border-gray-200"}`} />
                          </div>
                          <div className="flex flex-col gap-0.5" style={{ width: 60 }}>
                            <span className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400">Pack</span>
                            <div className={cn("h-[32px] border border-gray-200 rounded-[5px] px-1.5 text-[12px] font-semibold flex items-center justify-center", entry.packCode ? "text-gray-900" : "text-gray-400")}>
                              {entry.packCode ? (PACK_CODES.find(p => p.value === entry.packCode)?.label ?? entry.packCode) : "—"}
                            </div>
                          </div>
                          <div className="flex-1" />
                          {entry.skuCodeRaw && (
                            <div className="flex items-center gap-2 pb-1">
                              <button type="button" role="switch" aria-checked={entry.saveAsShade}
                                onClick={() => setTiEntries(prev => prev.map(en => en.id === entryId ? { ...en, saveAsShade: !en.saveAsShade, shadeNameError: "" } : en))}
                                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${entry.saveAsShade ? "bg-teal-600" : "bg-gray-300"}`}>
                                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${entry.saveAsShade ? "translate-x-4" : "translate-x-0"}`} />
                              </button>
                              <span className="text-[11px] font-semibold text-gray-600">Save shade</span>
                            </div>
                          )}
                        </div>

                        {/* Shade name input (when save toggle ON) */}
                        {entry.saveAsShade && (
                          <div className="px-3.5 py-2 border-b border-gray-200 flex items-center gap-2">
                            <label className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 flex-shrink-0">Shade name</label>
                            <input type="text" placeholder="e.g. Ivory White" value={entry.shadeName}
                              onChange={e => setTiEntries(prev => prev.map(en => en.id === entryId ? { ...en, shadeName: e.target.value, shadeNameError: "" } : en))}
                              className={`flex-1 h-[32px] border rounded-md text-[12px] px-2.5 font-medium text-gray-900 focus:border-gray-900 focus:outline-none ${entry.shadeNameError ? "border-red-300" : "border-gray-200"}`} />
                            {entry.shadeNameError && <span className="text-[11px] text-red-600">{entry.shadeNameError}</span>}
                          </div>
                        )}

                        {/* Shade Grid */}
                        <div className="px-3.5 py-3">
                          {(() => {
                            const allCols = shadeColumns as readonly { code: string; bg: string; border: string; text: string }[];
                            const activeCols = allCols.filter(col => (entry.shadeValues[col.code] ?? 0) > 0);
                            const emptyPadCols = allCols.filter(col => (entry.shadeValues[col.code] ?? 0) === 0).slice(0, 2);
                            const displayCols = (!entry.showAllColumns && activeCols.length > 0) ? [...activeCols, ...emptyPadCols] : allCols;
                            const hiddenCount = allCols.length - activeCols.length;
                            const hasActive = activeCols.length > 0;
                            return (
                              <>
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="text-[9.5px] font-extrabold uppercase tracking-[.5px] text-gray-400">
                                    {!entry.showAllColumns && hasActive ? "Active shade values" : `Shade quantities (${tinterType})`}
                                  </div>
                                  {hasActive && (
                                    <button type="button"
                                      onClick={() => setTiEntries(prev => prev.map(en => en.id === entryId ? { ...en, showAllColumns: !en.showAllColumns } : en))}
                                      className="text-[10.5px] font-semibold text-gray-500 bg-transparent border-none cursor-pointer p-0">
                                      {!entry.showAllColumns ? `+ Show all ${allCols.length}` : `− Active only`}
                                    </button>
                                  )}
                                </div>
                                <div className="grid grid-cols-7 gap-x-[10px] gap-y-[8px]">
                                  {displayCols.map(shade => {
                                    const hasVal = (entry.shadeValues[shade.code] ?? 0) > 0;
                                    return (
                                      <div key={shade.code} className="w-[60px] flex flex-col items-center gap-0.5">
                                        <div className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400">{shade.code}</div>
                                        <input type="number" min={0} step={0.01} placeholder="—"
                                          value={entry.shadeValues[shade.code] || ""}
                                          onChange={e => setTiEntries(prev => prev.map(en => en.id === entryId ? { ...en, shadeValues: { ...en.shadeValues, [shade.code]: Number(e.target.value) } } : en))}
                                          className={`w-[54px] h-[32px] border rounded-[5px] text-center text-[13px] font-semibold focus:border-gray-900 focus:outline-none transition-colors ${
                                            flash ? "border-amber-300 bg-amber-50 text-gray-900" : hasVal ? "bg-green-50 border-green-200 text-green-700" : "border-gray-200 text-gray-900"
                                          }`} />
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Add Another Entry */}
                {tintingLines.length > 0 && (
                  <div onClick={() => setTiEntries(prev => [...prev, defaultTIFormEntry()])}
                    className="flex items-center justify-center gap-1.5 text-[11.5px] font-bold text-gray-500 cursor-pointer py-2 hover:text-gray-700 transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add Another Entry
                  </div>
                )}
              </div>

              {/* Footer bar (pinned) */}
              <div className="border-t border-gray-200 bg-white px-4 py-2.5 flex-shrink-0 flex items-center gap-2.5">
                {/* LEFT: Line navigation */}
                <div className="flex items-center gap-1.5">
                  <button type="button" disabled={selectedLineIdx <= 0}
                    onClick={() => { const i = selectedLineIdx - 1; setSelectedLineIdx(i); const rawId = currentTintingLines[i]?.rawLineItemId ?? 0; handleStripRowClick(rawId); }}
                    className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30">
                    <ChevronLeft size={14} />
                  </button>
                  <button type="button" disabled={selectedLineIdx >= currentTintingLines.length - 1}
                    onClick={() => { const i = selectedLineIdx + 1; setSelectedLineIdx(i); const rawId = currentTintingLines[i]?.rawLineItemId ?? 0; handleStripRowClick(rawId); }}
                    className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30">
                    <ChevronRight size={14} />
                  </button>
                  {selectedJob.status === "tinting_in_progress" && elapsed ? (
                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2.5 py-0.5 rounded-md ml-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse flex-shrink-0" />
                      <span className="font-mono text-[11px] font-semibold text-gray-600">{elapsed}</span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-gray-400 ml-1">Line {selectedLineIdx + 1} of {currentTintingLines.length}</span>
                  )}
                </div>

                <div className="flex-1" />

                {/* RIGHT: Action buttons */}
                {(() => {
                  const isActionLoading = (selectedJob.type === "split"
                    ? splitActionLoading === selectedJob.id
                    : orderActionLoading === selectedJob.id) || tiActionLoading;

                  // Case 1 — In progress
                  if (selectedJob.status === "tinting_in_progress") {
                    const isTILoading = tiActionLoading;
                    const isDoneLoading = selectedJob.type === "split" ? splitActionLoading === selectedJob.id : orderActionLoading === selectedJob.id;
                    const anyLoading = isTILoading || isDoneLoading;
                    return (
                      <div className="flex flex-col gap-2">
                        {tiIncompleteWarning && tiIncompleteWarning.length > 0 && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                            <p className="text-[12px] font-bold text-amber-700 mb-1">Some tinting lines are missing TI entries:</p>
                            <ul className="text-[11.5px] text-amber-600 mb-1.5 ml-3.5" style={{ padding: 0 }}>
                              {tiIncompleteWarning.map(line => (
                                <li key={line.rawLineItemId}>{line.skuCodeRaw}{line.skuDescriptionRaw ? ` · ${line.skuDescriptionRaw}` : ""}</li>
                              ))}
                            </ul>
                            <p className="text-[11px] text-amber-700">Submit remaining entries or proceed to mark as done.</p>
                          </div>
                        )}
                        <div className="flex gap-2">
                          {editingEntryId ? (
                            <button type="button" onClick={() => handleUpdateEntry(selectedJob)} disabled={anyLoading}
                              className={cn("flex-1 bg-teal-600 text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-teal-700")}>
                              {isTILoading ? <Loader2 size={13} className="animate-spin" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                              Update TI Entry
                            </button>
                          ) : (
                            <button type="button" onClick={() => handleSubmitTIAndStart(selectedJob)} disabled={anyLoading}
                              className={cn("flex-1 bg-teal-600 text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-teal-700")}>
                              {isTILoading ? <Loader2 size={13} className="animate-spin" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                              Add TI Entry
                            </button>
                          )}
                          <button type="button"
                            onClick={() => markDone(selectedJob)}
                            disabled={anyLoading}
                            className={cn("flex-1 bg-green-600 text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-green-700")}>
                            {isDoneLoading ? <Loader2 size={13} className="animate-spin" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                            Mark as Done
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // Case 2 — TI not submitted
                  if (!selectedJob.tiSubmitted) {
                    if (tintingLines.length === 0) {
                      return (
                        <button type="button" onClick={() => startJob(selectedJob)} disabled={isActionLoading}
                          className={cn("flex-1 bg-teal-600 text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-teal-700")}>
                          {isActionLoading ? <Loader2 size={13} className="animate-spin" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
                          Start Job
                        </button>
                      );
                    }
                    return (
                      <button type="button" onClick={() => editingEntryId ? handleUpdateEntry(selectedJob) : handleSubmitTIAndStart(selectedJob)} disabled={isActionLoading}
                        className={cn("flex-1 bg-teal-600 text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-teal-700")}>
                        {isActionLoading ? <Loader2 size={13} className="animate-spin" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                        {editingEntryId ? "Update TI Entry" : "Submit TI & Start"}
                      </button>
                    );
                  }

                  // Case 3 — TI submitted, another job in progress
                  if (hasActiveJob) {
                    return (
                      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-gray-400">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        Another job is in progress — TI submitted ✓
                      </div>
                    );
                  }

                  // Case 4 — TI submitted, no active job
                  return (
                    <div className="flex-1 flex gap-2">
                      {editingEntryId && (
                        <button type="button" onClick={() => handleUpdateEntry(selectedJob)} disabled={isActionLoading}
                          className={cn("flex-1 bg-teal-600 text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-teal-700")}>
                          {isActionLoading ? <Loader2 size={13} className="animate-spin" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                          Update TI Entry
                        </button>
                      )}
                      <button type="button" onClick={() => startJob(selectedJob)} disabled={isActionLoading}
                        className={cn("flex-1 bg-teal-600 text-white border-none rounded-[10px] py-[11px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-opacity", isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-teal-700")}>
                        {isActionLoading ? <Loader2 size={13} className="animate-spin" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
                        Start Job
                      </button>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>

    {/* Conflict Dialog */}
    <Dialog open={!!conflictDialog} onOpenChange={(open: boolean) => { if (!open) setConflictDialog(null); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Shade already exists</DialogTitle>
          <DialogDescription>
            A shade named &quot;{conflictDialog?.shadeName}&quot; already exists for this customer with this SKU and pack size. Overwrite it?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConflictDialog(null)} className="border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</Button>
          <Button onClick={handleConflictOverwrite} disabled={tiActionLoading} className="bg-gray-900 text-white hover:bg-gray-800">
            {tiActionLoading && <Loader2 className={cn("animate-spin mr-1")} size={13} />}
            Overwrite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

