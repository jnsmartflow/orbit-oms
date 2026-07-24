"use client";

// Floor Control — the detail panel (design §10, mockup 02-detail-panel.html).
// 472px, slides from the right. Opens from any row or card, in any tab.
//
// Four zones, three fixed (design §10.2): 3-line header · action row · tabs |
// SCROLLING body | prev/next. The context-primary action changes with the SOURCE
// the panel was opened from (design §10.3); Change ship-to and Update slot never
// move so his hand learns one place.
//
// REUSE, never fork:
//   - Change ship-to → Support's GET /api/support/ship-to-search + the override
//     write on PATCH /api/support/orders/[id] (that route uses $transaction — we
//     are a CALLER only; no $transaction in any Floor file).
//   - Update slot / release → components/support/dispatch-slot-picker.tsx +
//     the existing /api/floor routes.
// Every write goes through floor-page's reportWrite() handlers, so a failure
// surfaces — never a swallowed response.

import { useState, useEffect, useCallback, useRef } from "react";
import { Building2, Droplet, X } from "lucide-react";
import { DispatchSlotPicker, type DispatchWindow } from "@/components/support/dispatch-slot-picker";
import { DetailItems } from "./detail-items";
import { DetailDetails } from "./detail-details";
import { DetailActivity } from "./detail-activity";
import type { FloorDetail, FloorDetailSource, FloorPicker } from "@/lib/floor/types";

type Tab = "items" | "details" | "activity";

interface ShipToResult {
  id: number;
  customerName: string;
  area: string | null;
}

// Action handlers — each does the write + reportWrite + board reload inside
// floor-page; the panel just calls the right one per source, then refetches.
export interface DetailActions {
  onRelease: (orderId: number, date: string, windowId: number) => Promise<void>;
  onChangeShipTo: (orderId: number, customerId: number) => Promise<void>;
  onUpdateSlot: (orderId: number, date: string, windowId: number) => Promise<void>;
  onReassign: (orderId: number, pickerId: number) => Promise<void>;
  onRestore: (orderId: number) => Promise<void>;
  onHold: (orderId: number) => Promise<void>;
  onCancel: (orderId: number) => Promise<void>;
  onUnassign: (orderId: number) => Promise<void>;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", " ·");
}

function headerStatus(d: FloorDetail, source: FloorDetailSource): { label: string; cls: string } {
  if (source === "cancelled") return { label: "Cancelled", cls: "bg-[#fef2f2] text-[#b91c1c]" };
  if (source === "hold" || d.dispatchStatus === "hold") return { label: "On hold", cls: "bg-[#fef2f2] text-[#b91c1c]" };
  if (source === "floor") {
    if (d.isChecked) return { label: "Done", cls: "bg-[#dcfce7] text-[#15803d]" };
    if (d.isDone) return { label: "Needs check", cls: "bg-[#fef3c7] text-[#b45309]" };
    if (d.isAssigned) return { label: "With picker", cls: "bg-[#ede9fe] text-[#6d28d9]" };
    return { label: "Waiting", cls: "bg-[#f3f4f6] text-[#6b7280]" };
  }
  // rail
  if (d.workflowStage === "pending_tint_assignment") return { label: "Tint · Pending", cls: "bg-[#ede9fe] text-[#6d28d9]" };
  if (d.workflowStage === "tint_assigned") return { label: "Tint · Assigned", cls: "bg-[#ede9fe] text-[#6d28d9]" };
  if (d.workflowStage === "tinting_in_progress") return { label: "Tint · Mixing", cls: "bg-[#ede9fe] text-[#6d28d9]" };
  return { label: "Waiting for you", cls: "bg-[#f3f4f6] text-[#6b7280]" };
}

