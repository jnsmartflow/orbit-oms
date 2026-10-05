"use client";

// Billing v2 — the "Print" tab. Slice 9 (2026-09-15); rebuilt for Billing Print
// v2 (2026-10-05, design docs/mockups/billing-print/billing-print-pickdelete-mock.html,
// "MOCKUP v4"). Server rules: lib/billing/print.ts.
//
// Trips the planner SENT TO BILLING. Billing copies each trip's OBD NUMBERS and
// pastes them into SAP, which prints. ORBIT PRINTS NOTHING.
//
//   LEFT  — one card per trip: TRIP NUMBER ONLY (never the vehicle), x/y copied,
//           bills · stops · litres and how far copying has got. Trips with work
//           outstanding first, from every date; then the trips billing pressed
//           Done on the header's day ("Done today").
//   RIGHT — the selected trip: number, a per-state summary, ONE button, and the
//           bill table with Floor's own status pill per bill.
//
// ── EACH BILL HAS A STATE (lib/billing/print.ts PrintBillState) ─────────────
//   copied  green  — copied on this trip (✓ time).
//   ready   brand  — picking Done (Floor's Done pill), no confirmed finding →
//                    goes in the next bulk Copy.
//   review  danger — picking Done WITH a confirmed pick finding → left out of the
//                    bulk Copy; open it, read the finding, Copy OBD / Mark done.
//   waiting grey   — not picked yet. Joins the next Copy once ready.
//   held    struck — on hold. Shown, never copied, never counted.
// An invoice number is NOT needed to copy; it is shown when SAP has stamped it.
//
// 🔴 THE PICKING PILL IS FLOOR'S OWN (components/floor/status-pill.tsx) fed the
// facts getFloorBoard derives, so a bill can never read one way here and another
// on Floor. Imported, never restyled.
//
// 🔴 COPY = CLIPBOARD FIRST, THEN RECORD. "Copy N OBDs" puts every READY bill's
// OBD on the clipboard and then tells the server exactly which bills; the server
// records only if each is still ready (409 otherwise). Partial copies are
// allowed — slice 9's "never a partial set" was removed on purpose (owner,
// 2026-10-05); do not restore it. The next press copies only bills that became
// ready since.
//
// 🔴 DONE IS A PRESS. When every non-held bill is copied, "Done — all copied"
// appears and moves the trip to Done today. Nothing stamps it automatically.
//
// 🔴 HIDE, NEVER DISABLE, FOR PERMISSION (CLAUDE_UI §10). Without
// `billing_print` canEdit the Copy button is a plain clipboard copy of the ready
// OBDs that records nothing, and Done is not rendered at all. The routes
// re-check every gate. Ctrl+C does whatever the Copy button does.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  useBillingPrintMarkerSubscription,
  useBillingPrintMarkerPause,
} from "@/components/billing/billing-marker-provider";
import { toast } from "sonner";
import { getTodayIST } from "@/lib/dates";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import type { PrintBillRow, PrintBillState, PrintTrip } from "@/lib/billing/print";
import { useBillingShownIds } from "@/components/billing/billing-live";
import { GiftBadge } from "@/components/floor/gift-badge";
import { StatusPill, rowStatus } from "@/components/floor/status-pill";
import { BillingOrderDetailPanel } from "@/components/billing/billing-order-detail-panel";

const LIST_URL = "/api/billing/print/list";

// Fixed table standard (CLAUDE_UI §27): 31px header, 10px uppercase header, 11px data.
const HEAD_TH = "h-[31px] border-b border-ink-100 px-3 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-ink-400";
const HEAD_TH_C = "h-[31px] border-b border-ink-100 px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-ink-400";
const TD = "border-b border-ink-50 px-3 py-2 text-[11px] text-ink-600 whitespace-nowrap overflow-hidden text-ellipsis";
const TD_C = "border-b border-ink-50 px-1 py-2 text-center text-[11px] text-ink-400";

// # 4 · OBD 14 · Invoice no 14 · Ship to 26 · Vol 8 · Picking 18 · Copy 16 = 100
const WIDTHS = [4, 14, 14, 26, 8, 18, 16];

