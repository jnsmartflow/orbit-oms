"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { Loader2, ChevronDown, ChevronLeft, ChevronRight, Palette, Save, Play, Check, Plus, SkipForward, Pause, Eye, Inbox } from "lucide-react";
import { UniversalHeader } from "@/components/universal-header";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useSkuDisplayMode } from "@/lib/hooks/use-sku-display-mode";
import { pickSkuDisplay, type SkuDisplay } from "@/types/sku-display";
import { SkuDisplayToggle } from "@/components/tint/sku-display-toggle";
// Phase 4 — Sampling Library suggestion card replaces the legacy shade_master
// suggestion strip + "All shades…" popover. Step 11 retired the save-as-shade
// toggle; /suggest + /tinter-issue now handle the full Library write path.
import { FlatSuggestionList } from "@/components/tint/operator/flat-suggestion-list";
import {
  SaveSamplingPopup,
  type SaveSamplingResult,
} from "@/components/tint/operator/save-sampling-popup";
import type {
  SuggestResponse,
  SuggestFlatRow,
} from "@/app/api/sampling-library/_lib/suggest";
import { Button } from "@/components/ui/button";
import { TINTER_SHADE_COLORS, ACOTONE_SHADE_COLORS } from "@/lib/tint/shade-colors";
import { humaniseReason } from "@/lib/tint/pause-reasons";
import { computeElapsedMs } from "@/lib/tint/elapsed-time";
import { SkipJobModal } from "@/components/tint/SkipJobModal";
import { PauseJobModal } from "@/components/tint/PauseJobModal";
import { MarkDoneConfirmModal } from "@/components/tint/MarkDoneConfirmModal";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "sonner";


// ── Types ─────────────────────────────────────────────────────────────────────

interface SplitLineItem {
  rawLineItemId?: number;
  rawLineItem: {
    skuCodeRaw:        string;
    skuDescriptionRaw: string | null;
    unitQty:           number;
    volumeLine:        number | null;
    isTinting:         boolean;
    skuDisplay:        SkuDisplay;
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
    // Phase 4 — orders.customerId FK to delivery_point_master.id; the
    // numeric site key needed by the /api/sampling-library/suggest endpoint.
    customerId:         number | null;
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
  // Phase 4 — see comment in OperatorSplit.order.customerId.
  customerId:         number | null;
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
    // Phase 4c — pause-related fields surfaced by /api/tint/operator/my-orders.
    // currentProgress is jsonb shaped as { items: [{skuId, doneQty}], capturedAt }.
    pauseCount:       number;
    lastPausedAt:     string | null;
    currentProgress:  { items?: Array<{ skuId: number; doneQty: number }>; capturedAt?: string } | null;
    // Phase 4d — latest open pause event flattened by the route.
    lastPauseReason:  string | null;
    lastPauseRemark:  string | null;
    // Phase 4f — finalised as total minutes on done; running counter while paused.
    accumulatedMinutes: number;
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
    skuDisplay:        SkuDisplay;
  }[];
}

interface TintingLine {
  rawLineItemId:     number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  packCode:          string | null;
  skuDisplay:        SkuDisplay;
}

interface TIFormEntry {
  id:                  string;
  rawLineItemId:       number | null;
  skuCodeRaw:          string;
  skuDescriptionRaw:   string;
  unitQty:             number;
  packCode:            string | null;
  tinQty:              number;
  shadeValues:         Record<string, number>;
  shadeName:           string;
  flashActive:         boolean;
  selectedShadeName:   string | null;
  showAllColumns:      boolean;
  // Phase 4 — Sampling Library linkage. Set when operator clicks a
  // SuggestionCard row (existing samplingNo) OR when a fresh shade is
  // saved (allocated samplingNo from the TI POST response). null on the
  // legacy save-as-shade path until step 11 retires that.
  samplingNo:          string | null;
  // Search-first flow view mode (per entry): browse the flat list, confirm a
  // picked shade, or enter a brand-new shade. Default browse.
  mode:                "browse" | "confirm" | "newshade";
}

