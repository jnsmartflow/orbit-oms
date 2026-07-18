"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, ChevronDown, Check, Star, Zap, ArrowRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { getTodayIST } from "@/lib/dates";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickingQueueResult } from "@/lib/picking/queue";

// Real /api/warehouse/pickers response shape — do not invent fields.
interface Picker {
  id: number;
  name: string;
  avatarInitial: string;
  status: "available" | "picking";
  assignedCount: number;
  pickedCount: number;
  pendingCount: number;
  totalKg: number;
}

interface AssignResponse {
  assigned?: number;
  failed?: { orderId: number; error: string }[];
  error?: string;
}

// Real GET /api/picking/order/[orderId] response shape — see that route.
interface LineItem {
  id: number;
  name: string | null;
  sku: string;
  pack: string | null;
  qty: number;
}

// Card shell shadow — lifted verbatim from app/po/po-page.tsx's SOFT_CARD_SHADOW
// (the /po visual reference this board is styled to match).
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)";

// Chip identity for lines with a null pack — kept out of the "ALL" sentinel
// so a picker can isolate exactly the lines missing pack data (a real, live
// risk — see SKU 5961032 on OBD 9108267692).
const NO_PACK_KEY = "__no_pack__";

type TypeFilter = "All" | "Local" | "Upcountry";

// Fixed locale — same rationale as picking-queue.tsx (the desktop sibling):
// identical thousands-separator output depot PC vs Vercel, regardless of
// device locale settings.
const NUMBER_LOCALE = "en-US";

// Litres for display. Rounds to 1 decimal FIRST — that's the precision floor
// that kills genuine floating-point noise (e.g. summed volumeLitres landing
// on 12131.199999999999 instead of 12131.2) without discarding a real
// half-litre difference from small packs (200/100/50ML). Then drops the
// decimal entirely when that rounds to a whole litre (the common case) —
// otherwise keeps exactly 1 decimal. Always thousands-separated. Never
// renders a raw float. Display layer only — the underlying number is untouched.
function formatLitres(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const isWhole = Number.isInteger(rounded);
  return rounded.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: isWhole ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

// Elapsed time since assignedAt, bucketed into the three urgency tiers a
// supervisor scans for at a glance. Returns null when assignedAt is missing
// (Step 1 report — never fake this value; the pill is simply omitted).
type ElapsedTier = "grey" | "amber" | "red";
// Amber threshold — also the single source of truth for the Check summary
// strip's "M over 30m" count (FIX 4). Never hardcode 30 a second time.
const ELAPSED_AMBER_MINUTES = 30;
const ELAPSED_RED_MINUTES = 60;
function elapsedSinceAssigned(
  assignedAt: Date | string | null,
  nowMs: number,
): { label: string; tier: ElapsedTier; minutes: number } | null {
  if (assignedAt === null) return null;
  const then = new Date(assignedAt).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - then) / 60000));
  const label = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const tier: ElapsedTier =
    minutes >= ELAPSED_RED_MINUTES ? "red" : minutes >= ELAPSED_AMBER_MINUTES ? "amber" : "grey";
  return { label, tier, minutes };
}
const ELAPSED_PILL_CLASS: Record<ElapsedTier, string> = {
  grey: "bg-gray-100 text-gray-500",
  amber: "bg-amber-50 text-amber-700 border border-amber-200",
  red: "bg-red-50 text-red-700 border border-red-200",
};

// Check tab's ONE right-side pill (step 5 split) — "Still picking" keeps the
// existing grey/amber/red elapsed-since-assigned pill unchanged; "Needs
// check" gets a flat green "Picked Xm ago" pill (no tiering — it's not an
// urgency signal the way the assign-elapsed pill is, just a receipt of when
// the picker finished). Reuses elapsedSinceAssigned's minute/hour label
// formatting for both — only the source timestamp and the pill style differ.
function checkCardPill(
  row: PickingQueueRow,
  section: "needs" | "still" | "checked",
  nowTick: number,
): React.ReactNode {
  if (section === "needs") {
    const p = elapsedSinceAssigned(row.pickedAt, nowTick);
    if (!p) return null;
    return (
      <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-full shrink-0 bg-green-50 text-green-700 border border-green-200">
        Picked {p.label} ago
      </span>
    );
  }
  if (section === "checked") {
    // Plain grey text, not a pill — this bill is finished, nothing is
    // ticking, so it gets a timestamp (like the picker Done tab's "done
    // {time}"), never an elapsed clock.
    const t = formatCheckedTime(row.checkedAt);
    if (t === null) return null;
    return <span className="text-[11px] font-semibold text-gray-400 whitespace-nowrap">checked {t}</span>;
  }
  const p = elapsedSinceAssigned(row.assignedAt, nowTick);
  if (!p) return null;
  return (
    <span className={"text-[10.5px] font-bold px-2 py-[3px] rounded-full shrink-0 " + ELAPSED_PILL_CLASS[p.tier]}>
      {p.label}
    </span>
  );
}

