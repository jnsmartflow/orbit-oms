"use client";

// Tint Manager — the board. Rebuilt 2026-09-05 to the locked mockup
// docs/mockups/tint-manager/tint-manager-FINAL_2.html.
//
// WHAT REPLACED WHAT
//   was: a 4-column Kanban (Pending / Assigned / In Progress / Completed) with a
//        card-vs-table view toggle, plus a per-column split card.
//   now: a 344px "Needs assignment" rail + ONE flat table grouped one section
//        per operator, so every job of a person's — running, queued, paused,
//        finished today — sits under their own name.
//
// STRUCTURE, borrowed from Floor (components/floor/): a composition root that
// owns state and every write, with dumb children under components/tint/manager/.
// The shaping rule (grouping, per-type Seq ranks) lives in ./manager/rows.ts as
// pure functions, so it can be reasoned about without mounting anything.
//
// ⚠ THE HEADER STAYS <UniversalHeader />. Floor is the ONE named exception to
// CORE §3's "no custom headers" rule (CLAUDE_UI §6), and this screen deliberately
// does not become a second one. The only prop removed is the operator-workload
// segment group — the table's per-operator sections now do that job, and better,
// because they show the work instead of counting it.
//
// RETIRED, NOT DELETED (CORE §3 — never delete a file):
//   components/tint/tint-table-view.tsx      — the old Kanban table
//   components/shared/order-detail-panel.tsx — the old panel; this was its only
//                                              live importer
//   components/tint/split-builder-modal.tsx  — Create Split is out of scope for
//                                              this screen by decision
// All three keep compiling; they simply lose their import. tint-table-view.tsx
// still imports TintOrder / SplitCard / CompletedAssignment FROM THIS FILE, so
// the three types are re-exported below even though this file no longer declares
// them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { AlertCircle, FileBarChart, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

import { UniversalHeader } from "@/components/universal-header";
import { CustomerMissingSheet } from "@/components/shared/customer-missing-sheet";
import { RemoveObdModal } from "@/components/tint/RemoveObdModal";
import { HideObdModal } from "@/components/tint/HideObdModal";
import { SkipHistoryModal } from "@/components/tint/SkipHistoryModal";
import { PauseHistoryModal } from "@/components/tint/PauseHistoryModal";
import { ManualTintEntryModal } from "@/components/tint/manual-tint-entry-modal";
import { ManualTintRevertModal } from "@/components/tint/manual-tint-revert-modal";

import { BoardRail } from "@/components/tint/manager/board-rail";
import { BoardTable } from "@/components/tint/manager/board-table";
import { BoardAssignBar } from "@/components/tint/manager/board-assign-bar";
import { BoardDetailPanel, type PanelTarget } from "@/components/tint/manager/board-detail-panel";
import { ConnectionStrip } from "@/components/tint/manager/board-bits";
import { useTintManagerSync } from "@/components/tint/manager/use-tint-manager-sync";
import { buildGroups, buildRail, panelSequence, queueSignature } from "@/components/tint/manager/rows";
import type {
  BoardRow,
  Operator,
  TintBoardPayload,
  TintOrder,
} from "@/components/tint/manager/types";

// Re-exported for components/tint/tint-table-view.tsx, which is retired but
// still type-checked and still imports these three from this module.
export type {
  TintOrder,
  SplitCard,
  CompletedAssignment,
} from "@/components/tint/manager/types";

const EMPTY_PAYLOAD: TintBoardPayload = {
  orders: [], activeSplits: [], completedSplits: [], completedAssignments: [],
};