interface TIEntryRecord {
  id:            number;
  table:         "TINTER" | "ACOTONE";
  rawLineItemId: number | null;
  baseSku:       string;
  tinQty:        number;
  packCode:      string | null;
  shadeValues:   Record<string, number>;
  // Phase 4 (step 13) — Sampling Library linkage round-tripped via the GET
  // endpoint so the "Linked sampling" card survives page reload.
  samplingNo:    string | null;
  shadeName:     string | null;
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
  // Phase 4 — numeric FK to delivery_point_master.id; sourced from
  // orders.customerId. Required by the suggest endpoint (which doesn't
  // accept the SAP-code shipToCustomerId string).
  siteId:             number | null;
  billToCustomerId:   string | null;
  billToCustomerName: string | null;
  areaName:           string | null;
  routeName:          string | null;
  deliveryTypeName:   string | null;
  tiCoveredLines:     number;
  totalTintingLines:  number;
  // Phase 4c — pause-related fields. Splits never pause (whole-OBD only per
  // Phase 4a route contract), so split jobs carry the zero/null defaults.
  pauseCount:         number;
  lastPausedAt:       string | null;
  currentProgress:    { items?: Array<{ skuId: number; doneQty: number }>; capturedAt?: string } | null;
  // Phase 4d — surfaced from the latest open tint_pause_events row.
  lastPauseReason:    string | null;
  lastPauseRemark:    string | null;
  // Phase 4f — finalised as total minutes on done; powers the modal summary.
  accumulatedMinutes: number;
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
  { code: "WH1", bg: "#f9fafb", border: "#9ca3af", text: "#374151" },
  { code: "NO1", bg: "#e2e8f0", border: "#64748b", text: "#1e293b" },
  { code: "NO2", bg: "#f1f5f9", border: "#94a3b8", text: "#334155" },
  { code: "YE1", bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  { code: "YE2", bg: "#fef9c3", border: "#eab308", text: "#713f12" },
  { code: "XY1", bg: "#fde68a", border: "#d97706", text: "#78350f" },
  { code: "RE1", bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
  { code: "RE2", bg: "#fce7f3", border: "#ec4899", text: "#831843" },
  { code: "XR1", bg: "#ffedd5", border: "#f97316", text: "#7c2d12" },
  { code: "MA1", bg: "#ede9fe", border: "#8b5cf6", text: "#4c1d95" },
  { code: "OR1", bg: "#fff7ed", border: "#fb923c", text: "#9a3412" },
  { code: "GR1", bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  { code: "BU1", bg: "#e0e7ff", border: "#6366f1", text: "#312e81" },
  { code: "BU2", bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
] as const;

// TINTER_SHADE_COLORS and ACOTONE_SHADE_COLORS now live in
// lib/tint/shade-colors.ts so they can be shared with SkipJobModal (Phase 3c)
// and the upcoming PauseJobModal (Phase 4). Imported at the top of the file.

// Ascending by actual litres. `litres` is the authoritative per-unit size
// used by derivePackCode() for exact-match lookup.
const PACK_CODES = [
  { value: "ml_500",  label: "500ml",  litres: 0.5   },
  { value: "L_0_9",   label: "0.9L",   litres: 0.9   },
  { value: "L_0_925", label: "0.925L", litres: 0.925 },
  { value: "L_1",     label: "1L",     litres: 1     },
  { value: "L_3_6",   label: "3.6L",   litres: 3.6   },
  { value: "L_3_7",   label: "3.7L",   litres: 3.7   },
  { value: "L_4",     label: "4L",     litres: 4     },
  { value: "L_9",     label: "9L",     litres: 9     },
  { value: "L_9_25",  label: "9.25L",  litres: 9.25  },
  { value: "L_10",    label: "10L",    litres: 10    },
  { value: "L_15",    label: "15L",    litres: 15    },
  { value: "L_18",    label: "18L",    litres: 18    },
  { value: "L_18_5",  label: "18.5L",  litres: 18.5  },
  { value: "L_20",    label: "20L",    litres: 20    },
  { value: "L_22",    label: "22L",    litres: 22    },
  { value: "L_30",    label: "30L",    litres: 30    },
  { value: "L_40",    label: "40L",    litres: 40    },
] as const;

function defaultTIFormEntry(): TIFormEntry {
  return {
    id:                  Math.random().toString(36).slice(2),
    rawLineItemId:       null,
    skuCodeRaw:          "",
    skuDescriptionRaw:   "",
    unitQty:             0,
    packCode:            null,
    tinQty:              0,
    shadeValues:         {},
    samplingNo:          null,
    shadeName:           "",
    flashActive:         false,
    selectedShadeName:   null,
    showAllColumns:      true,
    mode:                "browse",
  };
}

// Exact-match lookup against PACK_CODES.litres (tolerance 0.005L — 5× smaller
// than the smallest adjacent gap 0.025L between 0.9L and 0.925L). Returns null
// if the SKU's per-unit volume isn't a known pack — caller renders "—" and
// skips the shades suggestion fetch / TI form stays uncorrupted.
function derivePackCode(volumeLine: number | null, unitQty: number): string | null {
  if (unitQty <= 0 || volumeLine == null) return null;
  const perUnit = volumeLine / unitQty;
  const match = PACK_CODES.find(p => Math.abs(perUnit - p.litres) < 0.005);
  return match ? match.value : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deliveryDotClass(type: string | null | undefined): string {
  if (type === "Local") return "bg-blue-600";
  if (type === "Upcountry") return "bg-orange-600";
  if (type === "IGT") return "bg-teal-600";
  if (type === "Cross Depot") return "bg-rose-600";
  return "bg-gray-400";
}

// Phase 4c — relative time formatter for paused-card "Last paused" summary.
// Server returns ISO; treat as UTC if no Z suffix, matching the existing
// elapsed-timer parse on line ~637.
function formatTimeAgo(iso: string): string {
  const raw = iso.endsWith("Z") ? iso : iso + "Z";
  const ms = Math.max(0, Date.now() - new Date(raw).getTime());
  const m  = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h  = Math.floor(m / 60);
  const mr = m % 60;
  if (h < 24) return mr === 0 ? `${h}h ago` : `${h}h ${mr}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ── Page Content ──────────────────────────────────────────────────────────────

export function TintOperatorContent() {
  const { data: session } = useSession();
  const canImportOBDs = ["admin", "dispatcher", "support", "billing_operator", "tint_manager"]
    .includes(session?.user?.role ?? "");

  const { mode: skuDisplayMode } = useSkuDisplayMode();

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

  // Phase 3c — Skip Job modal. Holds the assignment payload while open.
  const [skipModalJob, setSkipModalJob] = useState<{
    assignmentId:       number;
    obdNumber:          string;
    shipToCustomerName: string | null;
    smu:                string | null;
    articleTag:         string | null;
    totalVolume:        number | null;
  } | null>(null);
  // Phase 4c — Pause Job modal. Built lazily from selectedJob when triggered.
  const [pauseModalJob, setPauseModalJob] = useState<{
    id:           number;
    obdNumber:    string;
    customerName: string;
    startedAt:    string;
    skus: Array<{ skuId: number; skuCode: string; shadeName: string; assignedQty: number }>;
  } | null>(null);
  // Phase 4f — Mark Done confirm modal. Holds the assignment payload while open.
  const [markDoneModalJob, setMarkDoneModalJob] = useState<{
    orderId:            number;
    obdNumber:          string;
    customerName:       string;
    startedAt:          string | null;
    accumulatedMinutes: number;
    pauseCount:         number;
    skus: Array<{ skuId: number; skuCode: string; shadeName: string; assignedQty: number }>;
  } | null>(null);
  // Phase 4c — which paused card's View Progress accordion is expanded.
  const [expandedPausedId, setExpandedPausedId] = useState<number | null>(null);
  // Phase 4d — the assignment id of the paused job whose Resume click is in flight.
  const [resumingId,       setResumingId]       = useState<number | null>(null);
  const [queueDropdownOpen, setQueueDropdownOpen] = useState(false);
  const [totalAssignedToday, setTotalAssignedToday] = useState(0);
  const [totalDoneToday,     setTotalDoneToday]     = useState(0);
  const [selectedLineIdx,    setSelectedLineIdx]    = useState(0);
  const [elapsed,         setElapsed]         = useState("00:00:00");
  // ── TI form state ────────────────────────────────────────────────────────
  const [tinterType,         setTinterType]         = useState<"TINTER" | "ACOTONE">("TINTER");
  const [tiEntries,          setTiEntries]          = useState<TIFormEntry[]>(() => [defaultTIFormEntry()]);
  // Phase 4 — per-entry Sampling Library suggest data (keyed by entry.id).
  // suggestDataByEntry[entryId] === null means "fetch in flight"; undefined
  // means "no fetch attempted yet"; a SuggestResponse means "loaded".
  const [suggestDataByEntry,    setSuggestDataByEntry]    = useState<Record<string, SuggestResponse | null>>({});
  const [suggestLoadingByEntry, setSuggestLoadingByEntry] = useState<Record<string, boolean>>({});
  // Per-entry version counter so stale fetches (SKU changed mid-fetch) get
  // discarded on response. Increment on every kick-off.
  const suggestVersionRef = useRef<Record<string, number>>({});
  // Search-first flow — per-entry global-search state (operator-search endpoint).
  // searchResultsByEntry[id] === null means "no active search" (browse falls
  // back to flatSuggestions); [] means "searched, no hits".
  const [searchByEntry,        setSearchByEntry]        = useState<Record<string, string>>({});
  const [searchResultsByEntry, setSearchResultsByEntry] = useState<Record<string, SuggestFlatRow[] | null>>({});
  const [searchLoadingByEntry, setSearchLoadingByEntry] = useState<Record<string, boolean>>({});
  const searchVersionRef  = useRef<Record<string, number>>({});
  const searchDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [tiActionLoading,    setTiActionLoading]    = useState(false);
  const [tiSuccessToast,      setTiSuccessToast]      = useState(false);
  const [tiUpdateToast,       setTiUpdateToast]       = useState(false);
  // Phase 4 (step 12) — Save TI confirmation popup state. Non-null when a
  // Scenario 1 (new sampling) or Scenario 2 (new variant) save just landed;
  // null when no popup is showing or the save was Scenario 3 (silent update).
  const [samplingPopup,       setSamplingPopup]       = useState<SaveSamplingResult | null>(null);
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
        samplingNo?: string | null; shadeName?: string | null;
      };
      const rawA = resA.ok ? (await resA.json()) as { entries: RawEntry[] } : null;
      const rawB = resB.ok ? (await resB.json()) as { entries: RawEntry[] } : null;

      const TINTER_COLS  = ["YOX","LFY","GRN","TBL","WHT","MAG","FFR","BLK","OXR","HEY","HER","COB","COG"] as const;
      const ACOTONE_COLS = ["WH1","NO1","NO2","YE1","YE2","XY1","RE1","RE2","XR1","MA1","OR1","GR1","BU1","BU2"] as const;

      const map = new Map<number, TIEntryRecord>();

      for (const e of rawA?.entries ?? []) {
        if (e.rawLineItemId == null) continue;
        const sv: Record<string, number> = {};
        for (const col of TINTER_COLS) sv[col] = Number(e[col] ?? 0);
        const rec: TIEntryRecord = { id: e.id, table: "TINTER", rawLineItemId: e.rawLineItemId, baseSku: e.baseSku, tinQty: Number(e.tinQty), packCode: e.packCode, shadeValues: sv, samplingNo: e.samplingNo ?? null, shadeName: e.shadeName ?? null, createdAt: e.createdAt };
        const ex = map.get(e.rawLineItemId);
        if (!ex || new Date(e.createdAt) > new Date(ex.createdAt)) map.set(e.rawLineItemId, rec);
      }
      for (const e of rawB?.entries ?? []) {
        if (e.rawLineItemId == null) continue;
        const sv: Record<string, number> = {};
        for (const col of ACOTONE_COLS) sv[col] = Number(e[col] ?? 0);
        const rec: TIEntryRecord = { id: e.id, table: "ACOTONE", rawLineItemId: e.rawLineItemId, baseSku: e.baseSku, tinQty: Number(e.tinQty), packCode: e.packCode, shadeValues: sv, samplingNo: e.samplingNo ?? null, shadeName: e.shadeName ?? null, createdAt: e.createdAt };
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

  // Phase 4c — build allOperatorJobs once (incl. paused), then split into
  // `jobs` (active queue: non-paused) and `pausedJobs` (shelf). The TI form
  // and existing button cluster operate on `jobs` only, so keeping paused
  // separate preserves all downstream `jobs[0]` / `selectedJob` semantics.
  const allOperatorJobs = useMemo<Job[]>(() => {
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
        siteId:             s.order.customerId ?? null,
        billToCustomerId:   s.order.billToCustomerId ?? null,
        billToCustomerName: s.order.billToCustomerName ?? null,
        areaName:           s.order.areaName ?? null,
        routeName:          s.order.routeName ?? null,
        deliveryTypeName:   s.order.deliveryTypeName ?? null,
        tiCoveredLines:    s.tiCoveredLines,
        totalTintingLines: s.totalTintingLines,
        // Splits never pause (whole-OBD only).
        pauseCount:        0,
        lastPausedAt:      null,
        currentProgress:   null,
        lastPauseReason:   null,
        lastPauseRemark:   null,
        accumulatedMinutes: 0,
      }));

    const orderJobs: Job[] = assignedOrders
      .filter(o => ["tint_assigned", "assigned", "tinting_in_progress", "paused"].includes(o.tintAssignments[0]?.status ?? ""))
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
        siteId:             o.customerId ?? null,
        billToCustomerId:   o.billToCustomerId ?? null,
        billToCustomerName: o.billToCustomerName ?? null,
        areaName:           o.areaName ?? null,
        routeName:          o.routeName ?? null,
        deliveryTypeName:   o.deliveryTypeName ?? null,
        tiCoveredLines:    o.tiCoveredLines,
        totalTintingLines: o.totalTintingLines,
        pauseCount:        o.tintAssignments[0]?.pauseCount      ?? 0,
        lastPausedAt:      o.tintAssignments[0]?.lastPausedAt    ?? null,
        currentProgress:   o.tintAssignments[0]?.currentProgress ?? null,
        lastPauseReason:   o.tintAssignments[0]?.lastPauseReason ?? null,
        lastPauseRemark:   o.tintAssignments[0]?.lastPauseRemark ?? null,
        accumulatedMinutes: o.tintAssignments[0]?.accumulatedMinutes ?? 0,
      }));

    return [...splitJobs, ...orderJobs].sort(
      (a, b) => a.operatorSequence - b.operatorSequence,
    );
  }, [assignedSplits, assignedOrders]);

  // Active queue (CURRENT + UP NEXT). Excludes paused — preserves all
  // downstream `jobs[0]` / canSkip / selectedJob behaviour.
  const jobs = useMemo<Job[]>(
    () => allOperatorJobs.filter(j => j.status !== "paused"),
    [allOperatorJobs],
  );

  // Paused shelf. Whole-OBD only — splits never appear here.
  const pausedJobs = useMemo<Job[]>(
    () => allOperatorJobs.filter(j => j.status === "paused"),
    [allOperatorJobs],
  );

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
        skuDisplay:        li.rawLineItem.skuDisplay,
      }));
  }, [selectedJob]);

  useEffect(() => {
    if (!selectedJob) {
      setElapsed("00:00:00");
      return;
    }
    // Phase 4-smoke-2 — fold accumulatedMinutes into the displayed total.
    // computeElapsedMs returns null for states the timer doesn't apply to;
    // we still set "00:00:00" so the placeholder is stable, even though
    // the display sites are gated on status === "tinting_in_progress".
    const update = () => {
      const ms = computeElapsedMs({
        status:             selectedJob.status,
        startedAt:          selectedJob.startedAt,
        accumulatedMinutes: selectedJob.accumulatedMinutes,
      });
      if (ms == null) {
        setElapsed("00:00:00");
        return;
      }
      const totalSeconds = Math.floor(ms / 1000);
      const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
      const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
      const s = (totalSeconds % 60).toString().padStart(2, "0");
      setElapsed(`${h}:${m}:${s}`);
    };
    update();
    // Only tick live for running jobs. Paused = frozen at accumulatedMinutes,
    // no setInterval needed (value won't change until next refetch).
    if (selectedJob.status !== "tinting_in_progress") return;
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [selectedJob?.status, selectedJob?.startedAt, selectedJob?.accumulatedMinutes]);

  // Reset TI form state when job changes
  useEffect(() => {
    setTinterType("TINTER");
    setTiEntries([defaultTIFormEntry()]);
    setSuggestDataByEntry({});
    setSuggestLoadingByEntry({});
    suggestVersionRef.current = {};
    setSearchByEntry({});
    setSearchResultsByEntry({});
    setSearchLoadingByEntry({});
    searchVersionRef.current = {};
    setTiSuccessToast(false);
    setTiUpdateToast(false);
    setSamplingPopup(null);
    setTiIncompleteWarning(null);
    setExistingTIEntries(new Map());
    setEditingEntryId(null);
    setExpandedLineId(null);
    autoSelectDoneRef.current = false;
  }, [selectedJobId, selectedJobType]);

  // (Phase 4) The legacy preload of /api/tint/operator/shades is gone —
  // SuggestionCard fetches per-entry from /api/sampling-library/suggest
  // via fetchSuggestForEntry(), called from handleSkuSelect below.

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

  // Phase 4 — site history badge. Pull siteHistorySummary from any entry's
  // loaded suggest data; all entries on the same job share the same site
  // so the first available answer is the canonical one. null until at
  // least one suggest call returns.
  const siteHistorySummary = useMemo(() => {
    for (const e of tiEntries) {
      const d = suggestDataByEntry[e.id];
      if (d?.siteHistorySummary) return d.siteHistorySummary;
    }
    return null;
  }, [tiEntries, suggestDataByEntry]);

  // ── TI form functions ─────────────────────────────────────────────────────

  function handleTinterTypeChange(type: "TINTER" | "ACOTONE") {
    setTinterType(type);
    setTiEntries(prev => prev.map(e => ({
      ...e,
      shadeValues: {},
      selectedShadeName: null, showAllColumns: true,
      samplingNo: null,
      shadeName: "",
      mode: "browse",
    })));
    // Manual toggle re-scopes the global search to the new type — clear active
    // search so browse falls back to the (refetched) this-site flat list.
    setSearchByEntry({});
    setSearchResultsByEntry({});
    setSearchLoadingByEntry({});
    searchVersionRef.current = {};
    // Phase 4 fix — a manual toggle used to wipe the suggestion list to {} with
    // no refetch, leaving the picker stuck on its skeleton. Refetch for every
    // entry that has a SKU + pack selected so the list refills. The suggest
    // endpoint is type-agnostic (returns both TINTER + ACOTONE cards, each now
    // carrying its own tinterType), so this re-runs the same query and the
    // cards apply correctly regardless of the current toggle.
    if (selectedJob?.siteId != null) {
      for (const e of tiEntries) {
        if (e.skuCodeRaw && e.packCode) {
          fetchSuggestForEntry(e.id, e.skuCodeRaw, e.packCode, selectedJob.siteId);
        }
      }
    }
  }

  // ── Phase 4: Sampling Library suggest fetch (per-entry) ──────────────────
  //
  // Called from handleSkuSelect when the operator picks a new SKU line on
  // an entry. Skips when siteId or skuCode or packCode is missing. Race-
  // safe via suggestVersionRef counter — late responses for a stale
  // (entryId × SKU × pack) tuple are discarded.
  function fetchSuggestForEntry(entryId: string, skuCode: string, packCode: string, siteId: number): void {
    const myVersion = (suggestVersionRef.current[entryId] ?? 0) + 1;
    suggestVersionRef.current[entryId] = myVersion;
    setSuggestLoadingByEntry(prev => ({ ...prev, [entryId]: true }));
    setSuggestDataByEntry(prev => ({ ...prev, [entryId]: null }));
    const url =
      `/api/sampling-library/suggest?siteId=${siteId}` +
      `&skuCode=${encodeURIComponent(skuCode)}` +
      `&packCode=${encodeURIComponent(packCode)}`;
    fetch(url)
      .then(r => r.ok ? r.json() as Promise<SuggestResponse> : null)
      .then(data => {
        if (suggestVersionRef.current[entryId] !== myVersion) return; // stale
        setSuggestDataByEntry(prev => ({ ...prev, [entryId]: data }));
      })
      .catch(() => { /* render-nothing on failure per spec */ })
      .finally(() => {
        if (suggestVersionRef.current[entryId] !== myVersion) return;
        setSuggestLoadingByEntry(prev => ({ ...prev, [entryId]: false }));
      });
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
      flashActive:        !!existing,
      // Phase 4 (step 13): show "Linked sampling" card on edit re-open by
      // surfacing the saved selectedShadeName too. Cleared on new entries.
      selectedShadeName:  existing ? (existing.shadeName ?? null) : null,
      showAllColumns:     existing ? false : true,
      samplingNo:         existing ? existing.samplingNo : null,
      shadeName:          existing ? (existing.shadeName ?? "") : "",
      // Existing TI → land in confirm (show applied bar + values); fresh line →
      // browse the search-first list.
      mode:               existing ? "confirm" : "browse",
    }));

    if (existing) {
      setTinterType(existing.table);
      setEditingEntryId({ id: existing.id, table: existing.table });
      setTimeout(() => {
        setTiEntries(prev => prev.map(e => e.id !== entryId ? e : { ...e, flashActive: false }));
      }, 1500);
      return;
    }

    // Phase 4 — kick off suggest fetch for this (entry, SKU, pack, site).
    setEditingEntryId(null);
    if (!line.packCode || selectedJob.siteId == null) return;
    fetchSuggestForEntry(entryId, line.skuCodeRaw, line.packCode, selectedJob.siteId);
  }

  // ── Phase 4: apply a suggestion/search pick to an entry ──────────────────
  // Accepts SuggestFlatRow (this-site flat list AND cross-site search rows share
  // this shape). Type-aware: columns come from the CARD's own tinterType, never
  // the component toggle.
  function applySuggestionToEntry(entryId: string, card: SuggestFlatRow): void {
    // Map pigments using the CARD's own recipe type — NOT the component toggle.
    // An Acotone card clicked while the toggle still reads TINTER must still
    // copy its 14 Acotone columns (was the populate-fails bug).
    const cols = card.tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
    const shadeValues: Record<string, number> = {};
    for (const col of cols) {
      shadeValues[col.code] = Number(card.pigments[col.code] ?? 0);
    }
    // Flip the visible toggle to the card's type via the bare setter so the
    // grid renders the matching pigment rows. We deliberately do NOT call
    // handleTinterTypeChange here — that resets entries + wipes suggestions and
    // would erase the values we are about to apply (ordering trap).
    if (card.tinterType !== tinterType) setTinterType(card.tinterType);
    setTiEntries(prev => prev.map(e => e.id !== entryId ? e : {
      ...e,
      shadeValues,
      samplingNo:        card.samplingNo,
      shadeName:         card.shadeName,
      selectedShadeName: card.shadeName,
      flashActive:       true,
      showAllColumns:    false,
    }));
    setTimeout(() => {
      setTiEntries(prev => prev.map(e => e.id !== entryId ? e : { ...e, flashActive: false }));
    }, 1500);
  }

  // ── Search-first flow handlers ───────────────────────────────────────────

  // Debounced global search (operator-search). Version-guarded so a stale
  // response can't overwrite a newer query. type = current toggle.
  function fetchSearchForEntry(entryId: string, q: string): void {
    const myVersion = (searchVersionRef.current[entryId] ?? 0) + 1;
    searchVersionRef.current[entryId] = myVersion;
    setSearchLoadingByEntry(prev => ({ ...prev, [entryId]: true }));
    const url = `/api/sampling-library/operator-search?q=${encodeURIComponent(q)}&type=${tinterType}`;
    fetch(url)
      .then(r => r.ok ? r.json() as Promise<{ rows: SuggestFlatRow[] }> : null)
      .then(data => {
        if (searchVersionRef.current[entryId] !== myVersion) return; // stale
        setSearchResultsByEntry(prev => ({ ...prev, [entryId]: data?.rows ?? [] }));
      })
      .catch(() => {
        if (searchVersionRef.current[entryId] !== myVersion) return;
        setSearchResultsByEntry(prev => ({ ...prev, [entryId]: [] }));
      })
      .finally(() => {
        if (searchVersionRef.current[entryId] !== myVersion) return;
        setSearchLoadingByEntry(prev => ({ ...prev, [entryId]: false }));
      });
  }

  function handleSearchChange(entryId: string, value: string): void {
    setSearchByEntry(prev => ({ ...prev, [entryId]: value }));
    const existing = searchDebounceRef.current[entryId];
    if (existing) clearTimeout(existing);
    const q = value.trim();
    if (q === "") {
      // Empty query → browse falls back to this-site flatSuggestions. Bump the
      // version so any in-flight search response is discarded.
      searchVersionRef.current[entryId] = (searchVersionRef.current[entryId] ?? 0) + 1;
      setSearchResultsByEntry(prev => ({ ...prev, [entryId]: null }));
      setSearchLoadingByEntry(prev => ({ ...prev, [entryId]: false }));
      return;
    }
    searchDebounceRef.current[entryId] = setTimeout(() => fetchSearchForEntry(entryId, q), 300);
  }

  // "Use" — apply the row, then collapse the list to the confirm view.
  function handleUseSuggestion(entryId: string, row: SuggestFlatRow): void {
    applySuggestionToEntry(entryId, row);
    setTiEntries(prev => prev.map(e => e.id === entryId ? { ...e, mode: "confirm" } : e));
  }

  // "Add shade" — switch to the new-shade form (fresh pigment grid).
  function handleAddShade(entryId: string): void {
    setTiEntries(prev => prev.map(e => e.id === entryId ? {
      ...e,
      mode: "newshade",
      selectedShadeName: null, samplingNo: null, shadeName: "",
      shadeValues: {}, showAllColumns: true,
    } : e));
  }

  // "Back to list" / "Change" — drop the selection and return to browse.
  function handleBackToList(entryId: string): void {
    setTiEntries(prev => prev.map(e => e.id === entryId ? {
      ...e,
      mode: "browse",
      selectedShadeName: null, samplingNo: null, shadeName: "",
      shadeValues: {}, showAllColumns: true,
    } : e));
  }

  // Phase 4 (step 11): unconditional Sampling Library write — payload always
  // carries samplingNo (null for fresh shades) + shadeName. The server's
  // resolve-3-scenarios helper handles new-sampling / new-variant / existing-
  // variant routing in one call. No client-side /shades POST anymore.
  async function saveShadesThenSubmitTI(job: Job, _entryIds: string[], andStart: boolean = true) {
    const cols    = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
    const entries = tiEntries.filter(e => e.skuCodeRaw && e.tinQty > 0);
    const endpoint = tinterType === "TINTER"
      ? "/api/tint/operator/tinter-issue"
      : "/api/tint/operator/tinter-issue-b";
    const payload = {
      ...(tinterType === "TINTER" ? { orderId: job.orderId } : {}),
      splitId:          job.type === "split" ? job.id : undefined,
      tintAssignmentId: job.type === "order" ? job.tintAssignmentId : undefined,
      entries: entries.map(e => ({
        rawLineItemId: e.rawLineItemId || undefined,
        baseSku: e.skuCodeRaw, tinQty: e.tinQty, packCode: e.packCode || null,
        samplingNo:    e.samplingNo,
        shadeName:     e.shadeName.trim() || null,
        ...Object.fromEntries(cols.map(c => [c.code, e.shadeValues[c.code] ?? 0])),
      })),
    };
    const res = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? "Failed to submit TI");
    }
    // Response shape (per spec §4.2): { success, entries: [{ tiEntryId,
    // allocatedSamplingNo, isNewSampling, isNewVariant }] }. Both TINTER and
    // ACOTONE POST handlers iterate the request payload's entries sequentially
    // and push onto results in-order, so response.entries[i] corresponds
    // positionally to entries[i] above — safe to use index for packCode/etc.
    const data = (await res.json().catch(() => null)) as {
      success?: number;
      entries?: Array<{
        tiEntryId:           number;
        allocatedSamplingNo: string;
        isNewSampling:       boolean;
        isNewVariant:        boolean;
      }>;
    } | null;
    const respEntries = data?.entries ?? [];

    // Write allocated samplingNo back to form state for the brief window before
    // loadExistingTIEntries refetches and the auto-select effect repopulates.
    // Step 13 will extend the TI GET endpoint to round-trip samplingNo so the
    // value survives the reload; popup correctness here doesn't depend on it
    // — the popup reads `firstNew`/`firstVariant` directly off respEntries.
    setTiEntries(prev => {
      const filteredIdxByEntryId = new Map<string, number>();
      let k = 0;
      for (const e of prev) {
        if (e.skuCodeRaw && e.tinQty > 0) filteredIdxByEntryId.set(e.id, k++);
      }
      return prev.map(e => {
        const i = filteredIdxByEntryId.get(e.id);
        if (i === undefined) return e;
        const r = respEntries[i];
        if (!r) return e;
        // Surface selectedShadeName too so the Applied shade bar pill appears
        // immediately after a fresh-shade save (step 13c). For picker-clicked
        // entries selectedShadeName is already set; this fills the gap for
        // hand-typed shade names where applySuggestionToEntry never ran.
        const nextSelected = e.selectedShadeName ?? (e.shadeName.trim() || null);
        return {
          ...e,
          samplingNo:        r.allocatedSamplingNo,
          selectedShadeName: nextSelected,
        };
      });
    });

    // First Scenario 1 wins the popup; otherwise first Scenario 2; else silent.
    const firstNew = respEntries.find(r => r.isNewSampling);
    const firstVariant = !firstNew
      ? respEntries.find(r => r.isNewVariant)
      : undefined;
    if (firstNew) {
      const idx = respEntries.indexOf(firstNew);
      setSamplingPopup({
        scenario:   "new_sampling",
        samplingNo: firstNew.allocatedSamplingNo,
        packCode:   entries[idx]?.packCode ?? null,
      });
    } else if (firstVariant) {
      const idx = respEntries.indexOf(firstVariant);
      setSamplingPopup({
        scenario:   "new_variant",
        samplingNo: firstVariant.allocatedSamplingNo,
        packCode:   entries[idx]?.packCode ?? null,
      });
    }

    await fetchOrders();
    await loadExistingTIEntries(job);
    // existingTIEntries update triggers the auto-select effect which repopulates the form
    setTiIncompleteWarning(null);
    setTiSuccessToast(true);
    setTimeout(() => setTiSuccessToast(false), 3000);
    if (andStart && job.status !== "tinting_in_progress") {
      await startJob(job);
    }
  }

  async function handleSubmitTI(job: Job, andStart: boolean = true) {
    if (tiEntries.length === 0) { setError("Add at least one entry"); return; }
    for (const e of tiEntries) {
      if (!e.skuCodeRaw) { setError("Select a SKU line for all entries"); return; }
      if (e.tinQty <= 0) { setError("Tin Qty must be greater than 0 for all entries"); return; }
      // Phase 4 (step 11): unconditional Sampling Library write. Without a
      // picked suggestion (samplingNo) the operator must type a fresh name.
      if (!e.samplingNo && !e.shadeName.trim()) {
        setError("Enter a shade name or pick a suggestion above");
        return;
      }
    }
    setTiActionLoading(true);
    setError(null);
    try {
      await saveShadesThenSubmitTI(job, [], andStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit TI");
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
          flashActive:        true,
          // Phase 4 (step 13): hydrate Sampling Library linkage from the
          // saved record (round-tripped via the GET endpoint), so the
          // "Linked sampling" card renders after page reload.
          samplingNo:         existing.samplingNo,
          shadeName:          existing.shadeName ?? "",
          selectedShadeName:  existing.shadeName ?? null,
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
        // Phase 4 (step 11): always send samplingNo + shadeName so the PATCH
        // endpoint can correctly route Scenario 3 mid-edit (same samplingNo →
        // update existing recipe's pigments) vs operator switching to a
        // different suggestion mid-edit (new samplingNo → rewrite TI row,
        // don't clobber the old shade's recipe).
        samplingNo:    entry.samplingNo,
        shadeName:     entry.shadeName.trim() || null,
        ...Object.fromEntries(cols.map(c => [c.code, entry.shadeValues[c.code] ?? 0])),
      }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? "Failed to update entry");
    }
    await loadExistingTIEntries(job);
    // existingTIEntries update triggers the auto-select effect which repopulates the form
    setTiUpdateToast(true);
    setTimeout(() => setTiUpdateToast(false), 3000);
  }

  async function handleUpdateEntry(job: Job) {
    const entry = tiEntries[0];
    if (!entry || !editingEntryId) return;
    if (!entry.skuCodeRaw) { setError("Select a SKU line for entry 1"); return; }
    if (entry.tinQty <= 0) { setError("Tin Qty must be greater than 0 for entry 1"); return; }
    if (!entry.samplingNo && !entry.shadeName.trim()) {
      setError("Enter a shade name or pick a suggestion above");
      return;
    }
    setTiActionLoading(true);
    setError(null);
    try {
      await doPatchEntry(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update entry");
    } finally {
      setTiActionLoading(false);
    }
  }

  // Phase 4d — Resume a paused assignment. Client gate (canResumeAny) mirrors
  // the server's zero-in-progress check in /api/tint/operator/resume so a
  // green-button click never trips the 409 in normal use.
  async function handleResume(assignmentId: number): Promise<void> {
    if (resumingId != null) return;
    setResumingId(assignmentId);
    try {
      const res = await fetch("/api/tint/operator/resume", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ assignmentId }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { ok?: boolean }).ok === false) {
        const errRaw = (data as { error?: unknown }).error;
        const errMsg = typeof errRaw === "string" ? errRaw : "Could not resume job. Please retry.";
        toast.error(errMsg);
        return;
      }
      toast.success("Job resumed");
      await fetchOrders();
    } catch (err) {
      console.error("[resume-job] submit failed", err);
      toast.error("Network error. Please retry.");
    } finally {
      setResumingId(null);
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
  const progressColor = progressPct < 25 ? "bg-amber-600" : progressPct < 75 ? "bg-teal-600" : "bg-green-600";
  const progressTextColor = progressPct < 25 ? "text-amber-700" : progressPct < 75 ? "text-teal-700" : "text-green-700";

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

  // Auto-select first uncovered tinting line when job changes or TI entries update
  useEffect(() => {
    if (!selectedJob) { setSelectedLineIdx(0); return; }
    const lines = selectedJob.lineItems.filter(li => li.rawLineItem.isTinting);
    const firstUncovered = lines.findIndex(l => !existingTIEntries.has(l.rawLineItemId ?? 0));
    const newIdx = firstUncovered >= 0 ? firstUncovered : 0;
    setSelectedLineIdx(newIdx);
    // Also populate form for the auto-selected line
    const line = lines[newIdx];
    if (line) handleStripRowClick(line.rawLineItemId ?? 0);
  }, [selectedJob?.id, selectedJob?.type, existingTIEntries]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* UniversalHeader — Row 1 + Row 2 with job pill via leftExtra */}
      <UniversalHeader
        title="My Jobs"
        showImport={canImportOBDs}
        stats={[
          { label: "in queue", value: jobs.length },
          { label: "active", value: inProgressCount },
          { label: "done today", value: completedCount },
        ]}
        showDatePicker={false}
        leftExtra={
          (selectedJob || pausedJobs.length > 0) ? (
            <div className="flex items-center gap-2">
              {/* Segment container + teal pill */}
              <div className="relative" ref={queueBadgeRef}>
                <div className="inline-flex bg-gray-100 rounded-[7px] p-[3px]">
                  {selectedJob ? (
                    <div
                      onClick={() => setQueueDropdownOpen(!queueDropdownOpen)}
                      className="inline-flex items-center gap-2.5 rounded-[5px] px-3.5 py-[7px] cursor-pointer transition-colors bg-teal-600 text-white font-medium hover:bg-teal-700"
                    >
                      <span className="text-[11px] font-semibold opacity-80">#{jobs.indexOf(selectedJob) + 1}</span>
                      <span className="text-[13px] font-semibold truncate max-w-[180px]">{selectedJob.customerName}</span>
                      <span className="font-mono text-[11px] opacity-70">{selectedJob.obdNumber}</span>
                      <ChevronDown size={14} className={cn("opacity-70 transition-transform flex-shrink-0", queueDropdownOpen && "rotate-180")} />
                    </div>
                  ) : (
                    /* Surface 1C — no CURRENT, only paused work on the shelf. */
                    <div
                      onClick={() => setQueueDropdownOpen(!queueDropdownOpen)}
                      className="inline-flex items-center gap-2.5 rounded-[5px] px-3.5 py-[7px] cursor-pointer transition-colors bg-amber-50 border border-amber-200 text-amber-800 font-medium hover:bg-amber-100"
                    >
                      <Pause size={12} fill="currentColor" />
                      <span className="text-[12.5px] font-semibold">No active job</span>
                      <span className="text-[11px] opacity-80">· {pausedJobs.length} paused</span>
                      <ChevronDown size={14} className={cn("opacity-70 transition-transform flex-shrink-0", queueDropdownOpen && "rotate-180")} />
                    </div>
                  )}
                </div>

                {/* Queue Dropdown */}
                {queueDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1.5 z-50 w-[400px] bg-white border border-gray-200 rounded-[10px] shadow-[0_8px_24px_rgba(0,0,0,0.12)] overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] font-bold text-gray-900">Today&apos;s Target</p>
                        <div className="text-right">
                          <span className="text-[18px] font-bold text-gray-900">{totalDoneToday}</span>
                          <span className="text-[13px] text-gray-400"> of {totalAssignedToday}</span>
                        </div>
                      </div>
                      <div className="w-full h-[6px] bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${Math.min(progressPct, 100)}%` }} />
                      </div>
                    </div>
                    <div className="max-h-[480px] overflow-y-auto py-2">
                      {/* === CURRENT === */}
                      <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                        Current ({jobs.length > 0 ? 1 : 0})
                      </p>
                      {jobs.length > 0 ? (() => {
                        const job        = jobs[0];
                        const isCurrent  = selectedJobId === job.id && selectedJobType === job.type;
                        const inProgress = job.status === "tinting_in_progress";
                        return (
                          <button
                            key={`q-cur-${job.type}-${job.id}`}
                            onClick={() => { setSelectedJobId(job.id); setSelectedJobType(job.type); setQueueDropdownOpen(false); }}
                            className={cn("w-full text-left px-3 py-2 transition-colors",
                              isCurrent ? "bg-teal-50 border-l-[3px] border-l-teal-600" : "border-l-[3px] border-l-transparent hover:bg-gray-50")}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-gray-400">#1</span>
                              <span className="text-[12px] font-semibold text-gray-900 truncate flex-1">{job.customerName}</span>
                              <span className="font-mono text-[11px] text-gray-500">{job.obdNumber}</span>
                              {inProgress ? (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-green-50 text-green-700 border-green-200">In Progress</span>
                              ) : (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">Ready</span>
                              )}
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
                      })() : (
                        <div className="mx-3 mb-2 px-3 py-4 border border-dashed border-gray-200 rounded-lg text-center">
                          <Inbox className="text-gray-400 mx-auto mb-1.5" size={20} />
                          <div className="text-[12px] font-semibold text-gray-600">No active job</div>
                          <div className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                            All assigned jobs are paused or complete.<br />
                            Resume a paused job to continue.
                          </div>
                        </div>
                      )}

                      {/* === PAUSED === */}
                      {pausedJobs.length > 0 && (
                        <>
                          <p className="px-3 mt-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                            Paused ({pausedJobs.length})
                          </p>
                          {pausedJobs.map(job => {
                            const isExpanded    = expandedPausedId === job.id;
                            const progressArr   = job.currentProgress?.items ?? [];
                            const tintingLines  = job.lineItems.filter(li => li.rawLineItem.isTinting);
                            const totalAssigned = tintingLines.reduce((s, li) => s + li.rawLineItem.unitQty, 0);
                            const totalDone     = progressArr.reduce((s, p) => s + p.doneQty, 0);
                            // Phase 4d — Resume gate. Mirrors the server's zero-in-progress
                            // precondition in /api/tint/operator/resume.
                            const canResumeAny  = !jobs.some(j => j.status === "tinting_in_progress");
                            const isResumingThis = resumingId === job.id;
                            const remarkTrimmed = job.lastPauseRemark?.trim() ?? "";
                            const remarkDisplay = remarkTrimmed.length > 80
                              ? `${remarkTrimmed.slice(0, 80)}…`
                              : remarkTrimmed;
                            return (
                              <div key={`q-pau-${job.type}-${job.id}`} className="mx-3 mb-2 bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
                                <div className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[12px] font-semibold text-gray-900 truncate flex-1">{job.customerName}</span>
                                    <span className="font-mono text-[11px] text-gray-600">{job.obdNumber}</span>
                                    <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-700 text-white">
                                      <Pause size={9} fill="currentColor" />
                                      Paused{job.pauseCount > 1 ? ` ${job.pauseCount}×` : ""}
                                    </span>
                                  </div>
                                  <div className="bg-amber-100/60 border border-amber-200 rounded-md px-2 py-1.5 mt-2 text-[10.5px] text-amber-800 leading-relaxed">
                                    {job.lastPausedAt && (
                                      <div>Last paused: {formatTimeAgo(job.lastPausedAt)}</div>
                                    )}
                                    <div className="mt-0.5">Reason: {humaniseReason(job.lastPauseReason)}</div>
                                    {remarkTrimmed && (
                                      <div
                                        className="mt-0.5 italic text-gray-600 truncate"
                                        title={remarkTrimmed.length > 80 ? remarkTrimmed : undefined}
                                      >
                                        Note: {remarkDisplay}
                                      </div>
                                    )}
                                    {totalAssigned > 0 && (
                                      <div className="mt-0.5">Progress: {totalDone} of {totalAssigned} tins done</div>
                                    )}
                                  </div>

                                  <div className="flex items-center justify-end gap-2 mt-2">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedPausedId(isExpanded ? null : job.id)}
                                      className="h-7 px-2.5 text-[11px] font-medium bg-white border border-amber-300 text-amber-700 rounded-md hover:bg-amber-100 inline-flex items-center gap-1"
                                    >
                                      <Eye size={11} />
                                      {isExpanded ? "Hide" : "View"} Progress
                                    </button>
                                    {/* Phase 4d — conditional Resume render. Enabled when no
                                        in-progress job; disabled+Tooltip otherwise. */}
                                    {canResumeAny ? (
                                      <button
                                        type="button"
                                        onClick={() => handleResume(job.tintAssignmentId!)}
                                        disabled={isResumingThis || resumingId != null}
                                        className={cn(
                                          "h-7 px-2.5 text-[11px] font-medium rounded-md inline-flex items-center gap-1 text-white",
                                          isResumingThis || resumingId != null
                                            ? "bg-gray-400 cursor-not-allowed"
                                            : "bg-gray-900 hover:bg-black cursor-pointer",
                                        )}
                                      >
                                        {isResumingThis ? (
                                          <>
                                            <Loader2 size={11} className="animate-spin" />
                                            Resuming…
                                          </>
                                        ) : (
                                          <>
                                            <Play size={11} />
                                            Resume
                                          </>
                                        )}
                                      </button>
                                    ) : (
                                      <Tooltip content="Finish or pause your current job before resuming this one.">
                                        <button
                                          type="button"
                                          disabled
                                          className="h-7 px-2.5 text-[11px] font-medium bg-gray-200 text-gray-500 rounded-md inline-flex items-center gap-1 cursor-not-allowed"
                                        >
                                          <Play size={11} />
                                          Resume
                                        </button>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="bg-white border-t border-amber-200 px-3 py-2.5">
                                    <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Per-SKU progress</div>
                                    {tintingLines.length === 0 ? (
                                      <div className="text-[11px] text-gray-400 italic">No tinting lines on this OBD.</div>
                                    ) : tintingLines.map(li => {
                                      const done = progressArr.find(p => p.skuId === (li.rawLineItemId ?? -1))?.doneQty ?? 0;
                                      return (
                                        <div key={li.rawLineItemId} className="flex items-center justify-between text-[11px] py-0.5">
                                          <span className="font-mono text-gray-600 truncate flex-1 mr-2">{li.rawLineItem.skuCodeRaw}</span>
                                          <span className="text-gray-700 font-semibold tabular-nums">{done} / {li.rawLineItem.unitQty}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      )}

                      {/* === UP NEXT === */}
                      <p className="px-3 mt-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                        Up Next ({Math.max(jobs.length - 1, 0)})
                      </p>
                      {jobs.length > 1 ? (
                        jobs.slice(1).map((job, idx) => {
                          const isCurrent = selectedJobId === job.id && selectedJobType === job.type;
                          const tintingCount = job.lineItems.filter(li => li.rawLineItem.isTinting).length;
                          // Up-next rows remain click-to-select for prep workflows; visually
                          // styled as compact read-only previews per spec.
                          return (
                            <button
                              key={`q-up-${job.type}-${job.id}`}
                              onClick={() => { setSelectedJobId(job.id); setSelectedJobType(job.type); setQueueDropdownOpen(false); }}
                              className={cn("w-full text-left px-3 py-1.5 transition-colors opacity-70 hover:opacity-100",
                                isCurrent ? "bg-teal-50 border-l-[3px] border-l-teal-600" : "border-l-[3px] border-l-transparent hover:bg-gray-50")}
                            >
                              <div className="flex items-center gap-2 text-[11.5px] text-gray-600">
                                <span className="font-mono text-[10px] text-gray-400">#{idx + 2}</span>
                                <span className="font-mono text-[11px] text-gray-500">{job.obdNumber}</span>
                                <span className="text-gray-400">·</span>
                                <span className="font-medium text-gray-700 truncate flex-1">{job.customerName}</span>
                                {tintingCount > 0 && (
                                  <span className="text-[10px] text-gray-400">{tintingCount} SKU{tintingCount === 1 ? "" : "s"}</span>
                                )}
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="mx-3 px-3 py-2 text-[11px] text-gray-400 italic text-center">
                          Nothing queued. Check with Chandresh for new assignments.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Status badge — only when a CURRENT job is selected */}
              {selectedJob && (selectedJob.status === "tinting_in_progress" ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-[5px] border bg-green-50 border-green-200 text-green-700 flex-shrink-0">In Progress</span>
              ) : (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-[5px] border bg-amber-50 border-amber-200 text-amber-700 flex-shrink-0">Assigned</span>
              ))}

              {/* Timer (in progress) */}
              {selectedJob && selectedJob.status === "tinting_in_progress" && elapsed && (
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-md px-2 py-0.5 flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse flex-shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-gray-600">{elapsed}</span>
                </div>
              )}
            </div>
          ) : undefined
        }
        rightExtra={
          <div className="flex items-center gap-2">
            <SkuDisplayToggle />
            <div className="w-px h-4 bg-gray-200" />
            <div className="w-[48px] h-[4px] bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${progressColor}`} style={{ width: `${Math.min(progressPct, 100)}%` }} />
            </div>
            <span className={cn("text-[11px] font-semibold", progressTextColor)}>{totalDoneToday}/{totalAssignedToday}</span>
          </div>
        }
      />

      {/* Row 3: Bill To / Ship To Cards */}
      {selectedJob && (
        <div className="bg-white border-b border-gray-200 px-5 py-2 grid grid-cols-2 gap-3 flex-shrink-0" style={{ position: "sticky", top: 96, zIndex: 30 }}>
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-3">
            <div className="text-[9px] font-semibold uppercase tracking-[.4px] text-gray-400 mb-1">Bill to (customer)</div>
            <div className="text-[13px] font-semibold text-gray-900">{selectedJob.billToCustomerName ?? "—"}</div>
            <div className="font-mono text-[11px] text-gray-400 mt-0.5">{selectedJob.billToCustomerId ?? "—"}</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-3">
            <div className="text-[9px] font-semibold uppercase tracking-[.4px] text-gray-400 mb-1">Ship to (site)</div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[13px] font-semibold text-gray-900">{selectedJob.customerName}</div>
              {/* Phase 4 (step 16b) — site history badge. Violet for fresh
                  sites, emerald for sites with prior TIs. Distinct from the
                  amber cluster (Pending TI / MISSING / customer-missing
                  strip) and from the purple Split / green Done cousins. */}
              {siteHistorySummary && (
                <span className={cn(
                  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
                  siteHistorySummary.isNewSite
                    ? "bg-violet-50 text-violet-700 border-violet-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200",
                )}>
                  {siteHistorySummary.isNewSite ? "New site" : "Repeat site"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-0.5">
              {selectedJob.deliveryTypeName && <span className={cn("w-[5px] h-[5px] rounded-full flex-shrink-0", deliveryDotClass(selectedJob.deliveryTypeName))} />}
              {[selectedJob.deliveryTypeName, selectedJob.areaName, selectedJob.routeName].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN SPLIT ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL — SKU Lines (320px) ──────────────────────────── */}
        <div className="hidden md:flex w-[320px] flex-shrink-0 border-r border-gray-200 flex-col bg-white overflow-hidden">

          {selectedJob ? (
            <>
              {/* Tinting lines header */}
              <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                <span className="text-[10px] font-extrabold uppercase tracking-[.6px] text-gray-400">Tinting lines</span>
                <span className="text-[10px] text-gray-400">
                  {currentTintingLines.length} {currentTintingLines.length === 1 ? "line" : "lines"} · {selectedJob.totalVolume != null ? `${Math.round(selectedJob.totalVolume)} L` : "—"}
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
                        "px-3 py-2.5 border-b border-gray-100 cursor-pointer transition-colors",
                        isSelected
                          ? "bg-gray-100 border-l-[3px] border-l-gray-900"
                          : "bg-white hover:bg-gray-50"
                      )}
                    >
                      {/* Row 1: SKU code + status badge */}
                      {(() => {
                        const d = pickSkuDisplay(item.rawLineItem.skuDisplay, skuDisplayMode);
                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[11px] text-gray-500 truncate">{d.code}</span>
                              {tiEntry ? (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 border border-green-200 text-green-700 flex-shrink-0 ml-1">✓</span>
                              ) : (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 flex-shrink-0 ml-1">Pending</span>
                              )}
                            </div>
                            {/* Row 2: Description */}
                            <div className="text-[12px] font-semibold text-gray-900 truncate mt-0.5">
                              {d.description ?? "—"}
                            </div>
                          </>
                        );
                      })()}
                      {/* Row 3: Qty · Volume */}
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {item.rawLineItem.unitQty} qty · {item.rawLineItem.volumeLine != null ? `${item.rawLineItem.volumeLine} L` : "—"}
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
                        <span className="font-mono">{pickSkuDisplay(item.rawLineItem.skuDisplay, skuDisplayMode).code}</span>
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
                        {covered} of {total} {total === 1 ? "line" : "lines"} covered
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
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
              <div className="w-10 h-10 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <p className="text-[13px] font-semibold text-gray-500">Queue is clear!</p>
              <p className="text-[11px] text-gray-400">All jobs done for today.</p>
            </div>
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
                <div className="min-w-0 flex-1">
                  {currentTintingLines[selectedLineIdx] ? (
                    (() => {
                      const activeLine = currentTintingLines[selectedLineIdx].rawLineItem;
                      const d = pickSkuDisplay(activeLine.skuDisplay, skuDisplayMode);
                      return (
                        <>
                          <div className="text-[13px] font-semibold text-gray-900 truncate">
                            {d.description ?? d.code}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            <span className="font-mono">{d.code}</span>
                            <span> · {activeLine.unitQty} qty</span>
                            {activeLine.volumeLine != null && <span> · {activeLine.volumeLine} L</span>}
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <span className="text-[11px] text-gray-400">No line selected</span>
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
              <div className="flex-1 overflow-y-auto px-4 pt-2.5 pb-3">

                {tintingLines.length === 0 && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
                    <p className="text-[12px] text-gray-400">No tinting lines in this job — start directly.</p>
                  </div>
                )}

                {tintingLines.length > 0 && tiEntries.map((entry, idx) => {
                  const shadeColumns = tinterType === "TINTER" ? SHADES : ACOTONE_SHADES;
                  const flash = entry.flashActive;
                  const entryId = entry.id;
                  // Browse-mode data: typed query → global search results;
                  // empty query → this-site flatSuggestions (exact pinned).
                  const searchVal     = searchByEntry[entryId] ?? "";
                  const isSearching   = searchVal.trim() !== "";
                  const browseRows    = isSearching
                    ? (searchResultsByEntry[entryId] ?? [])
                    : (suggestDataByEntry[entryId]?.flatSuggestions ?? []);
                  const browseLoading = isSearching
                    ? !!searchLoadingByEntry[entryId]
                    : !!suggestLoadingByEntry[entryId];

                  return (
                    <div key={entryId} className="mb-4">
                      {/* Entry header — only when multiple entries or editing */}
                      {(tiEntries.length > 1 || editingEntryId) && (
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
                      )}

                      {/* Base SKU Dropdown — hidden for first entry (driven by left panel selection) */}
                      {idx > 0 && (
                        <div className="mb-2.5">
                          <select
                            value={entry.rawLineItemId ?? ""}
                            onChange={e => { const val = Number(e.target.value); if (val) handleSkuSelect(entryId, val); }}
                            className={`w-full border border-gray-200 rounded-md h-[34px] text-[12px] px-2 font-medium focus:border-gray-900 focus:outline-none ${entry.rawLineItemId ? "text-gray-900" : "text-gray-400"}`}>
                            <option value="">Select SKU line…</option>
                            {tintingLines.map(line => {
                              const d = pickSkuDisplay(line.skuDisplay, skuDisplayMode);
                              return (
                                <option key={line.rawLineItemId} value={line.rawLineItemId}>
                                  {d.code}{d.description ? ` · ${d.description}` : ""} · {line.unitQty} qty · {PACK_CODES.find(p => p.value === line.packCode)?.label ?? line.packCode}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      )}

                      {/* BROWSE — search-first flat suggestion list. Renders
                          once a tinting line is picked. Empty query → this-site
                          flatSuggestions; typed query → global search. */}
                      {entry.mode === "browse" && entry.skuCodeRaw && (
                        <FlatSuggestionList
                          rows={browseRows}
                          isLoading={browseLoading}
                          searchValue={searchVal}
                          onSearchChange={(v) => handleSearchChange(entryId, v)}
                          onUse={(row) => handleUseSuggestion(entryId, row)}
                          onAddShade={() => handleAddShade(entryId)}
                        />
                      )}

                      {/* CONFIRM / NEW-SHADE — collapsed selection + form */}
                      {(entry.mode === "confirm" || entry.mode === "newshade") && (
                      <>
                      {/* Back / Change control */}
                      <div className="mb-2">
                        <button type="button" onClick={() => handleBackToList(entryId)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-800 bg-transparent border-none cursor-pointer p-0">
                          ← {entry.mode === "confirm" ? "Change / back to list" : "Back to list"}
                        </button>
                      </div>

                      {/* New-shade: hand-typed shade name (new sampling on save) */}
                      {entry.mode === "newshade" && (
                        <div className="mb-3 px-3.5 py-2 bg-white border border-gray-200 rounded-lg flex items-center gap-2">
                          <label className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 flex-shrink-0">Shade name</label>
                          <input type="text" placeholder="e.g. Ivory White" value={entry.shadeName}
                            onChange={e => setTiEntries(prev => prev.map(en => en.id === entryId ? { ...en, shadeName: e.target.value } : en))}
                            className="flex-1 h-[32px] border rounded-md text-[12px] px-2.5 font-medium text-gray-900 border-gray-200 focus:border-gray-900 focus:outline-none" />
                          <span className="text-[10px] text-gray-400 italic flex-shrink-0">
                            (new shade — saves a new sampling no)
                          </span>
                        </div>
                      )}

                      {/* Form card */}
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">

                        {/* Applied shade bar (pinned top). Step 13c: when a
                            samplingNo is bound, the pill leads with the
                            mono-formatted number so the operator can see the
                            Sampling Library link without reopening the popup. */}
                        {entry.selectedShadeName !== null && (
                          <div className="flex items-center justify-between px-3.5 py-2 bg-gray-50 border-b border-gray-200">
                            <span className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-300 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-gray-900">
                              <Palette size={11} />
                              {entry.samplingNo && (
                                <>
                                  <span className="font-mono font-medium text-gray-700">
                                    #{entry.samplingNo}
                                  </span>
                                  <span className="text-gray-300 mx-1.5">·</span>
                                </>
                              )}
                              {entry.selectedShadeName}
                            </span>
                            <button type="button"
                              onClick={() => handleBackToList(entryId)}
                              className="text-[10px] font-bold text-red-600 bg-transparent border-none cursor-pointer">
                              Clear ×
                            </button>
                          </div>
                        )}

                        {/* Compact qty row: Tin Qty + Pack Size */}
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
                        </div>

                        {/* Shade Grid */}
                        <div className="px-3.5 py-3">
                          {(() => {
                            const allCols = shadeColumns as readonly { code: string; bg: string; border: string; text: string }[];
                            const activeCols = allCols.filter(col => (entry.shadeValues[col.code] ?? 0) > 0);
                            const displayCols = (!entry.showAllColumns && activeCols.length > 0) ? activeCols : allCols;
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
                                  {(() => {
                                    const colorMap = tinterType === "TINTER" ? TINTER_SHADE_COLORS : ACOTONE_SHADE_COLORS;
                                    return displayCols.map(shade => {
                                      const hasVal = (entry.shadeValues[shade.code] ?? 0) > 0;
                                      const sc = colorMap[shade.code];
                                      return (
                                        <div key={shade.code} className="flex flex-col items-center gap-[3px]">
                                          <span style={{ color: sc?.label ?? "#9ca3af" }} className="text-[9px] font-bold uppercase tracking-[.3px]">{shade.code}</span>
                                          <input type="number" min={0} step={0.01} placeholder="—"
                                            value={entry.shadeValues[shade.code] || ""}
                                            onChange={e => setTiEntries(prev => prev.map(en => en.id === entryId ? { ...en, shadeValues: { ...en.shadeValues, [shade.code]: Number(e.target.value) } } : en))}
                                            style={{
                                              background: hasVal ? (sc?.bgFill ?? "#f0fdf4") : (sc?.bg ?? "#fff"),
                                              borderTop: `3px solid ${hasVal ? (sc?.topFill ?? "#d1d5db") : (sc?.top ?? "#d1d5db")}`,
                                              borderLeft: `1.5px solid ${hasVal ? (sc?.topFill ?? "#d1d5db") : (sc?.border ?? "#d1d5db")}`,
                                              borderRight: `1.5px solid ${hasVal ? (sc?.topFill ?? "#d1d5db") : (sc?.border ?? "#d1d5db")}`,
                                              borderBottom: `1.5px solid ${hasVal ? (sc?.topFill ?? "#d1d5db") : (sc?.border ?? "#d1d5db")}`,
                                              borderRadius: "0 0 6px 6px",
                                            }}
                                            className={cn("w-[56px] h-[34px] text-center text-[13px] font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400/20 transition-colors",
                                              flash && "ring-2 ring-amber-300"
                                            )} />
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      </>
                      )}
                    </div>
                  );
                })}

              </div>

              {/* Footer bar (pinned) */}
              <div className="border-t border-gray-200 bg-white px-5 py-2.5 flex-shrink-0 flex items-center gap-3">
                {/* LEFT: Line navigation */}
                <div className="flex items-center gap-1.5 mr-auto">
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

                {/* RIGHT: Action buttons */}
                {(() => {
                  const isActionLoading = (selectedJob.type === "split"
                    ? splitActionLoading === selectedJob.id
                    : orderActionLoading === selectedJob.id) || tiActionLoading;

                  const isCurrentJob = selectedJob.status === "tinting_in_progress" ||
                    (jobs.length > 0 && jobs[0].id === selectedJob.id && jobs[0].type === selectedJob.type && !jobs.some(j => j.status === "tinting_in_progress"));

                  const btnSave = "h-[42px] px-5 bg-gray-900 text-white border-none rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap flex-shrink-0 transition-opacity";
                  const btnGreen = "h-[42px] px-5 bg-green-600 text-white border-none rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap flex-shrink-0 transition-opacity";

                  // STATE C: In progress → Add TI Entry + Mark as Done
                  if (selectedJob.status === "tinting_in_progress") {
                    const isTILoading = tiActionLoading;
                    const isDoneLoading = selectedJob.type === "split" ? splitActionLoading === selectedJob.id : orderActionLoading === selectedJob.id;
                    const anyLoading = isTILoading || isDoneLoading;
                    return (
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        {tiIncompleteWarning && tiIncompleteWarning.length > 0 && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                            <p className="text-[12px] font-bold text-amber-700 mb-1">Some tinting lines are missing TI entries:</p>
                            <ul className="text-[11.5px] text-amber-600 mb-1.5 ml-3.5" style={{ padding: 0 }}>
                              {tiIncompleteWarning.map(line => {
                                const match = tintingLines.find(t => t.rawLineItemId === line.rawLineItemId);
                                const d = match
                                  ? pickSkuDisplay(match.skuDisplay, skuDisplayMode)
                                  : { code: line.skuCodeRaw, description: line.skuDescriptionRaw };
                                return (
                                  <li key={line.rawLineItemId}>{d.code}{d.description ? ` · ${d.description}` : ""}</li>
                                );
                              })}
                            </ul>
                            <p className="text-[11px] text-amber-700">Submit remaining entries or proceed to mark as done.</p>
                          </div>
                        )}
                        <div className="flex gap-2">
                          {editingEntryId ? (
                            <button type="button" onClick={() => handleUpdateEntry(selectedJob)} disabled={anyLoading}
                              className={cn(btnSave, anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-800")}>
                              {isTILoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              Update TI Entry
                            </button>
                          ) : (
                            <button type="button" onClick={() => handleSubmitTI(selectedJob, false)} disabled={anyLoading}
                              className={cn(btnSave, anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-800")}>
                              {isTILoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                              Add TI Entry
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              // Phase 4f — splits use the legacy one-shot /split/done
                              // route (untouched). Whole-OBD orders open the new
                              // confirm modal which collects per-SKU final qty.
                              if (selectedJob.type === "split") {
                                void markDone(selectedJob);
                                return;
                              }
                              // Client-side TI-completion preflight. existingTIEntries
                              // is already maintained for the active job; this
                              // surfaces the existing per-line "TI incomplete" warning
                              // BEFORE the modal opens, preserving the Phase 3 UX.
                              // The server still re-checks defensively.
                              const tintingLines = selectedJob.lineItems
                                .filter(li => li.rawLineItem.isTinting);
                              const missing = tintingLines.filter(
                                li => !existingTIEntries.has(li.rawLineItemId ?? 0),
                              );
                              if (missing.length > 0) {
                                setTiIncompleteWarning(missing.map(li => ({
                                  rawLineItemId:     li.rawLineItemId ?? 0,
                                  skuCodeRaw:        li.rawLineItem.skuCodeRaw,
                                  skuDescriptionRaw: li.rawLineItem.skuDescriptionRaw,
                                })));
                                return;
                              }
                              setTiIncompleteWarning(null);
                              setMarkDoneModalJob({
                                orderId:            selectedJob.id,
                                obdNumber:          selectedJob.obdNumber,
                                customerName:       selectedJob.customerName,
                                startedAt:          selectedJob.startedAt,
                                accumulatedMinutes: selectedJob.accumulatedMinutes,
                                pauseCount:         selectedJob.pauseCount,
                                skus: selectedJob.lineItems
                                  .filter(li => li.rawLineItem.isTinting && li.rawLineItemId != null)
                                  .map(li => ({
                                    skuId:       li.rawLineItemId as number,
                                    skuCode:     li.rawLineItem.skuCodeRaw,
                                    shadeName:   li.rawLineItem.skuDescriptionRaw ?? li.rawLineItem.skuCodeRaw,
                                    assignedQty: li.rawLineItem.unitQty,
                                  })),
                              });
                            }}
                            disabled={anyLoading}
                            className={cn(btnGreen, anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-green-700")}>
                            {isDoneLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            Mark as Done
                          </button>
                          {/* Phase 4c — Pause CTA. Whole-OBD only; route rejects splits. */}
                          {selectedJob.type === "order" && selectedJob.tintAssignmentId !== null && selectedJob.startedAt && (
                            <button
                              type="button"
                              onClick={() => setPauseModalJob({
                                id:           selectedJob.tintAssignmentId!,
                                obdNumber:    selectedJob.obdNumber,
                                customerName: selectedJob.customerName,
                                startedAt:    selectedJob.startedAt!,
                                skus: selectedJob.lineItems
                                  .filter(li => li.rawLineItem.isTinting && li.rawLineItemId != null)
                                  .map(li => ({
                                    skuId:       li.rawLineItemId as number,
                                    skuCode:     li.rawLineItem.skuCodeRaw,
                                    shadeName:   li.rawLineItem.skuDescriptionRaw ?? li.rawLineItem.skuCodeRaw,
                                    assignedQty: li.rawLineItem.unitQty,
                                  })),
                              })}
                              disabled={anyLoading}
                              className={cn(
                                "h-[42px] px-5 bg-amber-600 text-white border-none rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 whitespace-nowrap flex-shrink-0 transition-opacity",
                                anyLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-amber-700",
                              )}
                              title="Pause this job — frees your slot for the next assignment"
                            >
                              <Pause size={14} fill="currentColor" />
                              Pause
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // ASSIGNED STATE — current job
                  if (isCurrentJob) {
                    // No tinting lines → Start directly
                    if (tintingLines.length === 0) {
                      return (
                        <div className="flex flex-shrink-0">
                          <button type="button" onClick={() => startJob(selectedJob)} disabled={isActionLoading}
                            className={cn(btnGreen, isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-green-700")}>
                            {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                            Start Job
                          </button>
                        </div>
                      );
                    }

                    // Editing existing entry → Update button
                    if (editingEntryId) {
                      return (
                        <div className="flex gap-2 flex-shrink-0">
                          <button type="button" onClick={() => handleUpdateEntry(selectedJob)} disabled={isActionLoading}
                            className={cn(btnSave, isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-800")}>
                            {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            Update TI Entry
                          </button>
                          <button type="button" onClick={() => startJob(selectedJob)} disabled={isActionLoading}
                            className={cn(btnGreen, isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-green-700")}>
                            {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                            Start Job
                          </button>
                        </div>
                      );
                    }

                    // Save TI + Save TI & Start (always available for current job)
                    // Phase 3c — Skip button rightmost, only when canSkip evaluates true.
                    // NOTE: client status for whole-OBD jobs is normalized to "tint_assigned"
                    // at the Job-shape build step (~line 598-600), so the literal status
                    // compared here matches that normalized value.
                    const canSkip =
                      !!selectedJob &&
                      jobs.length > 0 &&
                      jobs[0].id === selectedJob.id &&
                      jobs[0].type === selectedJob.type &&
                      jobs[0].type === "order" &&
                      selectedJob.status === "tint_assigned" &&
                      !selectedJob.startedAt &&
                      !jobs.some(j => j.status === "tinting_in_progress");
                    return (
                      <div className="flex gap-2 flex-shrink-0">
                        <button type="button" onClick={() => handleSubmitTI(selectedJob, false)} disabled={isActionLoading}
                          className={cn(btnSave, isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-800")}>
                          {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Save TI
                        </button>
                        <button type="button" onClick={() => handleSubmitTI(selectedJob, true)} disabled={isActionLoading}
                          className={cn(btnGreen, isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-green-700")}>
                          {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                          Save TI & Start
                        </button>
                        {canSkip && selectedJob.tintAssignmentId !== null && (
                          <button
                            type="button"
                            onClick={() => setSkipModalJob({
                              assignmentId:       selectedJob.tintAssignmentId!,
                              obdNumber:          selectedJob.obdNumber,
                              shipToCustomerName: selectedJob.shipToCustomerName,
                              smu:                null, // not on Job shape today
                              articleTag:         selectedJob.articleTag,
                              totalVolume:        selectedJob.totalVolume,
                            })}
                            disabled={isActionLoading}
                            className={cn(
                              "h-[38px] px-4 bg-white border border-gray-200 text-red-700 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 transition-colors",
                              isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-red-50 hover:border-red-200",
                            )}
                            title="Skip this job — sends it back to Tint Manager"
                          >
                            <SkipForward size={13} />
                            Skip
                          </button>
                        )}
                      </div>
                    );
                  }

                  // FUTURE JOB — Save TI only (or waiting message if TI submitted)
                  if (editingEntryId) {
                    return (
                      <div className="flex flex-shrink-0">
                        <button type="button" onClick={() => handleUpdateEntry(selectedJob)} disabled={isActionLoading}
                          className={cn(btnSave, isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-800")}>
                          {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Update TI Entry
                        </button>
                      </div>
                    );
                  }
                  if (tintingLines.length > 0) {
                    return (
                      <div className="flex flex-shrink-0">
                        <button type="button" onClick={() => handleSubmitTI(selectedJob, false)} disabled={isActionLoading}
                          className={cn(btnSave, isActionLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-800")}>
                          {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Save TI
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div className="flex items-center gap-2 text-[12px] text-gray-400">
                      <Check size={14} className="text-green-600" />
                      Waiting in queue
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>

    {/* Phase 4 (step 12) — Save TI confirmation popup. Renders when a new
        sampling or new variant was allocated by the last Save TI POST. The
        component returns null when samplingPopup is null, so mounting here
        unconditionally is safe. */}
    <SaveSamplingPopup result={samplingPopup} onClose={() => setSamplingPopup(null)} />

    {/* Phase 3c — Skip Job modal. Single instance; gated on skipModalJob state. */}
    {skipModalJob && (
      <SkipJobModal
        open
        job={skipModalJob}
        onClose={() => setSkipModalJob(null)}
        onSkipped={() => {
          setSkipModalJob(null);
          void fetchOrders();
        }}
      />
    )}

    {/* Phase 4c — Pause Job modal. Single instance; gated on pauseModalJob state. */}
    {pauseModalJob && (
      <PauseJobModal
        open
        assignment={pauseModalJob}
        onClose={() => setPauseModalJob(null)}
        onSuccess={() => {
          setPauseModalJob(null);
          void fetchOrders();
        }}
      />
    )}

    {/* Phase 4f — Mark Done confirm modal. Single instance; whole-OBD only. */}
    {markDoneModalJob && (
      <MarkDoneConfirmModal
        open
        assignment={markDoneModalJob}
        onClose={() => setMarkDoneModalJob(null)}
        onSuccess={() => {
          setMarkDoneModalJob(null);
          setTiIncompleteWarning(null);
          void fetchOrders();
        }}
      />
    )}
    </>
  );
}