export function DetailPanel({
  orderId,
  source,
  list,
  windows,
  pickers,
  actions,
  onClose,
  onNavigate,
}: {
  orderId: number;
  source: FloorDetailSource;
  list: number[];
  windows: DispatchWindow[];
  pickers: FloorPicker[];
  actions: DetailActions;
  onClose: () => void;
  onNavigate: (orderId: number) => void;
}) {
  const [detail, setDetail] = useState<FloorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [editingShipTo, setEditingShipTo] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerId, setPickerId] = useState<number | "">("");

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/floor/order/${orderId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setDetail(json.detail as FloorDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  // Reset per-bill UI when the panel walks to another bill.
  useEffect(() => {
    setTab("items");
    setEditingShipTo(false);
    setMenuOpen(false);
    setPickerId("");
  }, [orderId]);

  // Esc closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Run a write, then refetch this panel's detail (the board reload happens
  // inside the handler). `busy` guards against a double-fire mid-write.
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        await fetchDetail();
      } finally {
        setBusy(false);
      }
    },
    [busy, fetchDetail],
  );

  const index = list.indexOf(orderId);
  const prevId = index > 0 ? list[index - 1] : null;
  const nextId = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

  return (
    <div className="fixed inset-0 z-[110]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-[472px] flex-col bg-white shadow-[-14px_0_40px_rgba(17,24,39,0.10)]">
        {loading && !detail ? (
          <div className="flex flex-1 items-center justify-center text-[11.5px] text-gray-400">Loading…</div>
        ) : error && !detail ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-[12px] text-gray-500">Couldn&rsquo;t load this bill. {error}</div>
            <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-[11.5px] text-gray-600">
              Close
            </button>
          </div>
        ) : detail ? (
          <PanelBody
            d={detail}
            source={source}
            tab={tab}
            setTab={setTab}
            windows={windows}
            pickers={pickers}
            actions={actions}
            busy={busy}
            run={run}
            editingShipTo={editingShipTo}
            setEditingShipTo={setEditingShipTo}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            pickerId={pickerId}
            setPickerId={setPickerId}
            onClose={onClose}
          />
        ) : null}

        {/* Prev / Next — pinned, never scrolls (design §10.5). */}
        <div className="flex items-center gap-2 border-t border-gray-200 bg-white px-5 py-2.5 text-[11.5px] shadow-[0_-4px_14px_rgba(17,24,39,0.05)]">
          <button
            type="button"
            disabled={prevId === null}
            onClick={() => prevId !== null && onNavigate(prevId)}
            className="rounded-[6px] border border-gray-200 px-3 py-[6px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
          >
            ‹ Previous
          </button>
          {list.length > 1 && (
            <span className="mx-auto text-[11px] text-gray-400">
              {index >= 0 ? index + 1 : "—"} of {list.length} in this list
            </span>
          )}
          <button
            type="button"
            disabled={nextId === null}
            onClick={() => nextId !== null && onNavigate(nextId)}
            className={`rounded-[6px] border border-gray-200 px-3 py-[6px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40 ${list.length > 1 ? "" : "ml-auto"}`}
          >
            Next ›
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── Body (only rendered once detail is loaded) ───────────────────────────────

