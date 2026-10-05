"use client";

// Billing v2 — the "Print" tab. Slice 9 (2026-09-15); rebuilt for Billing Print
// v2 (2026-10-05, design docs/mockups/billing-print/billing-print-pickdelete-mock.html,
// "MOCKUP v4"). Server rules: lib/billing/print.ts.
//
// Trips the planner SENT TO BILLING. Billing copies each trip's OBD NUMBERS and
// pastes them into SAP, which prints. ORBIT PRINTS NOTHING.
//
//   LEFT  — trips with work outstanding, from every date, GROUPED BY TRIP TYPE
//           (the trip number's letter: Local · UPC · IGT / Cross · Other), each
//           group by trip number ascending. A card is TRIP NUMBER ONLY (never
//           the vehicle), "x / y" copied and per-state chips — nothing else.
//           Below, "Done today" — one collapsible header, collapsed by default,
//           grouped the same way: trip number · ✓ time · who. (Polish v7,
//           2026-10-05, docs/mockups/billing-print/billing-print-polish-mock.html.)
//   RIGHT — the selected trip: number, a per-state summary, a progress bar,
//           ONE button, a legend, and the bill table with Floor's own status
//           pill per bill. Nothing on this tab truncates — long text wraps.
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
// 🔴 NO TRUNCATION ON THIS TAB (owner, 2026-10-05 polish): long ship-to names and
// numbers WRAP to the next line — never an ellipsis. Pills and chips stay on one line.
const HEAD_TH = "h-[31px] border-b border-ink-100 px-3 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-ink-400";
const HEAD_TH_C = "h-[31px] border-b border-ink-100 px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-ink-400";
const TD = "border-b border-ink-50 px-3 py-2 align-top text-[11px] text-ink-600 [overflow-wrap:anywhere]";
const TD_C = "border-b border-ink-50 px-1 py-2 align-top text-center text-[11px] text-ink-400";

// ── Trip-type groups (rail) ──────────────────────────────────────────────────
// The trip number's first letter is its delivery type (lib/trips/number.ts:
// Local → L, Upcountry → U, IGT → I, Cross → C — CLAUDE_FLOOR_TRIPS §5). IGT and
// Cross share one group (owner). Anything else lands in "Other" rather than
// vanishing.
const TRIP_GROUPS: readonly { key: string; label: string; letters: readonly string[] }[] = [
  { key: "local", label: "Local", letters: ["L"] },
  { key: "upc", label: "UPC", letters: ["U"] },
  { key: "igt", label: "IGT / Cross", letters: ["I", "C"] },
];

/** Trips grouped by type, in the fixed order, each sorted by trip number ascending; empty groups dropped. */
function groupTrips(trips: readonly PrintTrip[]): { key: string; label: string; trips: PrintTrip[] }[] {
  const byNumber = (a: PrintTrip, b: PrintTrip) => a.tripNumber.localeCompare(b.tripNumber);
  const out = TRIP_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    trips: trips.filter((t) => g.letters.includes(t.tripNumber.charAt(0))).sort(byNumber),
  }));
  const known = new Set(TRIP_GROUPS.flatMap((g) => g.letters));
  out.push({ key: "other", label: "Other", trips: trips.filter((t) => !known.has(t.tripNumber.charAt(0))).sort(byNumber) });
  return out.filter((g) => g.trips.length > 0);
}

const GROUP_HEAD = "mb-1.5 mt-3 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400";
const CHIP = "whitespace-nowrap rounded px-1.5 py-px text-[10.5px] font-semibold";

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