// One brand button per surface (CLAUDE_UI §10): Copy is the brand action; Done
// wears ok green (a finished state's action); disabled is grey, never faded.
const BTN = "inline-flex h-[32px] items-center rounded-md px-[15px] text-[12px] font-semibold transition-colors";
const BTN_BRAND = `${BTN} bg-brand-600 text-white hover:bg-brand-700`;
const BTN_OK = `${BTN} bg-ok text-white hover:bg-ok-text`;
const BTN_PLAIN = `${BTN} border border-ink-200 bg-white text-ink-700 hover:bg-ink-25`;
const BTN_OFF = `${BTN} cursor-not-allowed border border-ink-100 bg-ink-50 text-ink-400`;

interface PrintList {
  pending: PrintTrip[];
  /** Trips billing pressed Done on, for the header's day (wire name kept from slice 9). */
  copied: PrintTrip[];
}

function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

function formatDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", timeZone: "Asia/Kolkata",
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function firstName(name: string | null): string {
  return name ? name.split(" ")[0] : "";
}

/** "12m" / "3h" — Floor's elapsed style for an in-progress pill. */
function shortElapsed(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const mins = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)}d`;
}

/**
 * The pill's time, by Floor's liveTime rule (components/floor/floor-table.tsx):
 * finished → the clock, in progress → elapsed. Tint done carries none here.
 */
export function printPillTime(r: PrintBillRow, nowMs: number): string | null {
  const st = rowStatus(r);
  if (st === "done") return hhmm(r.checkedAt) || null;
  if (st === "direct") return hhmm(r.directLoadedAt) || null;
  if (st === "needsCheck") return shortElapsed(r.pickedAt, nowMs);
  if (st === "withPicker") return shortElapsed(r.assignedAt, nowMs);
  return null;
}

/** Floor's pill for one bill — on a review bill, the shared red reading. */
export function PrintPickingPill({ row, nowMs }: { row: PrintBillRow; nowMs: number }) {
  return <StatusPill status={rowStatus(row)} time={printPillTime(row, nowMs)} onRed={row.state === "review"} />;
}

/** The header's one-line summary, in state colours. */
function Summary({ trip }: { trip: PrintTrip }) {
  if (trip.eligible === 0) {
    return <span className="text-ink-500">{trip.held > 0 ? "Every bill is on hold" : "No bills on this trip"}</span>;
  }
  return (
    <>
      <span className="text-ok-text">{trip.copiedCount} copied</span>
      <span className="text-ink-400"> · </span>
      <span className="text-brand-700">{trip.readyCount} ready</span>
      {trip.reviewCount > 0 && (
        <>
          <span className="text-ink-400"> · </span>
          <span className="text-danger-text">{trip.reviewCount} to check</span>
        </>
      )}
      <span className="text-ink-400"> · </span>
      <span className="text-ink-500">{trip.waitingCount} waiting</span>
      {trip.held > 0 && <span className="text-ink-400"> · {trip.held} on hold, not copied</span>}
    </>
  );
}

/** Why there is nothing to copy — the grey button's caption and the Ctrl+C toast. */
function nothingReadyReason(trip: PrintTrip): string {
  if (trip.eligible === 0) return trip.held > 0 ? "Every bill is on hold." : "No bills on this trip.";
  const bits: string[] = [];
  if (trip.reviewCount > 0) bits.push(`${trip.reviewCount} with a pick finding — open it to copy.`);
  if (trip.waitingCount > 0) bits.push(`${trip.waitingCount} still being picked.`);
  if (bits.length === 0) return "Every bill is copied.";
  return bits.join(" ");
}

const ROW_CLS: Record<PrintBillState, { row: string; edge: string }> = {
  copied: { row: "bg-ok-bg", edge: "border-l-ok" },
  ready: { row: "", edge: "border-l-brand-600" },
  review: { row: "bg-danger-bg", edge: "border-l-danger" },
  waiting: { row: "bg-ink-25", edge: "border-l-ink-200" },
  held: { row: "", edge: "border-l-transparent" },
};

export function BillingPrintTab({
  date,
  canEdit = false,
  railSlot = null,
}: {
  date?: string;
  /**
   * Does this viewer hold `billing_print`/canEdit? FALSE → Copy is a plain
   * clipboard copy that records nothing, and Done is hidden.
   * ⚠ NOT AUTHORISATION — the routes re-check.
   */
  canEdit?: boolean;
  /**
   * The page's 320px left-column slot (review-view.tsx), where the trip list is
   * drawn. Null → no list is drawn; ReviewView always provides it on the billing
   * face, mounted before this tab can be opened.
   */
  railSlot?: HTMLElement | null;
}) {
  const [data, setData] = useState<PrintList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openBillId, setOpenBillId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const reqRef = useRef(0);

  const isToday = !date || date === getTodayIST();

  // The pills' elapsed times move once a minute.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    try {
      const url = date ? `${LIST_URL}?date=${encodeURIComponent(date)}` : LIST_URL;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        if (seq === reqRef.current) setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as PrintList;
      if (seq !== reqRef.current) return;
      setData(body);
      setError(null);
    } catch {
      if (seq === reqRef.current) setError("Could not reach the server.");
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useBillingPrintMarkerSubscription(load);
  // Never move the ground under a hand: no refetch while a write is in flight
  // or a bill's panel is open.
  useBillingPrintMarkerPause("print-tab-write", busy);
  useBillingPrintMarkerPause("print-tab-panel", openBillId !== null);

  const pending = useMemo(() => data?.pending ?? [], [data]);
  const done = useMemo(() => data?.copied ?? [], [data]);

  // LIVE FEED: the trip ids, and the bills on them (a stage / hold / finding
  // change arrives as an ORDER id). No-ops off the feed.
  const shownTripIds = useMemo(() => [...pending.map((t) => t.id), ...done.map((t) => t.id)], [pending, done]);
  useBillingShownIds("print-tab", "print", shownTripIds);
  const shownOrderIds = useMemo(() => [...pending, ...done].flatMap((t) => t.rows.map((r) => r.orderId)), [pending, done]);
  useBillingShownIds("print-tab-bills", "printOrders", shownOrderIds);

  // The selection is an id, so it survives a refetch; if its trip left both
  // lists, fall back to the first card rather than showing nothing.
  const selected = useMemo(() => {
    const all = [...pending, ...done];
    return all.find((t) => t.id === selectedId) ?? all[0] ?? null;
  }, [pending, done, selectedId]);

  // The panel belongs to the selected trip; changing trip closes it.
  const selectedTripId = selected?.id ?? null;
  useEffect(() => {
    setOpenBillId(null);
  }, [selectedTripId]);

  const showDone = !!selected && canEdit && selected.canDone;
  const readyN = selected?.readyCount ?? 0;

  // Bulk Copy: clipboard FIRST, then record (canEdit only).
  const runCopy = useCallback(async () => {
    if (!selected || busy || selected.readyCount === 0) return;
    setNotice(null);
    try {
      await navigator.clipboard.writeText(selected.readyObds.join("\n"));
    } catch {
      setNotice({ tone: "error", text: "Couldn't reach the clipboard — copy blocked by the browser. Nothing was recorded." });
      return;
    }
    setCopiedFlash(true);
    window.setTimeout(() => setCopiedFlash(false), 1600);
    if (!canEdit) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/billing/print/trip/${selected.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selected.readyOrderIds, kind: "bulk" }),
      });
      const body = (await res.json().catch(() => ({}))) as { alreadyCopied?: number; error?: string };
      if (!res.ok) {
        setNotice({ tone: "error", text: body.error ?? `Copied, but not recorded (HTTP ${res.status}).` });
      } else if ((body.alreadyCopied ?? 0) > 0) {
        setNotice({ tone: "info", text: `${plural(body.alreadyCopied ?? 0, "bill")} had already been copied by someone else — not recorded again.` });
      }
    } catch {
      setNotice({ tone: "error", text: "Copied, but could not reach the server — NOT recorded. Press Copy again." });
    } finally {
      setBusy(false);
    }
    await load();
  }, [selected, busy, canEdit, load]);

  const runDone = useCallback(async () => {
    if (!selected || busy || !canEdit) return;
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/billing/print/trip/${selected.id}/done`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { changed?: boolean; error?: string };
      if (!res.ok) setNotice({ tone: "error", text: body.error ?? `Not saved (HTTP ${res.status}).` });
      else if (!body.changed) setNotice({ tone: "info", text: `${selected.tripNumber} was already done.` });
      else toast.success(`${selected.tripNumber} moved to Done today`);
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server — Done was not saved." });
    } finally {
      setBusy(false);
    }
    await load();
  }, [selected, busy, canEdit, load]);

  // Ctrl+C — the bulk Copy, nothing else. Mounted only while this tab is on
  // screen; the Orders tab's smart copy stands down on every other tab. A text
  // selection or a focused field keeps the browser's own copy; an open panel
  // keeps the page's hands off.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c" || e.shiftKey || e.altKey) return;
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((window.getSelection()?.toString() ?? "").length > 0) return;
      if (!selected || openBillId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      // 🔴 NEVER SILENT (owner): a shortcut that does nothing reads as broken.
      if (selected.readyCount === 0) {
        if (!e.repeat) toast.info(`${selected.tripNumber}: ${nothingReadyReason(selected)}`);
        return;
      }
      void runCopy();
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, [selected, openBillId, runCopy]);

  // ── Rail ───────────────────────────────────────────────────────────────
  // 🔴 DRAWN INTO THE PAGE'S LEFT COLUMN, NOT BESIDE THE DETAIL (owner). ReviewView
  // owns a 320px slot with the inbox rail's exact classes and hands it over as
  // `railSlot`; this list is portalled into it, so its state stays here and
  // only its DOM moves. No width, border or tint of its own — the slot owns them.
  const rail = (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The inbox rail head's classes, exactly, so the bottom borders line up. */}
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="flex h-[28px] items-center gap-2">
          <span className="text-[12.5px] font-bold text-ink-900">
            {loading ? "Loading…" : `${plural(pending.length, "trip")} to copy`}
          </span>
          {/* The header date moves Done today, NEVER this list (owner). */}
          {!loading && <span className="-ml-1 text-[11px] text-ink-400">· any date</span>}
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-ok-text">
            <span className="h-[7px] w-[7px] rounded-full bg-ok ring-[3px] ring-ok/15" />
            live
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? (
          <div className="px-2 py-8 text-center text-[11.5px] text-ink-400">Couldn&rsquo;t load. {error}</div>
        ) : loading ? null : (
          <>
            {pending.length === 0 && (
              <div className="px-2 py-6 text-center text-[11.5px] text-ink-400">No trip is waiting to be copied.</div>
            )}
            {pending.map((t) => (
              <TripCard key={t.id} trip={t} active={selected?.id === t.id} onSelect={() => setSelectedId(t.id)} />
            ))}
            <div className="mb-1.5 mt-3 px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400">
              {isToday ? "Done today" : `Done · ${formatDayLabel(date!)}`} · {done.length}
            </div>
            {done.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-ink-400">
                {isToday ? "Nothing done yet today." : "Nothing done on this day."}
              </div>
            )}
            {done.map((t) => (
              <TripCard key={t.id} trip={t} active={selected?.id === t.id} onSelect={() => setSelectedId(t.id)} />
            ))}
          </>
        )}
      </div>
    </div>
  );

  // ── The one action ──────────────────────────────────────────────────────
  let action: ReactNode = null;
  let caption = "";
  if (selected) {
    if (selected.state === "done") {
      action = (
        <span className="inline-flex h-[32px] items-center rounded-md bg-ok-bg px-3 text-[12px] font-semibold text-ok-text">
          ✓ Trip done{selected.billingDoneAt ? ` · ${hhmm(selected.billingDoneAt)}` : ""}
        </span>
      );
      caption = selected.billingDoneByName
        ? `by ${firstName(selected.billingDoneByName)} · Floor can still take bills back`
        : "Floor can still take bills back";
    } else if (showDone) {
      action = (
        <button type="button" onClick={() => void runDone()} disabled={busy} className={BTN_OK}>
          {busy ? "Saving…" : "Done — all copied"}
        </button>
      );
      caption = "Every bill is copied. Press Done to close the trip.";
    } else if (readyN > 0) {
      action = (
        <button type="button" onClick={() => void runCopy()} disabled={busy} className={canEdit ? BTN_BRAND : BTN_PLAIN}>
          {busy ? "Recording…" : copiedFlash ? "Copied" : `Copy ${readyN} OBD${readyN === 1 ? "" : "s"}`}
        </button>
      );
      caption = canEdit
        ? `Copies OBD nos of picked bills only.${selected.reviewCount > 0 ? " Red bills are left out — open them to copy." : ""}`
        : "Copies to the clipboard only — records nothing.";
    } else {
      action = (
        <button type="button" disabled className={BTN_OFF}>
          Copy · nothing ready
        </button>
      );
      caption = nothingReadyReason(selected);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-white">
      {railSlot ? createPortal(rail, railSlot) : null}

      {/* ── Detail ───────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="px-5 py-14 text-center">
            {!loading && !error && (
              <>
                <div className="text-[28px] leading-none text-ink-200">○</div>
                <h4 className="mt-2 text-[13px] font-semibold text-ink-900">No trips sent to billing</h4>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400">
                  A trip appears here when the planner presses Send to billing on the floor.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 border-b border-ink-100 px-[18px] pb-3 pt-3.5">
              <div className="min-w-0">
                <span className="rounded-[6px] bg-ink-900 px-2.5 py-[3px] font-mono text-[12px] font-semibold tracking-[0.02em] text-white">
                  {selected.tripNumber}
                </span>
                <div className="mt-2 text-[11.5px] font-semibold">
                  <Summary trip={selected} />
                </div>
              </div>
              <div className="ml-auto flex flex-col items-end">
                {action}
                {caption && <span className="mt-1 max-w-[360px] text-right text-[10.5px] text-ink-400">{caption}</span>}
              </div>
            </div>

            {notice && (
              <div
                role="alert"
                className={`border-b px-[18px] py-2 text-[11.5px] ${
                  notice.tone === "error"
                    ? "border-danger-bd bg-danger-bg text-danger-text"
                    : "border-warn/30 bg-warn-bg text-warn-text"
                }`}
              >
                {notice.text}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {selected.rows.length === 0 ? (
                <div className="px-5 py-10 text-center text-[11.5px] text-ink-400">No bills on this trip.</div>
              ) : (
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    {WIDTHS.map((w, i) => (
                      <col key={i} style={{ width: `${w}%` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={HEAD_TH_C}>#</th>
                      <th className={HEAD_TH}>OBD</th>
                      <th className={HEAD_TH}>Invoice no</th>
                      <th className={HEAD_TH}>Ship to</th>
                      <th className={HEAD_TH}>Vol</th>
                      <th className={HEAD_TH}>Picking</th>
                      <th className={HEAD_TH}>Copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rows.map((r, i) => (
                      <BillRow
                        key={r.orderId}
                        row={r}
                        index={i + 1}
                        nowMs={nowMs}
                        open={openBillId === r.orderId}
                        onOpen={() => setOpenBillId(r.orderId)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {selected && openBillId !== null && (
        <BillingOrderDetailPanel
          mode="print"
          orderId={openBillId}
          tripId={selected.id}
          canEdit={canEdit}
          onClose={() => setOpenBillId(null)}
          onMarkedDone={() => {
            setOpenBillId(null);
            void load();
          }}
          onPrintRecorded={() => void load()}
        />
      )}
    </div>
  );
}

function BillRow({
  row: r,
  index,
  nowMs,
  open,
  onOpen,
}: {
  row: PrintBillRow;
  index: number;
  nowMs: number;
  open: boolean;
  onOpen: () => void;
}) {
  const cls = ROW_CLS[r.state];
  const held = r.state === "held";
  const muted = held || r.state === "waiting" ? " !text-ink-400" : "";
  const strike = held ? " line-through" : "";
  return (
    <tr onClick={onOpen} className={`cursor-pointer ${open ? "bg-brand-50" : cls.row} hover:bg-brand-50/60`}>
      <td className={`${TD_C} border-l-[3px] ${cls.edge}`}>{index}</td>
      <td className={`${TD} font-mono${r.state === "ready" ? " font-semibold text-ink-900" : ""}${muted}${strike}`}>
        {r.obdNumber}
      </td>
      <td className={`${TD}${muted}${strike}`}>
        {r.invoiceNo ? <span className="font-mono">{r.invoiceNo}</span> : <span className="text-ink-400">— not yet</span>}
      </td>
      <td className={`${TD}${muted}${strike}`} title={r.shipToName ?? undefined}>
        {r.shipToName ? smartTitleCase(r.shipToName) : "—"}
        {r.isGift && (
          <span className="ml-1.5 inline-block align-[-1px]">
            <GiftBadge />
          </span>
        )}
      </td>
      <td
        className={`${TD} tabular-nums${r.isGift && !held ? " !text-ink-400" : muted}${strike}`}
        title={r.isGift ? "Gift — not counted in L / kg" : undefined}
      >
        {r.litres > 0 ? `${Math.round(r.litres).toLocaleString("en-US")} L` : ""}
      </td>
      <td className={TD}>
        <PrintPickingPill row={r} nowMs={nowMs} />
      </td>
      <td className={TD}>
        <CopyCell row={r} />
      </td>
    </tr>
  );
}

function CopyCell({ row: r }: { row: PrintBillRow }) {
  switch (r.state) {
    case "copied":
      return <span className="font-semibold text-ok-text">✓ {hhmm(r.copiedAt)}</span>;
    case "ready":
      return <span className="font-semibold text-brand-700">next copy</span>;
    case "review":
      return <span className="font-semibold text-danger-text">open to copy →</span>;
    case "waiting":
      return <span className="text-ink-400">not picked yet</span>;
    case "held":
      return <span className="text-ink-400">on hold · not copied</span>;
  }
}

function TripCard({ trip, active, onSelect }: { trip: PrintTrip; active: boolean; onSelect: () => void }) {
  const done = trip.state === "done";
  const allCopied = trip.eligible > 0 && trip.copiedCount === trip.eligible;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-1.5 block w-full rounded-[8px] border px-3 py-2.5 text-left transition-colors ${
        active ? "border-ink-900 bg-white shadow-sm" : "border-ink-100 bg-white hover:border-ink-200"
      } ${done && !active ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2">
        {/* TRIP NUMBER ONLY — never the vehicle number (owner). */}
        <span className="font-mono text-[12px] font-semibold text-ink-900">{trip.tripNumber}</span>
        <span
          className={`ml-auto rounded-full px-2 py-[1px] text-[9.5px] font-bold tabular-nums ${
            allCopied ? "bg-ok-bg text-ok-text" : "bg-warn-bg text-warn-text"
          }`}
        >
          {trip.copiedCount}/{trip.eligible}
        </span>
      </div>
      <div className="mt-1 text-[11px] tabular-nums text-ink-500">
        {plural(trip.bills, "bill")} · {plural(trip.stops, "stop")} · {Math.round(trip.litres).toLocaleString("en-US")} L
      </div>
      <div className="mt-0.5 text-[11px] text-ink-500">
        {done ? (
          <span className="text-ink-400">
            Done {hhmm(trip.billingDoneAt)}
            {trip.billingDoneByName ? ` · ${firstName(trip.billingDoneByName)}` : ""}
          </span>
        ) : trip.eligible === 0 ? (
          trip.held > 0 ? "every bill on hold" : "no bills"
        ) : (
          <>
            {trip.copiedCount} copied · {trip.readyCount} ready
            {trip.reviewCount > 0 && <span className="text-danger-text"> · {trip.reviewCount} to check</span>}
            {" · "}
            {trip.waitingCount} waiting
            {trip.held > 0 ? ` · ${trip.held} on hold` : ""}
          </>
        )}
      </div>
      {trip.state === "reopened" && (
        <div className="mt-0.5 text-[11px] font-semibold text-brand-700">reopened · done {hhmm(trip.billingDoneAt)}</div>
      )}
    </button>
  );
}