function PanelBody({
  d,
  source,
  tab,
  setTab,
  windows,
  pickers,
  actions,
  busy,
  run,
  editingShipTo,
  setEditingShipTo,
  menuOpen,
  setMenuOpen,
  pickerId,
  setPickerId,
  onClose,
}: {
  d: FloorDetail;
  source: FloorDetailSource;
  tab: Tab;
  setTab: (t: Tab) => void;
  windows: DispatchWindow[];
  pickers: FloorPicker[];
  actions: DetailActions;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  editingShipTo: boolean;
  setEditingShipTo: (v: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  pickerId: number | "";
  setPickerId: (v: number | "") => void;
  onClose: () => void;
}) {
  const status = headerStatus(d, source);
  const isDoneBill = source === "floor" && d.isChecked;
  const canReassign = source === "floor" && !d.isDone && !d.isChecked;
  const railReleasable = source === "rail" && d.workflowStage === "pending_support";

  // Overflow (⋯) actions per source — only the ones with real routes.
  const overflow: Array<{ label: string; danger?: boolean; fn: () => Promise<void> }> = [];
  if (source === "floor" && d.isAssigned) overflow.push({ label: "Unassign", fn: () => actions.onUnassign(d.orderId) });
  if (source === "floor" || source === "rail") {
    overflow.push({ label: "Hold", fn: () => actions.onHold(d.orderId) });
    overflow.push({ label: "Cancel", danger: true, fn: () => actions.onCancel(d.orderId) });
  }
  if (source === "hold") overflow.push({ label: "Cancel", danger: true, fn: () => actions.onCancel(d.orderId) });

  const currentSlotValue =
    d.dispatchTargetDate && d.dispatchWindowId && d.dispatchWindowTime
      ? { date: d.dispatchTargetDate, dispatchWindowId: d.dispatchWindowId, windowTime: d.dispatchWindowTime }
      : null;

  return (
    <>
      {/* ── Header (fixed) ─────────────────────────────────────────────────── */}
      <div className="px-5 pt-3.5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[19px] font-bold leading-none tracking-[-0.02em] text-gray-900">{d.obdNumber}</span>
          <span className="text-[11px] tabular-nums text-gray-400">{fmtDateTime(d.obdDateTime)}</span>
          <button type="button" onClick={onClose} className="ml-auto self-center text-gray-400 hover:text-gray-600">
            <X size={15} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[14px] font-semibold text-gray-900">{d.shipToName}</span>
          {d.shipToCode && <span className="font-mono text-[11.5px] text-gray-400">{d.shipToCode}</span>}
        </div>
        {/* Tags carry treatment facts only (design §10.2): status, key, urgent, site, tint. */}
        <div className="my-3 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-[4px] px-2.5 py-1 text-[10.5px] font-semibold ${status.cls}`}>{status.label}</span>
          {d.isKeyCustomer && <span className="rounded-[4px] bg-[#fffbeb] px-2 py-[3px] text-[10px] font-semibold text-[#b45309]">★ Key</span>}
          {d.priorityLevel === 1 && <span className="rounded-[4px] bg-[#fef2f2] px-2 py-[3px] text-[10px] font-semibold text-[#b91c1c]">⚡ Urgent</span>}
          {d.isSite && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#f8fafc] px-2 py-[3px] text-[10px] font-semibold text-[#475569]">
              <Building2 size={11} /> Site
            </span>
          )}
          {d.isTint && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#f5f3ff] px-2 py-[3px] text-[10px] font-semibold text-[#6d28d9]">
              <Droplet size={11} /> Tint
            </span>
          )}
        </div>
      </div>

      {/* ── Action row (fixed) — or the ship-to editor when editing ──────────── */}
      {editingShipTo ? (
        <ShipToEditor
          busy={busy}
          onCancel={() => setEditingShipTo(false)}
          onPick={(customerId) =>
            run(async () => {
              await actions.onChangeShipTo(d.orderId, customerId);
              setEditingShipTo(false);
            })
          }
        />
      ) : (
        <div className="flex items-center gap-1.5 border-b border-gray-200 bg-[#fcfcfd] px-5 py-2.5">
          {/* Context-primary action (design §10.3). */}
          {(source === "rail" || source === "hold") && (
            <span className="flex items-center gap-1.5">
              <span className="text-[11.5px] font-medium text-gray-600">{railReleasable || source === "hold" ? "Release to" : "Release"}</span>
              <DispatchSlotPicker
                value={null}
                onChange={(v) => v && run(() => actions.onRelease(d.orderId, v.date, v.dispatchWindowId))}
                windows={windows}
                disabled={source === "rail" && !railReleasable}
              />
              {source === "rail" && !railReleasable && <span className="text-[10px] text-gray-400">shade not ready</span>}
            </span>
          )}
          {canReassign && (
            <span className="flex items-center gap-1.5">
              <select
                value={pickerId}
                onChange={(e) => setPickerId(e.target.value === "" ? "" : Number(e.target.value))}
                className="h-[30px] cursor-pointer rounded-[6px] border border-gray-300 bg-white px-2 text-[11.5px] text-gray-700"
              >
                <option value="">{d.isAssigned ? "Reassign to…" : "Assign to…"}</option>
                {pickers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.onHand === 0 ? " - free" : ` - ${p.onHand} on hand`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pickerId === "" || busy}
                onClick={() => pickerId !== "" && run(() => actions.onReassign(d.orderId, pickerId))}
                className="h-[30px] rounded-[6px] bg-teal-600 px-3 text-[11.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
              >
                {d.isAssigned ? "Reassign" : "Assign"}
              </button>
            </span>
          )}
          {source === "cancelled" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => actions.onRestore(d.orderId))}
              className="h-[30px] rounded-[6px] bg-teal-600 px-3 text-[11.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
            >
              Restore to decisions
            </button>
          )}
          {isDoneBill && <span className="text-[11.5px] text-gray-400">This bill is closed — ship-to still editable</span>}

          {/* Change ship-to + Update slot — never move (design §10.3). Update slot
              is hidden only on cancelled bills (no dispatch slot to set). */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditingShipTo(true)}
              className="h-[30px] rounded-[6px] border border-gray-200 bg-white px-2.5 text-[11px] text-gray-600 hover:border-teal-500 hover:text-teal-700"
            >
              Change ship-to
            </button>
            {source !== "cancelled" && (
              <span className="flex items-center gap-1">
                <span className="text-[10.5px] text-gray-400">Slot</span>
                <DispatchSlotPicker
                  value={currentSlotValue}
                  onChange={(v) => v && run(() => actions.onUpdateSlot(d.orderId, v.date, v.dispatchWindowId))}
                  windows={windows}
                  popoverAlign="right"
                />
              </span>
            )}
            {overflow.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="h-[30px] rounded-[6px] border border-gray-200 bg-white px-2.5 text-[14px] leading-none text-gray-400 hover:border-gray-300 hover:text-gray-600"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 z-20 mt-1 w-[150px] overflow-hidden rounded-[8px] border border-gray-200 bg-white shadow-lg">
                      {overflow.map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setMenuOpen(false);
                            void run(o.fn);
                          }}
                          className={`block w-full px-3 py-2 text-left text-[11.5px] hover:bg-gray-50 disabled:opacity-40 ${o.danger ? "text-red-600" : "text-gray-700"}`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tabs (fixed) ────────────────────────────────────────────────────── */}
      <div className="flex gap-5 border-b border-gray-200 px-5">
        {([
          ["items", `Items ${d.lines.length}`],
          ["details", "Details"],
          ["activity", `Activity ${d.activity.length}`],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 py-[11px] text-[12px] ${tab === key ? "border-gray-900 font-bold text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Body (scrolls) ──────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "items" && <DetailItems lines={d.lines} totalLitres={d.totalLitres} />}
        {tab === "details" && <DetailDetails d={d} />}
        {tab === "activity" && <DetailActivity d={d} />}
      </div>
    </>
  );
}

// ── Ship-to inline editor — reuses Support's search route as a caller ────────

function ShipToEditor({
  busy,
  onCancel,
  onPick,
}: {
  busy: boolean;
  onCancel: () => void;
  onPick: (customerId: number) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShipToResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/support/ship-to-search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        setResults(res.ok ? ((await res.json()) as ShipToResult[]) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <div className="border-b border-gray-200 bg-[#fcfcfd] px-5 py-3">
      <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-gray-400">Change ship-to</div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search dealer or site name…"
        className="h-8 w-full rounded-[7px] border border-gray-300 px-2.5 text-[12px] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
      />
      {q.trim().length >= 2 && (
        <div className="mt-1.5 max-h-[220px] overflow-y-auto">
          {searching && results.length === 0 ? (
            <div className="px-1 py-2 text-[11px] text-gray-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-1 py-2 text-[11px] text-gray-400">No matches.</div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(r.id)}
                className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left hover:bg-[#f0fdfa] disabled:opacity-40"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-800">{r.customerName}</span>
                {r.area && <span className="shrink-0 text-[10px] text-gray-400">{r.area}</span>}
              </button>
            ))
          )}
        </div>
      )}
      <div className="mt-2 flex">
        <button type="button" onClick={onCancel} className="rounded-[6px] border border-gray-200 px-3 py-1.5 text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