/** The header's one-line summary, in state colours. A done trip says so instead. */
function Summary({ trip }: { trip: PrintTrip }) {
  if (trip.state === "done") {
    const all = trip.eligible > 0 && trip.copiedCount === trip.eligible;
    return (
      <>
        <span className="text-ok-text">✓ Done {hhmm(trip.billingDoneAt)}</span>
        {trip.billingDoneByName && <span className="text-ink-500"> · {firstName(trip.billingDoneByName)}</span>}
        <span className="text-ink-500">
          {" · "}
          {all ? `all ${trip.copiedCount} copied` : `${trip.copiedCount} of ${trip.eligible} copied`}
        </span>
      </>
    );
  }
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
  /** "Done today" — collapsed by default; component state only (owner). */
  const [doneOpen, setDoneOpen] = useState(false);
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

  // The rail's order: pending grouped by trip type, then Done today grouped the same way.
  const pendingGroups = useMemo(() => groupTrips(pending), [pending]);
  const doneGroups = useMemo(() => groupTrips(done), [done]);

  // The selection is an id, so it survives a refetch; if its trip left both
  // lists, fall back to the first card ON SCREEN rather than showing nothing.
  const selected = useMemo(() => {
    const ordered = [...pendingGroups.flatMap((g) => g.trips), ...doneGroups.flatMap((g) => g.trips)];
    return ordered.find((t) => t.id === selectedId) ?? ordered[0] ?? null;
  }, [pendingGroups, doneGroups, selectedId]);

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
            {pendingGroups.map((g) => (
              <div key={g.key}>
                <div className={GROUP_HEAD}>
                  {g.label} · {g.trips.length}
                </div>
                {g.trips.map((t) => (
                  <PendingCard key={t.id} trip={t} active={selected?.id === t.id} onSelect={() => setSelectedId(t.id)} />
                ))}
              </div>
            ))}

            {/* Done today — ONE collapsible header, collapsed by default. */}
            <button
              type="button"
              onClick={() => setDoneOpen((o) => !o)}
              aria-expanded={doneOpen}
              className="mt-4 flex w-full items-center border-t border-ink-100 px-1 pb-1 pt-2.5 text-left text-[12px] font-semibold text-ink-600"
            >
              <span>
                {isToday ? "Done today" : `Done · ${formatDayLabel(date!)}`} · {done.length}
              </span>
              <span className={`ml-auto text-ink-400 transition-transform ${doneOpen ? "rotate-90" : ""}`} aria-hidden>
                ›
              </span>
            </button>
            {doneOpen && (
              <>
                {done.length === 0 && (
                  <div className="px-2 py-3 text-[11px] text-ink-400">
                    {isToday ? "Nothing done yet today." : "Nothing done on this day."}
                  </div>
                )}
                {doneGroups.map((g) => (
                  <div key={g.key}>
                    <div className={GROUP_HEAD}>
                      {g.label} · {g.trips.length}
                    </div>
                    {g.trips.map((t) => (
                      <DoneRow key={t.id} trip={t} active={selected?.id === t.id} onSelect={() => setSelectedId(t.id)} />
                    ))}
                  </div>
                ))}
              </>
            )}
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
      // A done trip has no action — the status line says it is done (mock v7).
      action = null;
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
            <div className="border-b border-ink-100 px-[18px] pb-3 pt-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  {/* Plain bold mono — no chip (mock v7). Wraps, never truncates. */}
                  <span className="mr-3 font-mono text-[15px] font-semibold text-ink-900 [overflow-wrap:anywhere]">
                    {selected.tripNumber}
                  </span>
                  <span className="text-[11.5px] font-semibold">
                    <Summary trip={selected} />
                  </span>
                </div>
                {(action || caption) && (
                  <div className="ml-auto flex flex-col items-end">
                    {action}
                    {caption && <span className="mt-1 max-w-[360px] text-right text-[10.5px] text-ink-400">{caption}</span>}
                  </div>
                )}
              </div>
              <ProgressBar trip={selected} />
            </div>

            {/* The one-line legend (mock v7). */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-ink-100 px-[18px] py-2 text-[11px] text-ink-500">
              <LegendItem swatch="bg-ok" label="Copied" />
              <LegendItem swatch="bg-brand-600" label="Ready — goes in the next Copy" />
              <LegendItem swatch="bg-danger" label="Pick finding — open it to copy" />
              <LegendItem swatch="bg-ink-200" label="Waiting — not picked yet" />
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

            {/* Phone width: the table keeps a readable minimum and scrolls inside the pane. */}
            <div className="min-h-0 flex-1 overflow-auto">
              {selected.rows.length === 0 ? (
                <div className="px-5 py-10 text-center text-[11.5px] text-ink-400">No bills on this trip.</div>
              ) : (
                <table className="w-full min-w-[640px] table-fixed border-collapse">
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
      return <span className="whitespace-nowrap font-semibold text-ok-text">✓ {hhmm(r.copiedAt)}</span>;
    case "ready":
      return <span className={`${CHIP} bg-brand-50 text-brand-700`}>next copy</span>;
    case "review":
      return <span className={`${CHIP} bg-danger-bg text-danger-text`}>open to copy →</span>;
    case "waiting":
      return <span className="text-ink-400">not picked yet</span>;
    case "held":
      return <span className="text-ink-400">on hold · not copied</span>;
  }
}

/** Copied green, ready brand, the rest grey — over the non-held bills. */
function ProgressBar({ trip }: { trip: PrintTrip }) {
  if (trip.eligible === 0) return null;
  const pct = (n: number) => `${(n / trip.eligible) * 100}%`;
  return (
    <div className="mt-2.5 flex h-[4px] overflow-hidden rounded-sm bg-ink-100" aria-hidden>
      <span className="block h-full bg-ok" style={{ width: pct(trip.copiedCount) }} />
      {trip.state !== "done" && <span className="block h-full bg-brand-600" style={{ width: pct(trip.readyCount) }} />}
    </div>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-[9px] w-[9px] rounded-[2px] ${swatch}`} aria-hidden />
      {label}
    </span>
  );
}

/**
 * A trip with work outstanding: number + "x / y", then chips only (mock v7).
 * Plain grey border, NO coloured edge; the selected card is an ink border.
 */
function PendingCard({ trip, active, onSelect }: { trip: PrintTrip; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-1.5 block w-full rounded-[8px] border bg-white px-3 py-2.5 text-left transition-colors ${
        active ? "border-ink-900" : "border-ink-100 hover:border-ink-200"
      }`}
    >
      <div className="flex items-baseline gap-2">
        {/* TRIP NUMBER ONLY — never the vehicle number (owner). Wraps, never truncates. */}
        <span className="min-w-0 font-mono text-[12.5px] font-semibold text-ink-900 [overflow-wrap:anywhere]">
          {trip.tripNumber}
        </span>
        <span className="ml-auto whitespace-nowrap text-[11.5px] tabular-nums text-ink-500">
          {trip.copiedCount} / {trip.eligible}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {trip.copiedCount > 0 && <span className={`${CHIP} bg-ok-bg text-ok-text`}>{trip.copiedCount} copied</span>}
        {trip.readyCount > 0 && <span className={`${CHIP} bg-brand-50 text-brand-700`}>{trip.readyCount} ready</span>}
        {trip.reviewCount > 0 && <span className={`${CHIP} bg-danger-bg text-danger-text`}>{trip.reviewCount} to check</span>}
        {trip.waitingCount > 0 && <span className={`${CHIP} bg-ink-50 text-ink-600`}>{trip.waitingCount} waiting</span>}
        {trip.eligible === 0 && (
          <span className={`${CHIP} bg-ink-50 text-ink-600`}>{trip.held > 0 ? "all on hold" : "no bills"}</span>
        )}
      </div>
    </button>
  );
}

/** A Done-today row: trip number · ✓ time · who. Nothing else (mock v7). */
function DoneRow({ trip, active, onSelect }: { trip: PrintTrip; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-ink-600 ${
        active ? "bg-ink-50 text-ink-900" : "hover:bg-ink-25"
      }`}
    >
      <span className="font-mono text-ink-900 [overflow-wrap:anywhere]">{trip.tripNumber}</span>
      <span className="ml-auto text-[11.5px] text-ink-400">
        <span className="whitespace-nowrap font-semibold text-ok-text">✓ {hhmm(trip.billingDoneAt)}</span>
        {trip.billingDoneByName ? ` · ${firstName(trip.billingDoneByName)}` : ""}
      </span>
    </button>
  );
}
