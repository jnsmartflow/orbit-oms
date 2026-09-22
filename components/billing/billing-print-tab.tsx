"use client";

// Billing v2 — the "Print" tab (slice 9, 2026-09-15).
//
// Trips the planner SENT TO BILLING. Billing copies each trip's invoice numbers
// and pastes them into SAP, which prints. ORBIT PRINTS NOTHING.
//
//   LEFT  — one card per trip: TRIP NUMBER ONLY (never the vehicle), bills,
//           stops, litres and how far invoicing has got. Trips with copy work
//           outstanding first, from every date; then the trips copied on the
//           header's day, greyed with who and when.
//   RIGHT — the selected trip: number, counts, ONE button, and the full
//           OBD / invoice / ship-to / route / vol table.
//
// 🔴 THE BUTTON COPIES AND RECORDS IN ONE PRESS. The numbers go on the clipboard
// first, then the server is told exactly which numbers — it records only if they
// are still the trip's copy set (lib/billing/print.ts). A finished trip keeps a
// plain Copy that records nothing. Ctrl+C does whatever the button does.
//
// 🔴 NEVER A PARTIAL SET. Until every non-held bill has an invoice number the
// button is greyed with the count as its reason, and the bills still waiting are
// marked in the table. Held bills are shown, marked, and never copied.
//
// Table constants are Picking's (billing-picking-tab.tsx), so the two tabs read
// alike. TEAL is the primary Copy and the live dot only (CLAUDE_UI §1/§10).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useBillingPrintMarkerSubscription,
  useBillingPrintMarkerPause,
} from "@/components/billing/billing-marker-provider";
import { toast } from "sonner";
import { getTodayIST } from "@/lib/dates";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import type { PrintTrip } from "@/lib/billing/print";
import { GiftBadge } from "@/components/floor/gift-badge";

const LIST_URL = "/api/billing/print/list";

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_C = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "border-b border-[#f0f0f0] px-3.5 py-2 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
const TD_C = "border-b border-[#f0f0f0] px-1 py-2 text-center text-[11px] text-[#9ca3af]";

// # 5 · OBD 17 · Invoice no 21 · Ship to 31 · Route 16 · Vol 10 = 100
const WIDTHS = [5, 17, 21, 31, 16, 10];

const PRIMARY =
  "inline-flex h-[32px] items-center rounded-md bg-brand-600 px-[15px] text-[12px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400";
const PLAIN =
  "inline-flex h-[32px] items-center rounded-md border border-gray-300 bg-white px-[13px] text-[12px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