// Same locale/timezone convention as picker-my-picks-board.tsx's
// formatPickedTime — duplicated (that function is private to that file, and
// this board already duplicates its own copies of formatLitres etc. from
// there for the same reason) — operates on checkedAt instead of pickedAt.
function formatCheckedTime(checkedAt: Date | string | null): string | null {
  if (checkedAt === null) return null;
  const d = new Date(checkedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
}

// Check tab card — step 5: ONE identical block for both sections (no left
// accent, no footer strip, no avatar). Picker's name folds into the same
// grey meta line the Assign card uses for area+articleTag — here it's
// area+pickerName instead. `muted` is the ONLY section-level visual
// distinction beyond the section header itself, per the approved mockup
// (docs/mockups/picking/supervisor-check-split.html) — both sections open
// the detail screen on tap (task brief: "Still picking" keeps today's
// existing tap-to-open behaviour, unchanged by the split).
function CheckCard({
  row, muted, pill, onOpen, checkerName,
}: {
  row: PickingQueueRow;
  muted: boolean;
  pill: React.ReactNode;
  onOpen: () => void;
  // Checked tab only (2026-07-18) — renders as its OWN line below the
  // area/picker line (never folded into it — a long area name + a long
  // picker/checker name measured out to overflow the card's 332px content
  // width, and since this segment would've been appended last, it was
  // exactly the piece the `truncate` ellipsis clipped first. The checker's
  // identity is the entire point of this tab, so it gets a line that can
  // never be silently cut — "who picked" (line above) and "who checked"
  // (this line) are two different facts, not one crowded line). Undefined/
  // null everywhere else, so the Needs check / Still picking cards render
  // byte-identical to before (no extra line, no height change).
  checkerName?: string | null;
}): React.JSX.Element {
  return (
    <div
      className={"bg-white rounded-[14px] p-[13px] mb-[9px] cursor-pointer " + (muted ? "opacity-75" : "")}
      style={{ boxShadow: SOFT_CARD_SHADOW }}
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-2 mb-[5px]">
        <span className="flex items-baseline gap-[5px] min-w-0">
          <span className="font-mono text-[11px] text-gray-400 whitespace-nowrap">{row.obdNumber}</span>
          {row.windowTime !== null && (
            <span className="text-[10.5px] text-gray-300 whitespace-nowrap">&middot;{row.windowTime}</span>
          )}
        </span>
        {pill}
      </div>
      <div className="text-[15px] font-bold text-gray-900 leading-tight mb-[3px] truncate">{row.dealerName}</div>
      <div className="text-[12px] text-gray-500 truncate">
        {row.area !== null ? (
          <>
            {row.area}
            {row.assignedToName !== null && (
              <>
                <span className="text-gray-300 mx-[5px]">&middot;</span>
                {row.assignedToName}
              </>
            )}
          </>
        ) : (
          row.assignedToName ?? "—"
        )}
      </div>
      {checkerName != null && (
        // No `truncate` here on purpose — this is the one fact the tab
        // exists to show, so it wraps rather than silently clipping behind
        // an ellipsis on an unusually long name.
        <div className="text-[12px] text-gray-500 mt-[3px]">
          &#10003; Checked by {checkerName}
        </div>
      )}
    </div>
  );
}

// Teal top bar tab — Assign / Check. Underline style (2026-07-16 restyle):
// label + count are both PLAIN TEXT, no pill/badge container of any kind, so
// a count's digit count changing (72 -> 8 -> 140) never resizes a shape —
// only the text itself (and, following it, the underline) shifts. Count uses
// tabular-nums so same-digit-count changes (e.g. 71 -> 72) don't jitter.
// Tap target: min-h-[40px] regardless of the lighter visual weight.
function TopBarTab({
  label, count, active, onClick,
}: {
  label: string; count: number; active: boolean; onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-baseline gap-[7px] min-h-[40px] py-2"
    >
      <span className={"text-[15.5px] whitespace-nowrap " + (active ? "text-white font-bold" : "text-white/60 font-medium")}>
        {label}
      </span>
      <span
        className={
          "text-[13px] font-semibold tabular-nums whitespace-nowrap " +
          (active ? "text-white" : "text-white/45")
        }
      >
        {count}
      </span>
      <span
        aria-hidden="true"
        className={
          "absolute left-0 right-0 -bottom-px h-[3px] rounded-full bg-white " +
          (active ? "opacity-100" : "opacity-0")
        }
      />
    </button>
  );
}

// Square checkbox — matches po-page.tsx's multi-select row checkbox exactly
// (rounded-[6px], border-2, teal-600 fill + white check svg when selected),
// per docs/mockups/picking/supervisor-assign-board.html (the approved design).
function SelectBox({ checked }: { checked: boolean }) {
  return (
    <div
      className={
        "w-5 h-5 rounded-[6px] border-2 flex items-center justify-center shrink-0 " +
        (checked ? "bg-teal-600 border-teal-600" : "bg-white border-gray-300")
      }
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

// [All][Local][UPC] delivery-type pills — the Assign tab's exact UI,
// extracted so the Check tab's FIX 3 pills reuse this verbatim instead of a
// second copy. Each tab passes its OWN state (Assign's activeType, Check's
// own checkTypeFilter) — the two filters are deliberately independent, never
// shared, so setting one tab's type filter can never silently change the
// other tab's results (constraint: no behaviour change to Assign).
function TypeFilterPills({
  value, onChange,
}: {
  value: TypeFilter;
  onChange: (t: TypeFilter) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {(["All", "Local", "Upcountry"] satisfies TypeFilter[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={
            "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap " +
            (value === t
              ? "bg-gray-900 border-gray-900 text-white font-semibold"
              : "bg-white border-gray-200 text-gray-700")
          }
        >
          {t === "Upcountry" ? "UPC" : t}
        </button>
      ))}
    </div>
  );
}

// ── Shared bottom-sheet geometry — SINGLE SOURCE for every bottom sheet on
// this board (FilterBottomSheet's Route/Picker-filter sheets AND the
// Assign-to-picker sheet further down this file). Read from here, never
// hand-copied — two sheets each picking their own numbers is exactly how
// the Assign-to-picker sheet drifted out of sync and ended up rendering
// under the mobile shell's fixed bottom nav while FilterBottomSheet's
// sheets, patched once already for the identical symptom, stayed correct.
//
// bottomOffset reads MOBILE_NAV_CLEARANCE (components/shared/mobile-shell.tsx)
// rather than hand-copying the "76px + safe-area" figure again — that
// number has now been missed three times as a local literal (this
// component's own two sheets, then both detail-screen CTAs below); it has
// exactly one source from here on, in the file that renders the nav itself.
// z-index — 65/75 were chosen to clear mobile-shell's OWN full stack (nav
// z-40 → its own scrim z-50 → menu/you sheets z-[60] → sign-out confirm
// z-[70]), not just to out-rank the nav alone. A sheet that lands on the
// SAME number as one of mobile-shell's own layers is a landmine even when
// today's DOM order happens to paint it correctly.
const SHEET_GEOMETRY = {
  scrimZ: "z-[65]",
  panelZ: "z-[75]",
  maxHeight: "max-h-[70vh]",
  bottomOffset: MOBILE_NAV_CLEARANCE,
} as const;

// Single-select bottom sheet — the Route dropdown's exact UI, generalised so
// FIX 3's picker filter can reuse it verbatim rather than a second copy.
// value === null means "all" (the first, un-narrowed row).
interface FilterSheetOption {
  value: string;
  label: string;
  count: number;
}
function FilterBottomSheet({
  open, onClose, title, subtitle, allLabel, allCount, options, value, onChange,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  allLabel: string;
  allCount: number;
  options: FilterSheetOption[];
  value: string | null;
  onChange: (v: string | null) => void;
}): React.JSX.Element | null {
  if (!open) return null;
  return (
    <>
      <div className={`fixed inset-0 bg-black/40 ${SHEET_GEOMETRY.scrimZ}`} onClick={onClose} aria-hidden="true" />
      <div
        className={`fixed left-0 right-0 ${SHEET_GEOMETRY.panelZ} bg-white rounded-t-[18px] p-5 ${SHEET_GEOMETRY.maxHeight} overflow-y-auto`}
        style={{ bottom: SHEET_GEOMETRY.bottomOffset }}
      >
        <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mb-3.5" />
        <h3 className="text-[16px] font-extrabold text-gray-900">{title}</h3>
        <p className="text-[12.5px] text-gray-400 mt-[3px] mb-3.5">{subtitle}</p>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            onClose();
          }}
          className="w-full flex items-center justify-between gap-2 py-3 px-1 border-b border-gray-100"
        >
          <span
            className={
              "text-[14px] flex items-center gap-2 " +
              (value === null ? "text-teal-700 font-semibold" : "text-gray-900 font-medium")
            }
          >
            {value === null && <Check size={16} className="text-teal-600" />}
            {allLabel}
          </span>
          <span className="text-[12px] text-gray-400">{allCount}</span>
        </button>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value);
              onClose();
            }}
            className="w-full flex items-center justify-between gap-2 py-3 px-1 border-b border-gray-100 last:border-b-0"
          >
            <span
              className={
                "text-[14px] flex items-center gap-2 min-w-0 " +
                (value === opt.value ? "text-teal-700 font-semibold" : "text-gray-900 font-medium")
              }
            >
              {value === opt.value && <Check size={16} className="text-teal-600 shrink-0" />}
              <span className="truncate">{opt.label}</span>
            </span>
            <span className="text-[12px] text-gray-400 shrink-0">{opt.count}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function PickingBoardMobile(): React.JSX.Element {
  // Same fetch-on-date-change shape as components/picking/picking-queue.tsx —
  // no date UI in this stage, so this never changes, but the pattern stays
  // date-driven for whenever a date control is added.
  const [selectedDate] = useState<string>(() => getTodayIST());
  const [data, setData] = useState<PickingQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The supervisor's jobs, as top-bar tabs. Client-side split over the SAME
  // already-loaded queue data — no second fetch, no new endpoint. "checked"
  // added 2026-07-18 — bills at PICK_CHECKED, invisible before this (see
  // lib/picking/queue.ts's doc comment).
  const [activeTab, setActiveTab] = useState<"assign" | "check" | "checked">("assign");

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<TypeFilter>("All");
  const [activeRoute, setActiveRoute] = useState<string | null>(null); // null = "All routes"
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // FIX 3 — Check tab's picker filter (by PERSON, not lane). Same shape as
  // the Assign tab's route filter, entirely separate state/sheet.
  const [activePicker, setActivePicker] = useState<string | null>(null); // null = "All pickers"
  const [pickerFilterSheetOpen, setPickerFilterSheetOpen] = useState(false);
  // FIX 3 (reversed decision) — Check's OWN delivery-type filter. Deliberately
  // NOT shared with Assign's activeType: switching one tab's type pills must
  // never silently change what the other tab shows (no behaviour change to
  // Assign, per constraints).
  const [checkTypeFilter, setCheckTypeFilter] = useState<TypeFilter>("All");

  // Checked tab (2026-07-18) — its OWN type filter + picker filter, same
  // "never share state across tabs" rule as Check's own filters above. The
  // picker dropdown here filters by PICKER (assignedToName), the same
  // semantic Check already uses — not by checker — so the one dropdown
  // control means the same thing on every tab; the checker's identity is a
  // display concern (the card's grey line), not a filter axis.
  const [checkedTypeFilter, setCheckedTypeFilter] = useState<TypeFilter>("All");
  const [activeCheckedPicker, setActiveCheckedPicker] = useState<string | null>(null);
  const [checkedPickerFilterSheetOpen, setCheckedPickerFilterSheetOpen] = useState(false);

  // Live clock for the Check tab's elapsed pill — ticks independently of any
  // data fetch so "4m" keeps advancing toward "5m" without a refetch.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [pickers, setPickers] = useState<Picker[]>([]);
  const [pickersLoading, setPickersLoading] = useState(true);
  const [pickerSheetOpen, setPickerSheetOpen] = useState(false);
  // In-flight guard — disables the Assign button + every picker row so a
  // double-tap can't fire two overlapping POSTs.
  const [assigning, setAssigning] = useState(false);
  // Per-row Undo in-flight guard — a Set (not a single scalar) so tapping
  // Undo on one assigned row never disables another row's Undo, and two
  // rows undone in quick succession can't lose track of each other.
  const [unassigningIds, setUnassigningIds] = useState<Set<number>>(new Set());

  // Detail screen — a full-screen overlay that stays MOUNTED (translateX
  // slide, per the approved mockup) rather than conditionally rendered, so
  // the board underneath (filters + scroll position) is never torn down.
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[] | null>(null);
  const [lineItemsLoading, setLineItemsLoading] = useState(false);
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);
  // Detail screen's own search + pack filter — same collapsible pattern as
  // the board's search, scoped to this screen only.
  const [detailSearching, setDetailSearching] = useState(false);
  const [detailQuery, setDetailQuery] = useState("");
  const [activePackFilter, setActivePackFilter] = useState<string>("ALL");

  // Check tab's tick state (step 6) — EPHEMERAL, plain component state, by
  // design (discovery §D3): a forcing function, not an audit trail. Nothing
  // persists it, nothing reads it once this screen closes. Keyed by line
  // item id so a pack-chip filter hiding some lines never lets the Approve
  // gate check anything but the FULL line set (see allLinesChecked below).
  // Reset in openDetail() and again in the detailOrderId-keyed fetch effect
  // so ticks never bleed from one bill into the next.
  const [checkedLineIds, setCheckedLineIds] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);

  // Which rows the OPEN picker sheet will act on — bulk (floating bar, from
  // the current selection) or single (detail screen's own CTA). Decoupled
  // from `selected` so the two flows never fight over the same state.
  const [assignTarget, setAssignTarget] = useState<PickingQueueRow[]>([]);

  const fetchQueue = useCallback(async (): Promise<PickingQueueResult> => {
    const res = await fetch(`/api/picking/queue?date=${selectedDate}`);
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    return res.json();
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await fetchQueue();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load picking queue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchQueue]);

  // Picker roster for the assign sheet — same endpoint desktop uses, fetched
  // once (the picker roster doesn't change within a session).
  useEffect(() => {
    let cancelled = false;
    async function loadPickers() {
      try {
        const res = await fetch("/api/warehouse/pickers");
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { pickers?: Picker[] };
        if (!cancelled) setPickers(json.pickers ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Failed to load pickers");
      } finally {
        if (!cancelled) setPickersLoading(false);
      }
    }
    void loadPickers();
    return () => {
      cancelled = true;
    };
  }, []);

  // Line items for the detail screen — fetched on demand per the task brief
  // ("do NOT bloat the main queue payload"). Re-fires only when the target
  // order changes, not on every open/close of the same order.
  useEffect(() => {
    if (detailOrderId === null) return;
    let cancelled = false;
    setLineItemsLoading(true);
    setLineItemsError(null);
    setLineItems(null);
    setCheckedLineIds(new Set());
    async function load() {
      try {
        const res = await fetch(`/api/picking/order/${detailOrderId}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { lines?: LineItem[] };
        if (!cancelled) setLineItems(json.lines ?? []);
      } catch (err) {
        if (!cancelled) setLineItemsError(err instanceof Error ? err.message : "Failed to load line items");
      } finally {
        if (!cancelled) setLineItemsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [detailOrderId]);

  // Post-assign refetch — never patch rows locally. Mirrors
  // picking-queue.tsx's refetchAfterAction: does not touch loading/error UI,
  // just replaces data with a fresh server read.
  const refetchQueue = useCallback(async () => {
    try {
      const json = await fetchQueue();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh picking queue");
    }
  }, [fetchQueue]);

  // data.rows arrives already sorted server-side (lib/picking/sort.ts
  // PICKING_SPINE — assigned-sink leads, window next). Array.filter preserves
  // that order; NOTHING here re-sorts or re-groups.
  //
  // `&& !r.isDone && !r.isChecked` — a PICK_DONE or PICK_CHECKED row has
  // isAssigned: false (that boolean is strictly PICK_ASSIGNED-only, see
  // lib/picking/queue.ts's KNOWN GAP comment), so without this it would
  // wrongly reappear here as if untouched and re-offerable to Assign. It
  // does NOT need the equivalent guard on the assigned/Check side —
  // assignedRows below already excludes both correctly, since isAssigned
  // is false for them either way.
  const waitingRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => !r.isAssigned && !r.isDone && !r.isChecked) : []),
    [data],
  );
  const assignedRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => r.isAssigned) : []),
    [data],
  );
  // "Needs check" pool for the Check tab's split (step 5) — bills the
  // picker has marked done. Parallel to assignedRows above, same source
  // data, no new fetch. isDone is strict-per-stage (=== PICK_DONE), so a
  // PICK_CHECKED row is false here on its own — no !isChecked guard needed,
  // it already has its own home (checkedRows below).
  const doneRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => r.isDone) : []),
    [data],
  );
  // Checked tab pool (2026-07-18) — bills the supervisor has approved.
  const checkedRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => r.isChecked) : []),
    [data],
  );

  // Route list — distinct non-null `route` across ALL waiting rows (stable,
  // not narrowed by the Type pill). Counts DO reflect the current Type pill
  // (live), mirroring the approved mockup's route sheet exactly.
  const availableRoutes = useMemo(() => {
    const set = new Set<string>();
    for (const r of waitingRows) {
      if (r.route !== null) set.add(r.route);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  }, [waitingRows]);

  const routeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of waitingRows) {
      if (r.route === null) continue;
      if (activeType !== "All" && r.deliveryType !== activeType) continue;
      map.set(r.route, (map.get(r.route) ?? 0) + 1);
    }
    return map;
  }, [waitingRows, activeType]);

  const q = query.trim().toLowerCase();
  const filteredWaiting: PickingQueueRow[] = useMemo(() => {
    return waitingRows.filter((r) => {
      if (activeType !== "All" && r.deliveryType !== activeType) return false;
      if (activeRoute !== null && r.route !== activeRoute) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [waitingRows, activeType, activeRoute, q]);

  const totalLitres = filteredWaiting.reduce((sum, r) => sum + (r.volumeLitres ?? 0), 0);
  const allRoutesCount = Array.from(routeCounts.values()).reduce((a, b) => a + b, 0);

  // FIX 3 — pickers who currently have assigned OR done bills, client-derived
  // from the same loaded assignedRows/doneRows (no new fetch) — step 5 widened
  // this from assignedRows alone so the dropdown/counts cover both Check
  // sections, not just "Still picking". Counts reflect the current Check
  // type pill (live) — same convention as routeCounts reflecting activeType
  // above. Rows with a null assignedToName (shouldn't happen for an
  // assigned/done bill, but the field is nullable) are skipped from the
  // option list — they still show up under "All pickers", just never become
  // a selectable filter value.
  const pickerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of [...assignedRows, ...doneRows]) {
      if (checkTypeFilter !== "All" && r.deliveryType !== checkTypeFilter) continue;
      if (r.assignedToName === null) continue;
      map.set(r.assignedToName, (map.get(r.assignedToName) ?? 0) + 1);
    }
    return map;
  }, [assignedRows, doneRows, checkTypeFilter]);
  const pickerOptions: FilterSheetOption[] = useMemo(() => {
    return Array.from(pickerCounts.keys())
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name, count: pickerCounts.get(name) ?? 0 }));
  }, [pickerCounts]);
  const allPickersCount = Array.from(pickerCounts.values()).reduce((a, b) => a + b, 0);

  // Checked tab's OWN picker filter (2026-07-18) — same shape as pickerCounts
  // above, scoped to checkedRows only (its own tab, its own dropdown state).
  const checkedPickerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of checkedRows) {
      if (checkedTypeFilter !== "All" && r.deliveryType !== checkedTypeFilter) continue;
      if (r.assignedToName === null) continue;
      map.set(r.assignedToName, (map.get(r.assignedToName) ?? 0) + 1);
    }
    return map;
  }, [checkedRows, checkedTypeFilter]);
  const checkedPickerOptions: FilterSheetOption[] = useMemo(() => {
    return Array.from(checkedPickerCounts.keys())
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name, count: checkedPickerCounts.get(name) ?? 0 }));
  }, [checkedPickerCounts]);
  const allCheckedPickersCount = Array.from(checkedPickerCounts.values()).reduce((a, b) => a + b, 0);

  // FIX 2 + FIX 3 — Check tab lists, narrowed by type, picker, and the SAME
  // search query the Assign tab uses (`q`, defined above). Type + picker +
  // search all STACK (AND, not OR) — Check has the same two-axis filter
  // shape as Assign (type pills + one dropdown), just picker instead of
  // route. Step 5 split the single "assigned" list into two sections
  // sharing this SAME filter state — "one filter state, two rendered
  // slices" — rather than giving each section its own type/picker/search.
  const filteredStillPicking: PickingQueueRow[] = useMemo(() => {
    return assignedRows.filter((r) => {
      if (checkTypeFilter !== "All" && r.deliveryType !== checkTypeFilter) return false;
      if (activePicker !== null && r.assignedToName !== activePicker) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [assignedRows, checkTypeFilter, activePicker, q]);

  const filteredNeedsCheck: PickingQueueRow[] = useMemo(() => {
    return doneRows.filter((r) => {
      if (checkTypeFilter !== "All" && r.deliveryType !== checkTypeFilter) return false;
      if (activePicker !== null && r.assignedToName !== activePicker) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [doneRows, checkTypeFilter, activePicker, q]);

  // Checked tab (2026-07-18) — own type/picker filters + the shared search
  // query, same AND-stacking shape as filteredStillPicking/filteredNeedsCheck
  // above. Unlike those (which keep server sort order), this is explicitly
  // re-sorted newest-first by checkedAt — a flat activity record, not a
  // work queue, so "most recently approved on top" is the useful order, not
  // PICKING_SPINE's window/route ranking. sort.ts itself is untouched; this
  // is a display-only re-order of an already-filtered slice.
  const filteredChecked: PickingQueueRow[] = useMemo(() => {
    const filtered = checkedRows.filter((r) => {
      if (checkedTypeFilter !== "All" && r.deliveryType !== checkedTypeFilter) return false;
      if (activeCheckedPicker !== null && r.assignedToName !== activeCheckedPicker) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
    return filtered.slice().sort((a, b) => {
      const at = a.checkedAt !== null ? new Date(a.checkedAt).getTime() : 0;
      const bt = b.checkedAt !== null ? new Date(b.checkedAt).getTime() : 0;
      return bt - at;
    });
  }, [checkedRows, checkedTypeFilter, activeCheckedPicker, q]);

  // FIX 4 — count of the CURRENTLY VISIBLE (filtered) "Still picking" bills
  // whose elapsed-since-assigned time has crossed the amber threshold.
  // Needs-check rows are deliberately excluded — their pill counts minutes
  // since PICKED, a different clock, and the summary strip's "over 30m"
  // has only ever meant "still picking too long," unchanged by the split.
  // Reuses elapsedSinceAssigned (and therefore ELAPSED_AMBER_MINUTES)
  // rather than re-deriving elapsed time with a second, possibly-drifting
  // calculation.
  const overThresholdCount = useMemo(() => {
    return filteredStillPicking.filter((r) => {
      const e = elapsedSinceAssigned(r.assignedAt, nowTick);
      return e !== null && e.minutes >= ELAPSED_AMBER_MINUTES;
    }).length;
  }, [filteredStillPicking, nowTick]);

  function toggleSelect(orderId: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  const laneLabel =
    [activeType !== "All" ? (activeType === "Upcountry" ? "UPC" : activeType) : null, activeRoute]
      .filter(Boolean)
      .join(" · ") || "All routes";

  // Selected rows narrowed to what's currently VISIBLE under the active
  // type/route/search filters — a row hidden by a later filter change drops
  // out of the bar/assign payload rather than silently riding along
  // uncounted (its checkbox still shows checked if the filter is reverted;
  // it just doesn't count or get submitted while hidden).
  const selectedRows = filteredWaiting.filter((r) => selected.has(r.orderId));
  const selectedLitres = selectedRows.reduce((sum, r) => sum + (r.volumeLitres ?? 0), 0);
  const pickerSheetSubtitle =
    assignTarget.length === 1
      ? `1 bill · ${assignTarget[0].dealerName}`
      : `${assignTarget.length} bills selected`;

  // The row the detail screen is currently showing — looked up fresh from
  // `data` each render (not a captured snapshot) so it reflects the latest
  // fetch if something changed the row while the screen was open.
  const detailRow: PickingQueueRow | null = useMemo(() => {
    if (!data || detailOrderId === null) return null;
    return data.rows.find((r) => r.orderId === detailOrderId) ?? null;
  }, [data, detailOrderId]);

  function openDetail(orderId: number): void {
    setDetailOrderId(orderId);
    setDetailOpen(true);
    // Fresh screen, fresh filters — a stale search/pack filter from a
    // previously-viewed bill must never carry into this one.
    setDetailSearching(false);
    setDetailQuery("");
    setActivePackFilter("ALL");
    setCheckedLineIds(new Set());
  }

  function closeDetail(): void {
    setDetailOpen(false);
  }

  function toggleLineChecked(lineId: number): void {
    setCheckedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  // Approve gate — checks the FULL line set, never filteredLineItems, so an
  // active pack-chip filter hiding some lines can never let a partially-
  // ticked bill through (task brief: "Approve must still require ALL lines
  // ticked, not just visible ones"). A zero-line bill stays permanently
  // disabled rather than vacuously passing `.every()` on an empty array —
  // a bill with no lines shouldn't be in picking at all.
  const allLinesChecked = useMemo(() => {
    if (!lineItems || lineItems.length === 0) return false;
    return lineItems.every((li) => checkedLineIds.has(li.id));
  }, [lineItems, checkedLineIds]);

  // Distinct packs present on this bill, for the pack-filter chip row.
  // Sorted alphabetically with "No pack" trailing last (an exception
  // category, not a real pack value).
  const distinctPackKeys = useMemo(() => {
    if (!lineItems) return [];
    const set = new Set<string>();
    for (const li of lineItems) set.add(li.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = keys.filter((k) => k !== NO_PACK_KEY).sort((a, b) => a.localeCompare(b));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [lineItems]);

  const detailQueryNorm = detailQuery.trim().toLowerCase();
  const filteredLineItems = useMemo(() => {
    if (!lineItems) return [];
    return lineItems.filter((li) => {
      if (activePackFilter !== "ALL") {
        const key = li.pack ?? NO_PACK_KEY;
        if (key !== activePackFilter) return false;
      }
      if (
        detailQueryNorm &&
        !(li.sku.toLowerCase().includes(detailQueryNorm) || (li.name ?? "").toLowerCase().includes(detailQueryNorm))
      ) {
        return false;
      }
      return true;
    });
  }, [lineItems, activePackFilter, detailQueryNorm]);

  // Opens the shared picker sheet targeted at a single row — the detail
  // screen's own "Assign to picker" CTA, independent of the bulk selection.
  function openPickerForRow(row: PickingQueueRow): void {
    setAssignTarget([row]);
    setPickerSheetOpen(true);
  }

  const handleAssign = useCallback(
    async (pickerId: number, pickerName: string) => {
      if (assignTarget.length === 0 || assigning) return;
      setAssigning(true);
      try {
        const res = await fetch("/api/picking/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds: assignTarget.map((r) => r.orderId), pickerId }),
        });
        const json = (await res.json().catch(() => ({}))) as AssignResponse;
        if (!res.ok) {
          // Hard error / non-200 — keep selection intact so they can retry,
          // sheet stays open.
          toast.error(json.error ?? `Request failed (${res.status})`);
          return;
        }
        const assignedCount = json.assigned ?? 0;
        const failedList = json.failed ?? [];
        if (failedList.length > 0) {
          // Partial failure — the endpoint didn't abort the batch; never
          // report this as a clean success.
          toast(`${assignedCount} assigned, ${failedList.length} couldn't be assigned`);
        } else {
          toast.success(`${assignedCount} ${assignedCount === 1 ? "bill" : "bills"} → ${pickerName}`);
        }
        setSelected(new Set());
        setPickerSheetOpen(false);
        // Closes the detail screen too when the assign came from its own
        // CTA — a harmless no-op when it came from the bulk floating bar,
        // since detail isn't open in that case.
        setDetailOpen(false);
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Assign failed");
      } finally {
        setAssigning(false);
      }
    },
    [assignTarget, assigning, refetchQueue],
  );

  // Undo — mirrors picking-queue.tsx's handleUnassign: single-order payload
  // (no batch endpoint exists), refetch-after-action rather than patching
  // rows locally, and the same 409 handling (bill already moved out from
  // under us — refetch and say so honestly instead of a generic failure).
  const handleUndo = useCallback(
    async (row: PickingQueueRow) => {
      if (unassigningIds.has(row.orderId)) return;
      setUnassigningIds((prev) => new Set(prev).add(row.orderId));
      try {
        const res = await fetch("/api/picking/unassign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: row.orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          if (res.status === 409) {
            toast("Already changed — refreshed.");
            await refetchQueue();
          } else {
            toast.error(json.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        toast.success(`${row.dealerName} released`);
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Undo failed");
      } finally {
        setUnassigningIds((prev) => {
          const next = new Set(prev);
          next.delete(row.orderId);
          return next;
        });
      }
    },
    [unassigningIds, refetchQueue],
  );

  // Approve — step 6. Single-order payload, refetch-after-action (never
  // patch rows locally), same 409 handling as handleUndo/handleAssign above.
  const handleApprove = useCallback(
    async (row: PickingQueueRow) => {
      if (approving) return;
      setApproving(true);
      try {
        const res = await fetch("/api/picking/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: row.orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          if (res.status === 409) {
            toast("Already changed — refreshed.");
            await refetchQueue();
          } else {
            toast.error(json.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        toast.success(`${row.dealerName} approved`);
        setDetailOpen(false);
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Approve failed");
      } finally {
        setApproving(false);
      }
    },
    [approving, refetchQueue],
  );

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f9fafb]">
      {/* Teal top bar — matches app/po/po-page.tsx's pinned brand bar, and
          its STRUCTURE: a flex-shrink-0 sibling of the scroll area below,
          never a "sticky" element in normal document flow. This board is
          nested inside RoleLayoutClient's `min-h-screen overflow-hidden`
          wrappers, which are NOT actual scroll containers — the real scroll
          was happening on the page body, outside this element's sticky
          reference frame, which is why the header used to scroll away and
          cards rendered under the iOS status bar. `fixed inset-0` on this
          root escapes that ancestor chain entirely (the same technique the
          detail screen below already uses successfully); the header/body
          split below it mirrors po-page.tsx's flex-col + flex-shrink-0
          header + flex-1 overflow-y-auto body shape. */}
      <div
        className="flex-shrink-0 bg-teal-600 px-4 pb-2"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
      >
        <div className="flex items-center justify-between gap-2.5 pb-2.5">
          <h1 className="text-[19px] font-extrabold text-white tracking-tight">Picking</h1>
          <button
            type="button"
            onClick={() => setSearching((v) => !v)}
            aria-label="Search"
            className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-white active:bg-white/15 shrink-0"
          >
            <Search size={19} />
          </button>
        </div>
        <div className="flex items-center gap-6">
          <TopBarTab
            label="Assign"
            count={waitingRows.length}
            active={activeTab === "assign"}
            onClick={() => setActiveTab("assign")}
          />
          <TopBarTab
            label="Check"
            count={assignedRows.length + doneRows.length}
            active={activeTab === "check"}
            onClick={() => setActiveTab("check")}
          />
          <TopBarTab
            label="Checked"
            count={checkedRows.length}
            active={activeTab === "checked"}
            onClick={() => setActiveTab("checked")}
          />
        </div>
      </div>

      {/* Scrollable content area — flex-1, ONLY this scrolls. Reserves 76px
          at the bottom for the fixed mobile-shell nav bar (the same "76px"
          convention the floating assign bar already uses below), since this
          root no longer benefits from RoleLayoutClient's own pb-[76px]. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[76px]">

      {/* Filter row (swaps for search when active) — shared by both tabs.
          Assign: type pills + route dropdown + lane strip. Check: the SAME
          type pills (own state) + picker dropdown + check summary strip
          (FIX 3/4) — mirrors Assign's row exactly, pills left/dropdown right. */}
      <div className="bg-white border-b border-gray-200 px-4 pt-2.5">
        {searching ? (
          <div className="flex items-center gap-2 pb-2.5">
            <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2.5">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customer or OBD…"
                className="flex-1 bg-transparent border-none outline-none text-[15px] text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setSearching(false);
                setQuery("");
              }}
              className="text-[13px] font-semibold text-teal-700 px-1 shrink-0"
            >
              Cancel
            </button>
          </div>
        ) : activeTab === "assign" ? (
          <>
            <div className="flex items-center justify-between gap-2 pb-2.5">
              <TypeFilterPills value={activeType} onChange={setActiveType} />
              <button
                type="button"
                onClick={() => setRouteSheetOpen(true)}
                className={
                  "flex-1 min-w-0 max-w-[150px] flex items-center justify-between gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border " +
                  (activeRoute !== null
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-gray-200 bg-white text-gray-500")
                }
              >
                <span className="truncate">{activeRoute ?? "All routes"}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
            </div>

            <div className="mx-[-16px] bg-teal-50 border-t border-teal-200 px-4 py-2 text-[12px] font-medium text-teal-700 flex items-center gap-1">
              <b className="font-bold">{laneLabel}</b>
              <span>
                &nbsp;·&nbsp;{filteredWaiting.length} waiting&nbsp;·&nbsp;{formatLitres(totalLitres)} L ready to load
              </span>
            </div>
          </>
        ) : activeTab === "check" ? (
          <>
            {/* FIX 3 (reversed decision) — SAME type pills as Assign (reused
                component, own independent state) on the left, picker dropdown
                on the right — same position/styling as the route dropdown.
                Mirrors Assign's row exactly; fixes BUG 2's lopsided layout. */}
            <div className="flex items-center justify-between gap-2 pb-2.5">
              <TypeFilterPills value={checkTypeFilter} onChange={setCheckTypeFilter} />
              <button
                type="button"
                onClick={() => setPickerFilterSheetOpen(true)}
                className={
                  "flex-1 min-w-0 max-w-[150px] flex items-center justify-between gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border " +
                  (activePicker !== null
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-gray-200 bg-white text-gray-500")
                }
              >
                <span className="truncate">{activePicker ?? "All pickers"}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
            </div>

            {/* FIX 4 — Check summary strip, same teal-tint style as the lane
                strip, reflecting ALL active filters (type + picker + search).
                Step 5: "N assigned" now counts BOTH sections combined
                (matches the approved mockup's summary line); "over 30m"
                stays scoped to "Still picking" only (see overThresholdCount).
                Segment omitted entirely when the count is 0. */}
            <div className="mx-[-16px] bg-teal-50 border-t border-teal-200 px-4 py-2 text-[12px] font-medium text-teal-700 flex items-center gap-1">
              <b className="font-bold">{activePicker ?? "All pickers"}</b>
              <span>
                &nbsp;·&nbsp;{filteredNeedsCheck.length + filteredStillPicking.length} assigned
                {overThresholdCount > 0 && (
                  <>&nbsp;·&nbsp;{overThresholdCount} over {ELAPSED_AMBER_MINUTES}m</>
                )}
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Checked tab (2026-07-18) — same row shape as Check: type pills
                left, its OWN picker dropdown right (filters by picker, same
                semantic as Check's dropdown — see state comment above). */}
            <div className="flex items-center justify-between gap-2 pb-2.5">
              <TypeFilterPills value={checkedTypeFilter} onChange={setCheckedTypeFilter} />
              <button
                type="button"
                onClick={() => setCheckedPickerFilterSheetOpen(true)}
                className={
                  "flex-1 min-w-0 max-w-[150px] flex items-center justify-between gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border " +
                  (activeCheckedPicker !== null
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-gray-200 bg-white text-gray-500")
                }
              >
                <span className="truncate">{activeCheckedPicker ?? "All pickers"}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
            </div>

            <div className="mx-[-16px] bg-teal-50 border-t border-teal-200 px-4 py-2 text-[12px] font-medium text-teal-700 flex items-center gap-1">
              <b className="font-bold">{activeCheckedPicker ?? "All pickers"}</b>
              <span>&nbsp;·&nbsp;{filteredChecked.length} checked today</span>
            </div>
          </>
        )}
      </div>

      {/* Card list — Assign tab: waiting bills, unchanged from before the tab split */}
      {activeTab === "assign" && (
      <div className="px-4 py-2.5">
        {loading && <p className="text-[13px] text-gray-400 text-center py-16">Loading queue&hellip;</p>}

        {!loading && error && (
          <p className="text-[13px] text-red-600 text-center py-16">
            Couldn&apos;t load the picking queue: {error}
          </p>
        )}

        {!loading &&
          !error &&
          data &&
          (filteredWaiting.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-16">No bills here right now.</p>
          ) : (
            filteredWaiting.map((row) => {
              const isSel = selected.has(row.orderId);
              return (
                <div
                  key={row.orderId}
                  className={
                    "flex items-start gap-[11px] bg-white rounded-[14px] p-[13px] mb-[9px] border-[1.5px] " +
                    (isSel ? "border-teal-600 bg-teal-50" : "border-transparent")
                  }
                  style={{ boxShadow: SOFT_CARD_SHADOW }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelect(row.orderId)}
                    aria-label={isSel ? "Deselect" : "Select"}
                    className="w-11 shrink-0 flex items-center justify-center pt-px"
                  >
                    <SelectBox checked={isSel} />
                  </button>
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => openDetail(row.orderId)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-[5px]">
                      <span className="flex items-baseline gap-[5px] min-w-0">
                        <span className="font-mono text-[11px] text-gray-400 whitespace-nowrap">
                          {row.obdNumber}
                        </span>
                        {row.windowTime !== null && (
                          <span className="text-[10.5px] text-gray-300 whitespace-nowrap">
                            &middot;{row.windowTime}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {row.isKeyCustomer && <Star size={14} className="text-amber-500 fill-amber-500" />}
                        {row.priorityLevel === 1 && <Zap size={14} className="text-amber-500 fill-amber-500" />}
                      </span>
                    </div>
                    <div className="text-[15px] font-bold text-gray-900 leading-tight mb-[3px] truncate">
                      {row.dealerName}
                    </div>
                    <div className="text-[12px] text-gray-500 truncate">
                      {row.area !== null ? (
                        <>
                          {row.area}
                          {row.articleTag !== null && (
                            <>
                              <span className="text-gray-300 mx-[5px]">&middot;</span>
                              {row.articleTag}
                            </>
                          )}
                        </>
                      ) : (
                        (row.articleTag ?? "—")
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ))}
      </div>
      )}

      {/* Card list — Check tab: step 5 split into two sections sharing the
          SAME filter state (type + picker + search) — "one filter state,
          two rendered slices" per the approved mockup
          (docs/mockups/picking/supervisor-check-split.html). "Needs check"
          (picker marked done) on top; "Still picking" below, muted. Both
          use the IDENTICAL CheckCard — no left accent, no colour-coding;
          the section header + "Still picking"'s opacity are the only
          distinction. Undo is NOT on either card (moved to the detail
          screen below, for "Still picking" rows only — see the CTA there
          and its comment for why "Needs check" has no Undo path yet). */}
      {activeTab === "check" && (
      <div className="px-4 py-2.5">
        {loading && <p className="text-[13px] text-gray-400 text-center py-16">Loading queue&hellip;</p>}

        {!loading && error && (
          <p className="text-[13px] text-red-600 text-center py-16">
            Couldn&apos;t load the picking queue: {error}
          </p>
        )}

        {!loading && !error && data && (
          <>
            <div className="text-[11.5px] font-bold uppercase tracking-wider text-gray-700 mb-2 px-[2px]">
              Needs check<span className="tabular-nums ml-1.5">{filteredNeedsCheck.length}</span>
            </div>
            {filteredNeedsCheck.length === 0 ? (
              <p className="text-[12.5px] text-gray-400 text-center py-6">
                {doneRows.length === 0 ? "Nothing waiting on a check right now." : "No bills match."}
              </p>
            ) : (
              filteredNeedsCheck.map((row) => (
                <CheckCard
                  key={row.orderId}
                  row={row}
                  muted={false}
                  pill={checkCardPill(row, "needs", nowTick)}
                  onOpen={() => openDetail(row.orderId)}
                />
              ))
            )}

            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-gray-400 mt-[18px] mb-2 px-[2px]">
              Still picking<span className="tabular-nums ml-1.5">{filteredStillPicking.length}</span>
            </div>
            {filteredStillPicking.length === 0 ? (
              <p className="text-[12.5px] text-gray-400 text-center py-6">
                {assignedRows.length === 0 ? "Nobody is still picking." : "No bills match."}
              </p>
            ) : (
              filteredStillPicking.map((row) => (
                <CheckCard
                  key={row.orderId}
                  row={row}
                  muted={true}
                  pill={checkCardPill(row, "still", nowTick)}
                  onOpen={() => openDetail(row.orderId)}
                />
              ))
            )}
          </>
        )}
      </div>
      )}

      {/* Card list — Checked tab (2026-07-18): flat list, newest-checked
          first, no sections. Bills at PICK_CHECKED had no home before this —
          approving one made it vanish. Same CheckCard as Check tab, plain
          (not muted) — this is the supervisor's day record, not a triage
          queue, so nothing here needs the "de-emphasised" treatment. Tap →
          same read-only detail screen (no ticks/Approve/Undo render for an
          isChecked row — see the CTA guards below). */}
      {activeTab === "checked" && (
      <div className="px-4 py-2.5">
        {loading && <p className="text-[13px] text-gray-400 text-center py-16">Loading queue&hellip;</p>}

        {!loading && error && (
          <p className="text-[13px] text-red-600 text-center py-16">
            Couldn&apos;t load the picking queue: {error}
          </p>
        )}

        {!loading &&
          !error &&
          data &&
          (filteredChecked.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-16">
              {checkedRows.length === 0 ? "Nothing checked today yet." : "No bills match."}
            </p>
          ) : (
            filteredChecked.map((row) => (
              <CheckCard
                key={row.orderId}
                row={row}
                muted={false}
                pill={checkCardPill(row, "checked", nowTick)}
                checkerName={row.checkedByName}
                onOpen={() => openDetail(row.orderId)}
              />
            ))
          ))}
      </div>
      )}

      </div>
      {/* ^ closes the flex-1 overflow-y-auto scroll region opened above the
          filter row. Everything below is a fixed-position overlay (sheets,
          the detail screen, the floating bar) — unaffected by this root's
          fixed-inset-0 restructure since position:fixed always resolves
          against the true viewport regardless of ancestor layout. */}

      {/* Route bottom sheet (Assign) — reuses FilterBottomSheet */}
      <FilterBottomSheet
        open={routeSheetOpen}
        onClose={() => setRouteSheetOpen(false)}
        title="Filter by route"
        subtitle="Single-select · counts reflect the current Type filter"
        allLabel="All routes"
        allCount={allRoutesCount}
        options={availableRoutes.map((route) => ({ value: route, label: route, count: routeCounts.get(route) ?? 0 }))}
        value={activeRoute}
        onChange={setActiveRoute}
      />

      {/* Picker filter sheet (Check, FIX 3) — SAME reused sheet, different data */}
      <FilterBottomSheet
        open={pickerFilterSheetOpen}
        onClose={() => setPickerFilterSheetOpen(false)}
        title="Filter by picker"
        subtitle="Single-select · counts reflect the current Type filter"
        allLabel="All pickers"
        allCount={allPickersCount}
        options={pickerOptions}
        value={activePicker}
        onChange={setActivePicker}
      />

      {/* Picker filter sheet (Checked tab, 2026-07-18) — SAME reused sheet,
          own data/state — this dropdown filters by picker (who picked the
          bill), same semantic as Check's dropdown above. */}
      <FilterBottomSheet
        open={checkedPickerFilterSheetOpen}
        onClose={() => setCheckedPickerFilterSheetOpen(false)}
        title="Filter by picker"
        subtitle="Single-select · counts reflect the current Type filter"
        allLabel="All pickers"
        allCount={allCheckedPickersCount}
        options={checkedPickerOptions}
        value={activeCheckedPicker}
        onChange={setActiveCheckedPicker}
      />

      {/* Detail screen — always mounted, slides in via translate-x so the
          board underneath (filters + scroll) is never torn down. Redesigned
          for the PICKER (not the supervisor): pack is the shelf, SKU is the
          box, qty is the count — each gets its own fixed column below. */}
      <div
        className={
          "fixed inset-0 z-[35] bg-[#f9fafb] flex flex-col transition-transform duration-200 ease-out " +
          (detailOpen ? "translate-x-0" : "translate-x-full")
        }
      >
        <div
          className="bg-teal-600 px-3.5 pb-3.5 flex items-center gap-2.5 shrink-0"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
        >
          <button
            type="button"
            onClick={closeDetail}
            aria-label="Back"
            className="w-8 h-8 rounded-[9px] bg-white/15 flex items-center justify-center text-white shrink-0"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-extrabold text-white truncate">
              {detailRow?.dealerName ?? "—"}
            </div>
            <div className="text-[12px] text-white/75 truncate">
              {detailRow
                ? `${detailRow.obdNumber} · ${detailRow.area ?? "Unmatched"}${
                    detailRow.windowTime !== null ? ` · ${detailRow.windowTime}` : ""
                  }`
                : "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDetailSearching((v) => !v)}
            aria-label="Search line items"
            className="w-8 h-8 rounded-[9px] flex items-center justify-center text-white active:bg-white/15 shrink-0"
          >
            <Search size={17} />
          </button>
        </div>

        {detailSearching ? (
          <div className="bg-white border-b border-gray-200 px-3.5 pt-2.5 pb-2.5 flex items-center gap-2 shrink-0">
            <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2.5">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={detailQuery}
                onChange={(e) => setDetailQuery(e.target.value)}
                placeholder="Search SKU or product…"
                className="flex-1 bg-transparent border-none outline-none text-[15px] text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setDetailSearching(false);
                setDetailQuery("");
              }}
              className="text-[13px] font-semibold text-teal-700 px-1 shrink-0"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            {/* Stat strip — articleTag is the hero; volume is small and
                supporting, right-aligned. Weight/KG and any line count are
                deliberately gone — a picker doesn't need them here. */}
            <div className="bg-white border-b border-gray-200 px-3.5 py-3 flex items-end justify-between gap-3 shrink-0">
              <div className="min-w-0 text-[16px] font-extrabold text-gray-900 leading-snug">
                {detailRow?.articleTag ?? "—"}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-0.5">
                <div className="text-[13px] font-semibold text-gray-500">
                  {detailRow?.volumeLitres != null ? formatLitres(detailRow.volumeLitres) : "—"} L
                </div>
                {detailRow?.isDone && lineItems !== null && (
                  <div className="text-[11.5px] text-gray-400 tabular-nums">
                    {checkedLineIds.size} / {lineItems.length} checked
                  </div>
                )}
              </div>
            </div>

            {/* Pack filter — only when the bill actually has more than one
                pack to tell apart; a single-pack bill shows no row at all. */}
            {distinctPackKeys.length >= 2 && (
              <div className="bg-white border-b border-gray-200 px-3.5 py-2.5 flex items-center gap-1.5 overflow-x-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setActivePackFilter("ALL")}
                  className={
                    "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
                    (activePackFilter === "ALL"
                      ? "bg-gray-900 border-gray-900 text-white font-semibold"
                      : "bg-white border-gray-200 text-gray-700")
                  }
                >
                  All
                </button>
                {distinctPackKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActivePackFilter(key)}
                    className={
                      "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
                      (activePackFilter === key
                        ? "bg-gray-900 border-gray-900 text-white font-semibold"
                        : "bg-white border-gray-200 text-gray-700")
                    }
                  >
                    {key === NO_PACK_KEY ? "No pack" : key}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex-1 overflow-y-auto px-3.5 pt-3 pb-24">
          {lineItemsLoading && (
            <p className="text-[13px] text-gray-400 text-center py-10">Loading line items&hellip;</p>
          )}
          {!lineItemsLoading && lineItemsError && (
            <p className="text-[13px] text-red-600 text-center py-10">
              Couldn&apos;t load line items: {lineItemsError}
            </p>
          )}
          {!lineItemsLoading && !lineItemsError && lineItems !== null && (
            lineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No line items found for this bill.</p>
            ) : filteredLineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No lines match.</p>
            ) : (
              // Flat — filtered, never restructured or grouped by pack.
              filteredLineItems.map((li) => {
                const isChecked = detailRow?.isDone === true && checkedLineIds.has(li.id);
                return (
                <div
                  key={li.id}
                  className="flex bg-white rounded-[14px] overflow-hidden mb-2"
                  style={{ boxShadow: SOFT_CARD_SHADOW }}
                >
                  {/* PACK TILE — fixed 56px, full card height (flex stretch),
                      teal when known, muted em-dash when missing (never an
                      error/chip style). This column is what makes packs
                      align down the left edge — must not flex. */}
                  <div className="w-14 shrink-0 bg-[#f8fafa] border-r border-gray-200 flex items-center justify-center px-1 py-2.5">
                    <span
                      className={
                        "text-[13px] font-bold text-center " + (li.pack !== null ? "text-teal-700" : "text-gray-400")
                      }
                    >
                      {li.pack ?? "—"}
                    </span>
                  </div>
                  {/* BODY — SKU is the loudest thing on the card; product name
                      is muted confirmation underneath. Mutes slightly once
                      ticked (Check tab only) — per the approved mockup, no
                      ring, no left border, just a quiet row. */}
                  <div className={"flex-1 min-w-0 px-3 py-2.5 transition-opacity " + (isChecked ? "opacity-55" : "")}>
                    <div className="font-mono text-[17px] font-bold text-gray-900 truncate">{li.sku}</div>
                    <div className="text-[12px] text-gray-500 truncate mt-0.5">{li.name ?? "—"}</div>
                  </div>
                  {/* QTY — fixed, plain, no "x" prefix. */}
                  <div className="shrink-0 flex items-center justify-center px-3.5">
                    <span className="text-[26px] font-extrabold text-gray-900">{li.qty}</span>
                  </div>
                  {/* TICK — Check tab only (detailRow.isDone), in the gutter
                      the QTY column already reserved. 44px tap zone, 20px/
                      2px-border circle, filled teal + white check when
                      ticked — no border on the column itself (a tap zone,
                      not a compartment), per the approved mockup
                      (docs/mockups/picking/supervisor-check-ticks.html).
                      Freely toggleable — a forcing function, not a lock. */}
                  {detailRow?.isDone && (
                    <button
                      type="button"
                      onClick={() => toggleLineChecked(li.id)}
                      aria-label={isChecked ? "Mark line unchecked" : "Mark line checked"}
                      className="w-11 shrink-0 flex items-center justify-center"
                    >
                      <span
                        className={
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center " +
                          (isChecked ? "bg-teal-600 border-teal-600" : "bg-white border-gray-300")
                        }
                      >
                        {isChecked && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                            <path
                              d="M5 13l4 4L19 7"
                              stroke="white"
                              strokeWidth={3.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    </button>
                  )}
                </div>
                );
              })
            )
          )}
        </div>

        {/* !detailRow.isDone && !detailRow.isChecked — defense-in-depth: a
            PICK_DONE or PICK_CHECKED row is already excluded from
            waitingRows above (so its card won't normally be tapped into),
            but this stops the "Assign to picker" CTA from ever rendering
            for one if this screen is reached some other way (2026-07-18:
            !isChecked added — a checked/approved bill must never offer to
            re-assign itself, same reasoning as the isDone guard it joins).
            paddingBottom reads MOBILE_NAV_CLEARANCE — this CTA used to be
            pinned at just `max(safe-area, 14px)`, no mobile-shell-nav
            reservation, so it rendered behind the fixed bottom nav with
            only a sliver visible above it (the exact bug class SHEET_
            GEOMETRY above already fixed twice for the sheets). */}
        {detailRow && !detailRow.isAssigned && !detailRow.isDone && !detailRow.isChecked && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}
          >
            <button
              type="button"
              onClick={() => openPickerForRow(detailRow)}
              className="w-full h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
            >
              Assign to picker
            </button>
          </div>
        )}

        {/* Step 5 — Undo, moved off the Check-tab card onto this screen
            (task brief: "keep Undo reachable somehow" until step 6's tick
            screen). detailRow.isAssigned is true ONLY for "Still picking"
            rows — that's deliberate, not an oversight: /api/picking/
            unassign's own guard requires workflowStage === PICK_ASSIGNED,
            so a "Needs check" (PICK_DONE) row would 409 on this exact call.
            No Undo CTA renders for those; step 6 widens that guard on
            purpose and gives them their own Undo there. */}
        {detailRow && detailRow.isAssigned && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}
          >
            <button
              type="button"
              onClick={() => void handleUndo(detailRow)}
              disabled={unassigningIds.has(detailRow.orderId)}
              className="w-full h-12 rounded-full bg-white border border-gray-200 active:bg-gray-50 text-gray-700 text-[14.5px] font-bold disabled:opacity-50"
            >
              {unassigningIds.has(detailRow.orderId) ? "Undoing…" : "Undo"}
            </button>
          </div>
        )}

        {/* Step 6 — Approve. Renders only for "Needs check" (PICK_DONE)
            rows. Disabled until allLinesChecked (every line ticked, gated
            against the FULL line set — see that memo's comment for the
            pack-filter interaction). No Undo on this screen, deliberately —
            a picked bill goes forward only; see the build-session notes. */}
        {detailRow && detailRow.isDone && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}
          >
            <button
              type="button"
              onClick={() => void handleApprove(detailRow)}
              disabled={!allLinesChecked || approving}
              className={
                "w-full h-12 rounded-full text-[14.5px] font-bold " +
                (allLinesChecked
                  ? "bg-teal-600 active:bg-teal-700 text-white shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
                  : "bg-gray-200 text-gray-400")
              }
            >
              {approving ? "Approving…" : "Approve"}
            </button>
          </div>
        )}
      </div>

      {/* Floating assign bar — matches docs/mockups/picking/supervisor-assign-board.html's
          .assignbar exactly (bg-gray-900 pill, teal Assign CTA), sitting just
          above the fixed mobile shell (76px, per components/shared/mobile-shell.tsx). */}
      {selectedRows.length > 0 && (
        <div
          className="fixed left-3 right-3 z-30 bg-gray-900 rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.28)]"
          style={{ bottom: "calc(76px + env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="text-[13px] font-semibold text-white min-w-0 truncate">
            {selectedRows.length} {selectedRows.length === 1 ? "bill" : "bills"}
            <span className="text-gray-400 font-normal"> · {formatLitres(selectedLitres)} L selected</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={assigning}
              className="text-[12.5px] font-semibold text-gray-400 px-1 py-2 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setAssignTarget(selectedRows);
                setPickerSheetOpen(true);
              }}
              disabled={assigning}
              className="flex items-center gap-1.5 bg-teal-600 active:bg-teal-700 text-white text-[13px] font-bold rounded-[10px] px-[15px] py-[9px] disabled:opacity-60"
            >
              Assign
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Picker sheet — tap a row to fire the assign immediately (no separate
          confirm step), per the approved mockup. Geometry (bottom offset,
          max-height/scroll, z-index) reads from SHEET_GEOMETRY — the same
          single source FilterBottomSheet above uses, so this sheet can't
          drift out of sync with it again (see that constant's comment for
          the bug this fixes: this sheet used to be pinned at `bottom: 0`
          with no mobile-shell-nav reservation and no internal scroll,
          rendering its last row under the fixed bottom nav). */}
      {pickerSheetOpen && (
        <>
          <div
            className={`fixed inset-0 bg-black/40 ${SHEET_GEOMETRY.scrimZ}`}
            onClick={() => {
              if (!assigning) setPickerSheetOpen(false);
            }}
            aria-hidden="true"
          />
          <div
            className={`fixed left-0 right-0 ${SHEET_GEOMETRY.panelZ} bg-white rounded-t-[18px] p-5 ${SHEET_GEOMETRY.maxHeight} overflow-y-auto`}
            style={{ bottom: SHEET_GEOMETRY.bottomOffset }}
          >
            <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mb-3.5" />
            <h3 className="text-[16px] font-extrabold text-gray-900">Assign to picker</h3>
            <p className="text-[12.5px] text-gray-400 mt-[3px] mb-3.5">{pickerSheetSubtitle}</p>
            {pickersLoading ? (
              <p className="text-[13px] text-gray-400 text-center py-6">Loading pickers&hellip;</p>
            ) : pickers.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-6">No active pickers found.</p>
            ) : (
              pickers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void handleAssign(p.id, p.name)}
                  disabled={assigning}
                  className="w-full flex items-center gap-[11px] py-[11px] px-1 border-b border-gray-100 last:border-b-0 disabled:opacity-50"
                >
                  <span className="w-9 h-9 rounded-full bg-teal-600 text-white text-[13px] font-bold flex items-center justify-center shrink-0">
                    {p.avatarInitial}
                  </span>
                  <span className="flex-1 min-w-0 text-[14px] font-semibold text-gray-900 text-left truncate">
                    {p.name}
                  </span>
                  <span
                    className={
                      "text-[10.5px] font-semibold px-2.5 py-[3px] rounded-full shrink-0 " +
                      (p.status === "available"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-gray-100 text-gray-600 border border-gray-200")
                    }
                  >
                    {p.status === "available" ? "Free" : `${p.assignedCount} jobs`}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