export function TintManagerContent() {
  const { data: session } = useSession();

  const canImportOBDs = ["admin", "dispatcher", "support", "billing_operator", "tint_manager"]
    .includes(session?.user?.role ?? "");

  // Remove OBD — TM or admin. The server does the precise check
  // (/api/tint/manager/orders/[id]/remove), including the 409 outside
  // pending_tint_assignment.
  const canRemoveObd = (() => {
    const primary = session?.user?.role ?? "";
    const all     = session?.user?.roles ?? (primary ? [primary] : []);
    if (primary === "admin") return true;
    return all.includes("tint_manager");
  })();

  // Hide OBD is ADMIN ONLY — narrower than Remove. Server re-enforces.
  const canHideObd = (() => {
    const primary = session?.user?.role ?? "";
    const all     = session?.user?.roles ?? (primary ? [primary] : []);
    return primary === "admin" || all.includes("admin");
  })();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [payload, setPayload]     = useState<TintBoardPayload>(EMPTY_PAYLOAD);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [connected, setConnected] = useState(true);

  // ── Header filters + search ───────────────────────────────────────────────
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({
    deliveryType: [], priority: [], type: [],
  });
  const [searchQuery, setSearchQuery] = useState("");

  // ── Selection / panel / modals ────────────────────────────────────────────
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [panelKey, setPanelKey]   = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [reorderBusy, setReorderBusy] = useState<Set<string>>(new Set());

  const [removeModalOrder, setRemoveModalOrder] = useState<TintOrder | null>(null);
  const [hideModalOrder,   setHideModalOrder]   = useState<TintOrder | null>(null);
  const [skipHistoryFor,   setSkipHistoryFor]   = useState<{ orderId: number; obdNumber: string; customerName: string | null } | null>(null);
  const [pauseHistoryFor,  setPauseHistoryFor]  = useState<{ orderId: number; obdNumber: string; customerName: string | null } | null>(null);
  const [pullModalOpen,    setPullModalOpen]    = useState(false);
  const [revertOrder,      setRevertOrder]      = useState<{ id: number; obdNumber: string } | null>(null);

  // ── Missing-customer sheet + the Assign interceptor ───────────────────────
  const [missingCustomers, setMissingCustomers] = useState<{
    orderId: number; obdNumber: string; shipToCustomerId: string | null;
    shipToCustomerName: string | null; smu: string | null; orderType: string;
    obdEmailDate: string | null;
  }[]>([]);
  const [missingBadgeOpen, setMissingBadgeOpen] = useState(false);
  const missingBadgeRef = useRef<HTMLButtonElement>(null);
  const [missingSheetOpen,    setMissingSheetOpen]    = useState(false);
  const [missingSheetOrder,   setMissingSheetOrder]   = useState<TintOrder | null>(null);
  const [missingSheetWarning, setMissingSheetWarning] = useState<string | undefined>(undefined);
  // The Assign that was interrupted, remembered so it can be re-fired the moment
  // the customer resolves. Carries the OPERATOR too, which the old Kanban did not
  // — it only remembered the order and re-opened a modal for the manager to pick
  // again. Here the operator was already chosen in the rail popover, so replaying
  // it is what "resume where you left off" actually means.
  const [pendingAssign, setPendingAssign] = useState<{ orderId: number; operatorId: number } | null>(null);
  const sheetResolvedRef = useRef(false);

  // ── Fetching ──────────────────────────────────────────────────────────────

  /** Returns the payload it just stored, so a caller can diff before/after. */
  const fetchBoard = useCallback(async (): Promise<TintBoardPayload | null> => {
    try {
      const res = await fetch("/api/tint/manager/orders");
      if (!res.ok) return null;
      const data = (await res.json()) as TintBoardPayload;
      const next: TintBoardPayload = {
        orders:               data.orders ?? [],
        activeSplits:         data.activeSplits ?? [],
        completedSplits:      data.completedSplits ?? [],
        completedAssignments: data.completedAssignments ?? [],
      };
      setPayload(next);
      setLastSyncedAt(new Date());
      return next;
    } catch {
      return null; // leave the board on its last good data
    }
  }, []);

  const fetchMissingCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/tint/manager/missing-customers");
      if (!res.ok) return;
      const data = await res.json() as { orders: typeof missingCustomers };
      setMissingCustomers(data.orders ?? []);
    } catch { /* silent — the badge just stays as it was */ }
  }, []);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const [boardRes, opsRes] = await Promise.all([
          fetch("/api/tint/manager/orders"),
          fetch("/api/tint/manager/operators"),
        ]);
        const board = (await boardRes.json()) as TintBoardPayload;
        const ops   = (await opsRes.json()) as { operators: Operator[] };
        setPayload({
          orders:               board.orders ?? [],
          activeSplits:         board.activeSplits ?? [],
          completedSplits:      board.completedSplits ?? [],
          completedAssignments: board.completedAssignments ?? [],
        });
        setOperators(ops.operators ?? []);
        setLastSyncedAt(new Date());
      } finally {
        setIsLoading(false);
      }
    }
    void init();
    void fetchMissingCustomers();
  }, [fetchMissingCustomers]);

  // ── Live sync ─────────────────────────────────────────────────────────────
  // Paused while the panel is open or a selection is up: never move the ground
  // under a hand (FLOOR §5).
  useTintManagerSync({
    paused:   panelKey !== null || selection.size > 0,
    onProbe:  setConnected,
    onChange: () => { void fetchBoard(); void fetchMissingCustomers(); },
  });

  // ── Derived board ─────────────────────────────────────────────────────────

  const delTypes  = useMemo(() => new Set(headerFilters.deliveryType ?? []), [headerFilters]);
  const priority  = (headerFilters.priority ?? [])[0] ?? null;
  const rowType   = (headerFilters.type ?? [])[0] ?? null;
  const q         = searchQuery.trim().toLowerCase();

  const rail = useMemo(() => {
    return buildRail(payload).filter((o) => {
      if (delTypes.size > 0 && !delTypes.has(o.deliveryTypeName ?? "")) return false;
      if (priority === "urgent" && !(o.priorityLevel <= 2)) return false;
      if (priority === "normal" && !(o.priorityLevel > 2)) return false;
      // A pending order is always a whole order — the "split" filter cannot match
      // anything on the rail, so it empties it rather than silently ignoring.
      if (rowType === "split") return false;
      if (!q) return true;
      return (
        o.obdNumber.toLowerCase().includes(q) ||
        (o.customer?.customerName ?? "").toLowerCase().includes(q) ||
        (o.soNumber ?? "").toLowerCase().includes(q) ||
        (o.route ?? "").toLowerCase().includes(q)
      );
    });
  }, [payload, delTypes, priority, rowType, q]);

  const groups = useMemo(() => {
    const all = buildGroups(payload);
    if (delTypes.size === 0 && !priority && !rowType && !q) return all;
    return all
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => {
          const dt = r.order?.deliveryTypeName ?? r.split?.deliveryTypeName ?? r.completed?.deliveryTypeName ?? "";
          if (delTypes.size > 0 && !delTypes.has(dt)) return false;
          if (priority === "urgent" && !r.isUrgent) return false;
          if (priority === "normal" && r.isUrgent) return false;
          if (rowType === "split" && r.type !== "split") return false;
          if (rowType === "whole" && r.type !== "order") return false;
          if (!q) return true;
          return (
            r.obdNumber.toLowerCase().includes(q) ||
            r.siteName.toLowerCase().includes(q) ||
            (r.soNumber ?? "").toLowerCase().includes(q) ||
            (r.route ?? "").toLowerCase().includes(q) ||
            r.operatorName.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.rows.length > 0);
  }, [payload, delTypes, priority, rowType, q]);

  const rowsByKey = useMemo(() => {
    const m = new Map<string, BoardRow>();
    for (const g of groups) for (const r of g.rows) m.set(r.key, r);
    return m;
  }, [groups]);

  // Selection is a Set of row KEYS, so it survives a re-sort by construction
  // (it keys on identity, not position) — same reasoning as lib/floor/selection.ts.
  // Rows that vanish from the board (assigned away, finished) drop out here.
  const selectedRows = useMemo(
    () => Array.from(selection).map((k) => rowsByKey.get(k)).filter((r): r is BoardRow => !!r && r.selectable),
    [selection, rowsByKey],
  );

  useEffect(() => {
    if (selection.size === 0) return;
    const live = Array.from(selection).filter((k) => rowsByKey.get(k)?.selectable);
    if (live.length !== selection.size) setSelection(new Set(live));
  }, [rowsByKey, selection]);

  // ── Panel walk ────────────────────────────────────────────────────────────

  const walk = useMemo(() => panelSequence(rail, groups), [rail, groups]);
  const panelIndex = panelKey === null ? -1 : walk.findIndex((w) => w.key === panelKey);

  const panelTarget: PanelTarget | null = useMemo(() => {
    if (panelKey === null) return null;
    if (panelKey.startsWith("pending-")) {
      const id = Number(panelKey.slice("pending-".length));
      const o = rail.find((x) => x.id === id);
      return o ? { kind: "pending", order: o } : null;
    }
    const r = rowsByKey.get(panelKey);
    return r ? { kind: "row", row: r } : null;
  }, [panelKey, rail, rowsByKey]);

  // The panel's target vanished under it (finished, reassigned away, filtered
  // out). Close rather than showing a stale ghost.
  useEffect(() => {
    if (panelKey !== null && panelTarget === null) setPanelKey(null);
  }, [panelKey, panelTarget]);

  useEffect(() => { setPanelError(null); }, [panelKey]);

  // ── THE single window-level Esc owner for this screen ──────────────────────
  // One listener, one branch per keypress. Never add a second under
  // components/tint/manager/ — two window-level listeners race in registration
  // order, which is the bug FLOOR §4.6 exists to prevent.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "Escape") {
        if (typing) return;
        if (panelKey !== null) { setPanelKey(null); return; }
        if (selection.size > 0) { setSelection(new Set()); return; }
        return;
      }
      // M — Add OBD to Tint. Ignored while typing, and while the panel is open
      // (the panel is a focus context of its own).
      if ((e.key === "m" || e.key === "M") && !typing && panelKey === null) {
        e.preventDefault();
        setPullModalOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelKey, selection]);

  // Close the missing-customer popover on outside click
  useEffect(() => {
    if (!missingBadgeOpen) return;
    const handler = (e: MouseEvent) => {
      if (missingBadgeRef.current && !missingBadgeRef.current.parentElement?.contains(e.target as Node)) {
        setMissingBadgeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [missingBadgeOpen]);

  // ── Writes ────────────────────────────────────────────────────────────────

  /** POST one assign. Returns null on success, else the server's own message. */
  const postAssign = useCallback(async (orderId: number, operatorId: number): Promise<string | null> => {
    try {
      const res = await fetch("/api/tint/manager/assign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId, assignedToId: operatorId }),
      });
      if (res.ok) return null;
      // The route's 400s carry a message written to be shown verbatim (the
      // customer-missing backstop and the new stage guard both do).
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return typeof body.error === "string" ? body.error : `Assign failed (HTTP ${res.status})`;
    } catch (err) {
      return err instanceof Error ? err.message : "Assign failed";
    }
  }, []);

  /**
   * Assign from the rail, WITH the customer-missing interceptor.
   *
   * Behaviour preserved from the old Kanban (tint-manager-content.tsx ~2305-2338):
   * a customerMissing order never reaches the assign call — it opens
   * CustomerMissingSheet with an amber warning instead, and the intent is
   * remembered so the assign re-fires by itself once the flag flips false. The
   * server refuses it too (a 400 from assign/route.ts), so this is the
   * affordance, not the rule.
   */
  const handleAssign = useCallback(async (order: TintOrder, operatorId: number) => {
    if (order.customerMissing) {
      setPendingAssign({ orderId: order.id, operatorId });
      sheetResolvedRef.current = false;
      setMissingSheetWarning("Resolve customer details first before assigning.");
      setMissingSheetOrder(order);
      setMissingSheetOpen(true);
      return;
    }
    setWriteBusy(true);
    setPanelError(null);
    const err = await postAssign(order.id, operatorId);
    setWriteBusy(false);
    if (err) {
      setPanelError(err);
      toast.error(err);
      return;
    }
    const opName = operators.find((o) => o.id === operatorId)?.name ?? "operator";
    toast.success(`${order.obdNumber} assigned to ${opName}`);
    setPanelKey(null);
    await fetchBoard();
    void fetchMissingCustomers();
  }, [postAssign, operators, fetchBoard, fetchMissingCustomers]);

  // The chain: once the sheet resolves and the refreshed order is no longer
  // customerMissing, replay the interrupted assign.
  useEffect(() => {
    if (!pendingAssign) return;
    const fresh = payload.orders.find((o) => o.id === pendingAssign.orderId);
    if (!fresh) { setPendingAssign(null); return; }  // gone from the board
    if (fresh.customerMissing) return;                // still missing — keep waiting
    const { operatorId } = pendingAssign;
    setPendingAssign(null);
    void handleAssign(fresh, operatorId);
  }, [payload, pendingAssign, handleAssign]);

  /** Single re-assign of a whole order, from the panel. Waiting rows only. */
  const handleReassignOrder = useCallback(async (row: BoardRow, operatorId: number) => {
    setWriteBusy(true);
    setPanelError(null);
    const err = await postAssign(row.orderId, operatorId);
    setWriteBusy(false);
    if (err) { setPanelError(err); toast.error(err); return; }
    const opName = operators.find((o) => o.id === operatorId)?.name ?? "operator";
    toast.success(`${row.obdNumber} moved to ${opName}`);
    await fetchBoard();
  }, [postAssign, operators, fetchBoard]);

  /** Splits re-assign through their OWN endpoint, never the whole-order one. */
  const handleReassignSplit = useCallback(async (row: BoardRow, operatorId: number) => {
    setWriteBusy(true);
    setPanelError(null);
    try {
      const res = await fetch("/api/tint/manager/splits/reassign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ splitId: row.id, assignedToId: operatorId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        const msg = typeof body.error === "string" ? body.error : `Re-assign failed (HTTP ${res.status})`;
        setPanelError(msg);
        toast.error(msg);
        return;
      }
      const opName = operators.find((o) => o.id === operatorId)?.name ?? "operator";
      toast.success(`Split #${row.splitNumber} moved to ${opName}`);
      await fetchBoard();
    } finally {
      setWriteBusy(false);
    }
  }, [operators, fetchBoard]);

  /**
   * Send back to Pending — cancel the assignment, return the bill to the rail.
   *
   * Branches by row type onto the two endpoints that already existed for this
   * and had been left with no caller by the board rebuild:
   *   whole order → POST /api/tint/manager/cancel-assignment { orderId }
   *   split       → POST /api/tint/manager/splits/cancel      { splitId }
   *
   * Offered on `assigned` rows only, which is the ROUTES' own rule rather than a
   * UI preference: cancel-assignment requires `workflowStage === "tint_assigned"`
   * (400 otherwise) and splits/cancel rejects `tinting_in_progress` /
   * `tinting_done` (409). Neither admits anything Re-assign does not.
   *
   * ⚠ The response IS read. The old Kanban's equivalent fired the POST and never
   * looked at the answer — a rejected cancel logged to console and looked like
   * success, the same swallow FLOOR §6(b) documents. A failure here surfaces in
   * the panel and as a toast.
   */
  const handleSendBack = useCallback(async (row: BoardRow) => {
    setWriteBusy(true);
    setPanelError(null);
    try {
      const isSplit = row.type === "split";
      const res = await fetch(
        isSplit ? "/api/tint/manager/splits/cancel" : "/api/tint/manager/cancel-assignment",
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(isSplit ? { splitId: row.id } : { orderId: row.orderId }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        const msg = typeof body.error === "string"
          ? body.error
          : `Could not send back (HTTP ${res.status})`;
        setPanelError(msg);
        toast.error(msg);
        return;
      }
      toast.success(
        isSplit
          ? `Split #${row.splitNumber} cancelled — ${row.obdNumber} is back on the rail`
          : `${row.obdNumber} sent back to Pending`,
      );
      // The row leaves the table for the rail, so its key changes (order-N →
      // pending-N) and the panel's target is gone. Close, matching what Assign
      // and Remove OBD already do — there is no "next item" to step to when the
      // thing you acted on moved to the other side of the screen.
      setPanelKey(null);
      await fetchBoard();
    } finally {
      setWriteBusy(false);
    }
  }, [fetchBoard]);

  /**
   * Bulk re-assign — N SEQUENTIAL awaits over the single-assign route.
   *
   * There is no bulk endpoint, and there deliberately is no Promise.all and no
   * $transaction: Vercel serverless against the Supabase pooler is the reason
   * (CORE §3).
   *
   * Partial-failure contract copied from Floor (CLAUDE_FLOOR §4.1/§4.2): collect
   * `failed[]`, treat "nothing was written" as the 422 case with a hard error,
   * and NAME the ones that failed when some succeeded. A write that skipped
   * silently must never look like success — that is the exact bug FLOOR §6(b)
   * documents.
   *
   * A customerMissing row goes into failed[] with a clear reason. It is not
   * silently skipped, and it does not abort the batch: the other rows are still
   * the manager's to move.
   */
  const handleBulkReassign = useCallback(async (operatorId: number) => {
    const rows = selectedRows;
    if (rows.length === 0) return;
    setWriteBusy(true);

    const failed: Array<{ obd: string; reason: string }> = [];
    let ok = 0;

    for (const row of rows) {
      if (row.order?.customerMissing) {
        failed.push({ obd: row.obdNumber, reason: "customer master data missing — resolve it first" });
        continue;
      }
      if (row.operatorId === operatorId) {
        failed.push({ obd: row.obdNumber, reason: "already with that operator" });
        continue;
      }
      const err = await postAssign(row.orderId, operatorId);
      if (err) failed.push({ obd: row.obdNumber, reason: err });
      else ok++;
    }

    setWriteBusy(false);
    const opName = operators.find((o) => o.id === operatorId)?.name ?? "operator";

    if (ok === 0) {
      // The 422 case: nothing was written.
      toast.error(`Nothing was re-assigned — all ${failed.length} failed`, {
        description: failed.map((f) => `${f.obd}: ${f.reason}`).join("\n"),
        duration: 10000,
      });
    } else if (failed.length > 0) {
      toast.warning(`${ok} moved to ${opName} · ${failed.length} failed`, {
        description: failed.map((f) => `${f.obd}: ${f.reason}`).join("\n"),
        duration: 10000,
      });
    } else {
      toast.success(`${ok} ${ok === 1 ? "job" : "jobs"} moved to ${opName}`);
    }

    setSelection(new Set());
    await fetchBoard();
    void fetchMissingCustomers();
  }, [selectedRows, postAssign, operators, fetchBoard, fetchMissingCustomers]);

  /**
   * Re-sequence one step inside one operator's queue.
   *
   * ⚠ THE ROUTE'S BOUNDARY NO-OP. PATCH /api/tint/manager/reorder answers
   * `200 { success: true }` and writes NOTHING when the row is already first or
   * last — so a 2xx alone does NOT mean anything moved. The queue signature is
   * captured before the call and compared against the refetched board after it;
   * only a real change is announced. The arrows are also disabled at the
   * boundaries, so hitting this path means the client's view was already stale.
   */
  const handleReorder = useCallback(async (row: BoardRow, direction: "up" | "down") => {
    if (reorderBusy.has(row.key)) return;
    setReorderBusy((s) => new Set(s).add(row.key));

    const before = queueSignature(groups, row.operatorId, row.type);
    try {
      const res = await fetch("/api/tint/manager/reorder", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: row.type, id: row.id, direction }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        toast.error(typeof body.error === "string" ? body.error : `Re-sequence failed (HTTP ${res.status})`);
        return;
      }
      const fresh = await fetchBoard();
      if (!fresh) { toast.error("Re-sequenced, but the board could not be refreshed"); return; }
      const after = queueSignature(buildGroups(fresh), row.operatorId, row.type);
      if (after === before) {
        // A silent no-op. Say nothing rather than claim a move that did not
        // happen — the row is already at the end it was pushed towards.
        return;
      }
      toast.success(`Re-sequenced ${row.operatorName.split(" ")[0]}'s queue`);
    } finally {
      setReorderBusy((s) => { const n = new Set(s); n.delete(row.key); return n; });
    }
  }, [groups, reorderBusy, fetchBoard]);

  // ── Header pieces ─────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const flat = groups.flatMap((g) => g.rows);
    return [
      { label: "pending",     value: rail.length },
      { label: "assigned",    value: flat.filter((r) => r.status === "assigned").length },
      { label: "in progress", value: flat.filter((r) => r.status === "tinting_in_progress").length },
      { label: "paused",      value: flat.filter((r) => r.status === "paused").length },
      { label: "done today",  value: flat.filter((r) => r.status === "tinting_done").length },
    ];
  }, [rail, groups]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="h-[52px] bg-white border-b border-gray-200" />
        <div className="h-[40px] bg-white border-b border-gray-200" />
        <div className="flex" style={{ height: "calc(100vh - 92px)" }}>
          <div className="w-[344px] border-r border-gray-200 p-2 flex flex-col gap-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-[130px] bg-gray-100 rounded-[10px] animate-pulse" />)}
          </div>
          <div className="flex-1 p-3 flex flex-col gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">

      <UniversalHeader
        title="Tint Manager"
        showImport={canImportOBDs}
        stats={stats}
        /* ⚠ NO `segments` / `activeSegment` / `onSegmentChange`. The operator
           workload pills are gone on purpose: the table's per-operator sections
           replace them, and they show the actual jobs rather than a count. This
           is the ONLY prop change vs the Kanban header — everything else below is
           wired exactly as it was. */
        filterGroups={[
          { label: "Delivery Type", key: "deliveryType", options: [{ value: "Local", label: "Local" }, { value: "Upcountry", label: "UPC" }, { value: "IGT", label: "IGT" }, { value: "Cross Depot", label: "Cross" }] },
          { label: "Priority", key: "priority", options: [{ value: "urgent", label: "Urgent" }, { value: "normal", label: "Normal" }] },
          { label: "Type", key: "type", options: [{ value: "split", label: "Split" }, { value: "whole", label: "Whole" }] },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        showDatePicker={false}
        searchPlaceholder="Search OBD, SO, site, route…"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        rightExtra={
          <div className="flex items-center gap-1">
            {missingCustomers.length > 0 && (
              <div className="relative">
                <button
                  ref={missingBadgeRef}
                  onClick={() => setMissingBadgeOpen(!missingBadgeOpen)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5 cursor-pointer hover:bg-amber-100 transition-colors"
                >
                  <AlertCircle size={12} />
                  {missingCustomers.length} missing
                </button>
                {missingBadgeOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-[300px] bg-white border border-gray-200 rounded-lg shadow-lg max-h-[320px] overflow-y-auto">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Missing Customers</p>
                    </div>
                    {missingCustomers.map((mc) => (
                      <button
                        key={mc.orderId}
                        type="button"
                        onClick={() => {
                          setMissingSheetOrder({ shipToCustomerId: mc.shipToCustomerId, shipToCustomerName: mc.shipToCustomerName } as TintOrder);
                          setMissingSheetOpen(true);
                          setMissingBadgeOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-gray-600">{mc.obdNumber}</span>
                          <span className={cn(
                            "text-[9px] font-medium px-1.5 py-0.5 rounded border",
                            mc.orderType === "tint"
                              ? "bg-purple-50 text-purple-600 border-purple-200"
                              : "bg-gray-50 text-gray-500 border-gray-200",
                          )}>
                            {mc.orderType === "tint" ? "Tint" : "Non-Tint"}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-900 font-medium mt-0.5 truncate">{mc.shipToCustomerName ?? "Unknown"}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{mc.smu === "Decorative Projects" ? "Deco Projects" : mc.smu}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <a
              href="/reports?r=tint-summary"
              className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white text-gray-700 border border-gray-200 rounded-full px-2.5 py-0.5 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              title="Open Reports — Tint Summary (the full completion history; this board shows today only)"
            >
              <FileBarChart size={12} />
              Reports
            </a>
            <button
              type="button"
              onClick={() => setPullModalOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white text-gray-700 border border-gray-200 rounded-full px-2.5 py-0.5 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              title="Add OBD to Tint (M)"
            >
              <Plus size={12} />
              Add to Tint
            </button>
          </div>
        }
        shortcuts={[
          { key: "M",   label: "Add OBD to Tint" },
          { key: "Esc", label: "Close panel / clear selection" },
          { key: "▲▼",  label: "Re-sequence (hover an Assigned row)" },
        ]}
      />

      <ConnectionStrip connected={connected} lastSyncedAt={lastSyncedAt} />

      {/* ── Body shell: 344px rail + one flat table ──────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <BoardRail
          rail={rail}
          operators={operators}
          canRemove={canRemoveObd}
          onAssign={(o, opId) => { void handleAssign(o, opId); }}
          onRemove={(o) => setRemoveModalOrder(o)}
          onOpenPanel={(o) => setPanelKey(`pending-${o.id}`)}
          onResolveMissing={(o) => {
            sheetResolvedRef.current = false;
            setMissingSheetWarning(undefined);
            setMissingSheetOrder(o);
            setMissingSheetOpen(true);
          }}
        />

        <BoardTable
          groups={groups}
          selection={selection}
          busyKeys={reorderBusy}
          onToggleRow={(r) => setSelection((s) => {
            const n = new Set(s);
            if (n.has(r.key)) n.delete(r.key); else n.add(r.key);
            return n;
          })}
          onOpenRow={(r) => setPanelKey(r.key)}
          onReorder={(r, d) => { void handleReorder(r, d); }}
        />
      </div>

      <BoardAssignBar
        selectedRows={selectedRows}
        operators={operators}
        busy={writeBusy}
        onReassign={(opId) => { void handleBulkReassign(opId); }}
        onClear={() => setSelection(new Set())}
      />

      {panelTarget && (
        <BoardDetailPanel
          target={panelTarget}
          operators={operators}
          position={{ index: panelIndex, total: walk.length }}
          busy={writeBusy}
          error={panelError}
          canRemove={canRemoveObd}
          onClose={() => setPanelKey(null)}
          onPrev={() => { if (panelIndex > 0) setPanelKey(walk[panelIndex - 1].key); }}
          onNext={() => { if (panelIndex < walk.length - 1) setPanelKey(walk[panelIndex + 1].key); }}
          onAssign={(o, opId) => { void handleAssign(o, opId); }}
          onReassignOrder={(r, opId) => { void handleReassignOrder(r, opId); }}
          onReassignSplit={(r, opId) => { void handleReassignSplit(r, opId); }}
          onSendBack={(r) => { void handleSendBack(r); }}
          onRemove={(o) => setRemoveModalOrder(o)}
          onResolveMissing={(o) => {
            sheetResolvedRef.current = false;
            setMissingSheetWarning(undefined);
            setMissingSheetOrder(o);
            setMissingSheetOpen(true);
          }}
          onOpenPauseHistory={(orderId, obdNumber, siteName) => setPauseHistoryFor({ orderId, obdNumber, customerName: siteName })}
          onOpenSkipHistory={(orderId, obdNumber, siteName) => setSkipHistoryFor({ orderId, obdNumber, customerName: siteName })}
        />
      )}

      {/* ── Secondary actions kept reachable ─────────────────────────────────
          Hide OBD (admin) and Revert-from-tint act on a PENDING bill, so they
          live on the rail's context strip below the list rather than in a row
          menu the flat table does not have. Nothing became unreachable. */}
      {(canHideObd || rail.some((o) => o.manualTintEntry)) && rail.length > 0 && (
        <div className="border-t border-gray-200 bg-gray-50 px-3.5 py-2 flex items-center gap-3 text-[11px] text-gray-500">
          <span className="font-semibold text-gray-600">Pending bill actions:</span>
          {canHideObd && (
            <select
              className="border border-gray-200 rounded-md px-2 py-1 text-[11px] bg-white"
              value=""
              onChange={(e) => {
                const o = rail.find((x) => String(x.id) === e.target.value);
                if (o) setHideModalOrder(o);
                e.currentTarget.value = "";
              }}
            >
              <option value="">Hide an OBD…</option>
              {rail.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.obdNumber} · {o.customer?.customerName ?? o.shipToCustomerName ?? "—"}
                </option>
              ))}
            </select>
          )}
          {rail.some((o) => o.manualTintEntry) && (
            <select
              className="border border-gray-200 rounded-md px-2 py-1 text-[11px] bg-white"
              value=""
              onChange={(e) => {
                const o = rail.find((x) => String(x.id) === e.target.value);
                if (o) setRevertOrder({ id: o.id, obdNumber: o.obdNumber });
                e.currentTarget.value = "";
              }}
            >
              <option value="">Revert a manual tint entry…</option>
              {rail.filter((o) => o.manualTintEntry).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.obdNumber} · {o.customer?.customerName ?? o.shipToCustomerName ?? "—"}
                </option>
              ))}
            </select>
          )}
          <RotateCcw size={11} className="text-gray-300" />
        </div>
      )}

      {/* ── Modals, all single-instance ──────────────────────────────────── */}

      <CustomerMissingSheet
        open={missingSheetOpen}
        warningMessage={missingSheetWarning}
        onOpenChange={(next) => {
          // Cancel just drops the Assign intent — the amber strip already said
          // why, and the ⓘ on the rail card is the persistent reminder.
          if (!next && !sheetResolvedRef.current && pendingAssign) setPendingAssign(null);
          if (!next) setMissingSheetWarning(undefined);
          setMissingSheetOpen(next);
        }}
        shipToCustomerId={missingSheetOrder?.shipToCustomerId}
        shipToCustomerName={missingSheetOrder?.shipToCustomerName}
        onResolved={() => {
          sheetResolvedRef.current = true;
          setMissingSheetWarning(undefined);
          setMissingSheetOpen(false);
          void fetchBoard();
          void fetchMissingCustomers();
        }}
      />

      <ManualTintEntryModal
        open={pullModalOpen}
        onClose={() => setPullModalOpen(false)}
        onSuccess={() => { void fetchBoard(); }}
      />

      <ManualTintRevertModal
        open={revertOrder !== null}
        onClose={() => setRevertOrder(null)}
        orderId={revertOrder?.id ?? null}
        obdNumber={revertOrder?.obdNumber ?? null}
        onSuccess={() => { setRevertOrder(null); void fetchBoard(); }}
      />

      {removeModalOrder && (
        <RemoveObdModal
          open
          onClose={() => setRemoveModalOrder(null)}
          onRemoved={() => {
            setRemoveModalOrder(null);
            setPanelKey(null);
            void fetchBoard();
            void fetchMissingCustomers();
          }}
          order={{
            id:                 removeModalOrder.id,
            obdNumber:          removeModalOrder.obdNumber,
            orderDateTime:      removeModalOrder.orderDateTime,
            shipToCustomerName: removeModalOrder.customer?.customerName ?? removeModalOrder.shipToCustomerName,
            smu:                removeModalOrder.smu,
            articleTag:         removeModalOrder.articleTag ?? removeModalOrder.querySnapshot?.articleTag ?? null,
            totalVolume:        removeModalOrder.querySnapshot?.totalVolume ?? null,
            challan:            removeModalOrder.challan ?? null,
          }}
        />
      )}

      {hideModalOrder && (
        <HideObdModal
          open
          onClose={() => setHideModalOrder(null)}
          onHidden={() => { setHideModalOrder(null); void fetchBoard(); }}
          order={{
            id:        hideModalOrder.id,
            obdNumber: hideModalOrder.obdNumber,
            siteName:  hideModalOrder.customer?.customerName ?? hideModalOrder.shipToCustomerName,
          }}
        />
      )}

      {skipHistoryFor && (
        <SkipHistoryModal
          open
          orderId={skipHistoryFor.orderId}
          obdNumber={skipHistoryFor.obdNumber}
          customerName={skipHistoryFor.customerName}
          onClose={() => setSkipHistoryFor(null)}
        />
      )}

      {pauseHistoryFor && (
        <PauseHistoryModal
          open
          orderId={pauseHistoryFor.orderId}
          obdNumber={pauseHistoryFor.obdNumber}
          customerName={pauseHistoryFor.customerName}
          onClose={() => setPauseHistoryFor(null)}
        />
      )}
    </div>
  );
}