interface PrintList {
  pending: PrintTrip[];
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

/** "1 new invoice no" / "8 invoice nos". */
function nosLabel(n: number, isNew: boolean): string {
  return `${n} ${isNew ? "new " : ""}invoice no${n === 1 ? "" : "s"}`;
}

/** What the header button will do for this trip and this viewer. One place, used by the button AND Ctrl+C. */
function copyPlan(trip: PrintTrip, canEdit: boolean): {
  label: string;
  numbers: string[];
  records: boolean;
  enabled: boolean;
  primary: boolean;
  reason: string | null;
} {
  if (trip.state === "copied" || !canEdit) {
    // Plain Copy: the whole set, recorded nowhere.
    return {
      label: "Copy",
      numbers: trip.invoiceNos,
      records: false,
      enabled: trip.ready && trip.invoiceNos.length > 0,
      primary: false,
      reason: !trip.ready ? readinessReason(trip) : null,
    };
  }
  const isNew = trip.state === "reopened";
  if (!trip.ready || trip.copySet.length === 0) {
    return {
      label: isNew ? "Copy new invoice nos" : "Copy invoice nos",
      numbers: [],
      records: false,
      enabled: false,
      primary: true,
      reason: readinessReason(trip),
    };
  }
  return {
    label: `Copy ${nosLabel(trip.copySet.length, isNew)}`,
    numbers: trip.copySet,
    records: true,
    enabled: true,
    primary: true,
    reason: null,
  };
}

/** The Ctrl+C toast on a trip that cannot be copied — "3 bills have no invoice number yet". */
function shortcutRefusal(trip: PrintTrip): string {
  if (trip.eligible === 0) {
    return trip.held > 0 ? `${trip.tripNumber}: every bill is on hold — nothing to copy` : `${trip.tripNumber} has no bills to copy`;
  }
  const missing = trip.eligible - trip.invoiced;
  return `${missing} bill${missing === 1 ? " has" : "s have"} no invoice number yet`;
}

function readinessReason(trip: PrintTrip): string {
  if (trip.eligible === 0) return trip.held > 0 ? "Every bill is on hold" : "No bills to copy";
  return `${trip.invoiced} of ${trip.eligible} invoiced`;
}

export function BillingPrintTab({
  date,
  canEdit = false,
  railSlot = null,
}: {
  date?: string;
  /**
   * The page's 320px left-column slot (review-view.tsx), where the trip list is
   * drawn. Null → no list is drawn; ReviewView always provides it on the billing
   * face, mounted before this tab can be opened.
   */
  railSlot?: HTMLElement | null;
  /**
   * Does this viewer hold `billing_print`/canEdit? FALSE → the button is a plain
   * Copy that records nothing. ⚠ NOT AUTHORISATION — the copy route re-checks.
   */
  canEdit?: boolean;
}) {
  const [data, setData] = useState<PrintList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const reqRef = useRef(0);

  const isToday = !date || date === getTodayIST();

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
  // No refetch under a copy in flight — the list would move under the press.
  useBillingPrintMarkerPause("print-tab-copy", busy);

  const pending = useMemo(() => data?.pending ?? [], [data]);
  const copied = useMemo(() => data?.copied ?? [], [data]);

  // The selection is an id, so it survives a refetch; if its trip left both
  // lists, fall back to the first card rather than showing nothing.
  const selected = useMemo(() => {
    const all = [...pending, ...copied];
    return all.find((t) => t.id === selectedId) ?? all[0] ?? null;
  }, [pending, copied, selectedId]);

  const plan = selected ? copyPlan(selected, canEdit) : null;

  const runCopy = useCallback(async () => {
    if (!selected || !plan || !plan.enabled || busy) return;
    setNotice(null);
    try {
      await navigator.clipboard.writeText(plan.numbers.join("\n"));
    } catch {
      setNotice({ tone: "error", text: "Couldn't reach the clipboard — copy blocked by the browser. Nothing was recorded." });
      return;
    }
    setCopiedFlash(true);
    window.setTimeout(() => setCopiedFlash(false), 1600);
    if (!plan.records) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/billing/print/trip/${selected.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceNos: plan.numbers }),
      });
      const body = (await res.json().catch(() => ({}))) as { changed?: boolean; error?: string };
      if (!res.ok) {
        setNotice({ tone: "error", text: body.error ?? `Not recorded (HTTP ${res.status}).` });
      } else if (!body.changed) {
        setNotice({ tone: "info", text: `${selected.tripNumber} had already been copied — nothing new recorded.` });
      }
    } catch {
      setNotice({ tone: "error", text: "Copied, but could not reach the server — the copy was NOT recorded. Press Copy again." });
    } finally {
      setBusy(false);
    }
    await load();
  }, [selected, plan, busy, load]);

  // Ctrl+C — the same action as the button, nothing else. Mounted only while
  // this tab is on screen; the Orders tab's smart copy stands down on every
  // other tab (mail-orders-page.tsx onCtrlKey), so the two never both answer.
  // A text selection or a focused field keeps the browser's own copy.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c" || e.shiftKey || e.altKey) return;
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((window.getSelection()?.toString() ?? "").length > 0) return;
      if (!selected || !plan) return;
      // 🔴 NEVER SILENT (owner). A greyed button explains itself with its
      // caption; a shortcut that does nothing reads as a broken shortcut. So a
      // press on a trip that cannot be copied says WHY, briefly.
      if (!plan.enabled) {
        e.preventDefault();
        e.stopPropagation();
        // One toast per press — a held key's auto-repeat must not stack them.
        if (!e.repeat) toast.info(shortcutRefusal(selected));
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void runCopy();
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, [selected, plan, runCopy]);

  // ── Rail ───────────────────────────────────────────────────────────────
  // 🔴 DRAWN INTO THE PAGE'S LEFT COLUMN, NOT BESIDE THE DETAIL (owner). On
  // Orders and Picking the page is [320px inbox rail][right pane]; drawn in here
  // this list pushed the tab bar 320px left on Print and back on leaving it.
  // ReviewView owns a 320px slot with the inbox rail's exact classes (width,
  // border) and hands it over as `railSlot`; this list is portalled into it, so
  // its state, selection and copy wiring stay in this one component and only
  // its DOM moves. No width, border or tint of its own — the slot owns those.
  const rail = (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The inbox rail head's classes, exactly (review-view.tsx: px-3 py-2
          border-b around an h-[28px] row), so the two bottom borders land on
          the same line — only one is ever on screen, and a few pixels of
          difference would read as the page moving. */}
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="flex h-[28px] items-center gap-2">
          <span className="text-[12.5px] font-bold text-gray-800">
            {loading ? "Loading…" : `${plural(pending.length, "trip")} to copy`}
          </span>
          {/* The header date moves the Copied section, NEVER this list (owner) —
              without the note, stepping back a day looks like a stuck screen. */}
          {!loading && <span className="-ml-1 text-[11px] text-gray-400">· any date</span>}
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-ok-text">
            <span className="h-[7px] w-[7px] rounded-full bg-ok ring-[3px] ring-ok/15" />
            live
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error ? (
            <div className="px-2 py-8 text-center text-[11.5px] text-gray-400">Couldn&rsquo;t load. {error}</div>
          ) : loading ? null : (
            <>
              {pending.length === 0 && (
                <div className="px-2 py-6 text-center text-[11.5px] text-gray-400">
                  No trip is waiting to be copied.
                </div>
              )}
              {pending.map((t) => (
                <TripCard key={t.id} trip={t} active={selected?.id === t.id} onSelect={() => setSelectedId(t.id)} />
              ))}
              <div className="mb-1.5 mt-3 px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
                {isToday ? "Copied today" : `Copied · ${formatDayLabel(date!)}`} · {copied.length}
              </div>
              {copied.length === 0 && (
                <div className="px-2 py-3 text-[11px] text-gray-400">
                  {isToday ? "Nothing copied yet today." : "Nothing copied on this day."}
                </div>
              )}
              {copied.map((t) => (
                <TripCard key={t.id} trip={t} active={selected?.id === t.id} onSelect={() => setSelectedId(t.id)} />
              ))}
            </>
          )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-white">
      {railSlot ? createPortal(rail, railSlot) : null}

      {/* ── Detail ───────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected || !plan ? (
          <div className="px-5 py-14 text-center">
            {!loading && !error && (
              <>
                <div className="text-[28px] leading-none text-gray-300">○</div>
                <h4 className="mt-2 text-[13px] font-semibold text-gray-900">No trips sent to billing</h4>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
                  A trip appears here when the planner presses Send to billing on the floor.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 border-b border-gray-200 px-[18px] pb-3 pt-3.5">
              <div className="min-w-0">
                <span className="rounded-[6px] bg-gray-900 px-2.5 py-[3px] font-mono text-[12px] font-semibold tracking-[0.02em] text-white">
                  {selected.tripNumber}
                </span>
                {/* No counts line here (owner): the selected card beside it
                    already says bills · stops · litres. */}
                <div className="mt-2 text-[11.5px] text-gray-500">
                  <ReadinessText trip={selected} />
                </div>
              </div>
              <div className="ml-auto flex flex-col items-end">
                <button
                  type="button"
                  onClick={() => void runCopy()}
                  disabled={!plan.enabled || busy}
                  className={plan.primary ? PRIMARY : PLAIN}
                >
                  {busy ? "Recording…" : copiedFlash ? "Copied" : plan.label}
                </button>
                <span className="mt-1 text-right text-[10.5px] text-gray-400">
                  <CaptionText trip={selected} plan={plan} />
                </span>
              </div>
            </div>

            {notice && (
              <div
                className={`border-b px-[18px] py-2 text-[11.5px] ${
                  notice.tone === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {notice.text}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {selected.rows.length === 0 ? (
                <div className="px-5 py-10 text-center text-[11.5px] text-gray-400">No bills on this trip.</div>
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
                      <th className={HEAD_TH}>Route</th>
                      <th className={HEAD_TH}>Vol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rows.map((r, i) => {
                      const awaiting = !r.held && r.invoiceNo === null;
                      // The edge marks the row that needs attention: amber for a
                      // missing number (this is what blocks the copy), slate for
                      // a hold (a decision, not a fault — Floor's hold colour).
                      const edge = awaiting
                        ? "border-l-[3px] border-l-[#f59e0b]"
                        : r.held
                          ? "border-l-[3px] border-l-[#94a3b8]"
                          : "border-l-[3px] border-l-transparent";
                      const dim = r.held ? " !text-gray-400" : "";
                      return (
                        <tr key={r.orderId} className={awaiting ? "bg-amber-50/40" : ""}>
                          <td className={`${TD_C} ${edge}`}>{i + 1}</td>
                          <td className={`${TD} font-mono${dim}`}>{r.obdNumber}</td>
                          <td className={`${TD}${dim}`}>
                            {r.held ? (
                              <>
                                {r.invoiceNo && <span className="mr-1.5 font-mono">{r.invoiceNo}</span>}
                                <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600">
                                  On hold · not copied
                                </span>
                              </>
                            ) : r.invoiceNo ? (
                              <>
                                <span className="font-mono font-semibold text-gray-900">{r.invoiceNo}</span>
                                {r.isNew && (
                                  <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-px text-[10px] font-bold text-brand-700">
                                    new
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="font-semibold text-[#b45309]">awaiting invoice no</span>
                            )}
                          </td>
                          <td className={`${TD}${dim}`} title={r.shipToName ?? undefined}>
                            {r.shipToName ? smartTitleCase(r.shipToName) : "—"}
                            {/* GIFT — SAP material type GIFTS; Floor's own pill. */}
                            {r.isGift && (
                              <span className="ml-1.5 inline-block align-[-1px]">
                                <GiftBadge />
                              </span>
                            )}
                          </td>
                          <td className={`${TD}${dim}`}>{r.routeName ?? "—"}</td>
                          {/* A GIFT's litres are left out of the trip total above —
                              shown, but muted to ink-400 so they read as not counted. */}
                          <td
                            className={`${TD} tabular-nums${r.isGift && !r.held ? " !text-ink-400" : dim}`}
                            title={r.isGift ? "Gift — not counted in L / kg" : undefined}
                          >
                            {r.litres > 0 ? `${Math.round(r.litres).toLocaleString("en-US")} L` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "8 of 8 invoiced · ready" — and, on a copied trip, when and by whom. */
function ReadinessText({ trip }: { trip: PrintTrip }) {
  const counted =
    trip.eligible === 0 ? (trip.held > 0 ? "every bill on hold" : "no bills") : `${trip.invoiced} of ${trip.eligible} invoiced`;
  return (
    <>
      <span className={trip.ready ? "font-semibold text-ok-text" : "font-semibold text-[#b45309]"}>
        {counted}
        {trip.ready ? " · ready" : ""}
      </span>
      {/* Moved here from the deleted counts line, so a hold is still said out loud. */}
      {trip.held > 0 && <span className="text-[#475569]"> · {trip.held} on hold, not copied</span>}
      {trip.billingCopiedAt && (
        <span>
          {" "}
          · copied {hhmm(trip.billingCopiedAt)}
          {trip.billingCopiedByName ? ` by ${firstName(trip.billingCopiedByName)}` : ""}
        </span>
      )}
    </>
  );
}

/** Under the button: why it is greyed, or that bills share numbers, or who copied. */
function CaptionText({ trip, plan }: { trip: PrintTrip; plan: ReturnType<typeof copyPlan> }) {
  if (plan.reason) return <>{plan.reason}</>;
  const bits: string[] = [];
  // Bills behind the numbers this press copies. More bills than numbers means
  // some bills share one — said out loud, so "8" next to 9 bills is not a mystery.
  const billsBehind = plan.records ? trip.copyBillCount : trip.eligible;
  if (billsBehind > plan.numbers.length) {
    bits.push(`${plural(billsBehind, "bill")} · ${plural(plan.numbers.length, "invoice no")}`);
  }
  if (!plan.records && trip.state === "copied") bits.push("copies again, records nothing");
  return <>{bits.join(" · ")}</>;
}

function TripCard({ trip, active, onSelect }: { trip: PrintTrip; active: boolean; onSelect: () => void }) {
  const done = trip.state === "copied";
  const newCount = trip.state === "reopened" ? trip.copySet.length : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-1.5 block w-full rounded-[8px] border px-3 py-2.5 text-left transition-colors ${
        active ? "border-gray-900 bg-white shadow-sm" : "border-gray-200 bg-white hover:border-gray-300"
      } ${done && !active ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2">
        {/* TRIP NUMBER ONLY — never the vehicle number (owner). */}
        <span className="font-mono text-[12px] font-semibold text-gray-900">{trip.tripNumber}</span>
        {!done && (
          <span
            className={`ml-auto rounded-full px-2 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.06em] ${
              trip.ready ? "bg-ok/15 text-ok-text" : "bg-amber-100 text-[#b45309]"
            }`}
          >
            {trip.ready ? "ready" : `${trip.invoiced}/${trip.eligible}`}
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] tabular-nums text-gray-500">
        {plural(trip.bills, "bill")} · {plural(trip.stops, "stop")} · {Math.round(trip.litres).toLocaleString("en-US")} L
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500">
        {trip.eligible === 0 ? (
          trip.held > 0 ? "every bill on hold" : "no bills"
        ) : (
          <>
            {trip.invoiced} of {trip.eligible} invoiced
            {trip.held > 0 ? ` · ${trip.held} on hold` : ""}
          </>
        )}
      </div>
      {trip.billingCopiedAt && (
        <div className={`mt-0.5 text-[11px] ${done ? "text-gray-400" : "font-semibold text-brand-700"}`}>
          {done
            ? `Copied ${hhmm(trip.billingCopiedAt)}${trip.billingCopiedByName ? ` · ${firstName(trip.billingCopiedByName)}` : ""}`
            : `copied ${hhmm(trip.billingCopiedAt)}${
                newCount > 0 ? ` · ${newCount} new since` : ` · ${trip.eligible - trip.invoiced} awaiting invoice no`
              }`}
        </div>
      )}
    </button>
  );
}
