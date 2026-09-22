"use client";

// Billing v2 — the "Telephonic" tab (2026-09-22).
//
// A telephonic order has no mail order, so nothing tells OrbitOMS to hold it or
// that it is a bill-only (CI) order. Billing types the SO number here straight
// after punching it in SAP — Hold or CI — and the import applies the tag when
// the OBD lands (lib/billing/telephonic-apply.ts). Design:
// docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md §3.
//
//   ENTRY BAR — SO number · Hold | CI · Add. canEdit only; hidden otherwise
//               (hide, never disable — CLAUDE_UI §10).
//   TABLE     — two bands in ONE fixed table: "Waiting for OBD — all dates"
//               (never month-fenced), then the picked month's settled rows.
//               One row per BILL: an SO that hit several OBDs gets one row
//               each, tag cells on the first row only, because each bill can
//               differ (one held, one released, one with its CI refused).
//
// 🔴 EVERYTHING ON A BILL IS READ LIVE — dispatchStatus, invoiceNo, the CI — so
// a bill Floor released, or one whose hold failed, reads as what it is now.
//
// The SO rule is lib/billing/telephonic-so.ts, the SAME function the add route
// validates with. The route re-checks everything; this only decides what is
// drawn and when Add is live.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import {
  useBillingTelephonicMarkerSubscription,
  useBillingTelephonicMarkerPause,
} from "@/components/billing/billing-marker-provider";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { currentIstMonth, normaliseSoNumber } from "@/lib/billing/telephonic-so";
import type { TelephonicBill, TelephonicList, TelephonicRow } from "@/lib/billing/telephonic";

const LIST_URL = "/api/billing/telephonic/list";
const ADD_URL = "/api/billing/telephonic/add";
const REMOVE_URL = "/api/billing/telephonic/remove";

type TagKind = "hold" | "ci";

// Fixed table standard (CLAUDE_UI §27): 32px header, 36px rows, 10px uppercase
// header, 11px data. Constants shaped like the Print tab's.
const HEAD_TH = "h-[32px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af] whitespace-nowrap overflow-hidden text-ellipsis";
const HEAD_TH_C = "h-[32px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "h-[36px] border-b border-[#f0f0f0] px-3.5 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
const TD_C = "h-[36px] border-b border-[#f0f0f0] px-1 text-center text-[11px] text-[#9ca3af]";

// # 3 · SO Number 10 · Tag 6 · Customer / OBD 20 · Invoice No 10 · Status 11 ·
// CI No. 13 · CI Status 10 · Added by 9 · Added 5 · × 3 = 100
const WIDTHS = [3, 10, 6, 20, 10, 11, 13, 10, 9, 5, 3];

// 🔴 TAG COLOURS. Hold = the `danger` token (a thing being stopped — CLAUDE_UI
// §1/§3). CI = the neutral `ink` family: clearly not Hold's red, and NOT brand
// violet, which means action. Every `data.*` colour is an identity already
// spoken for, and `tint` belongs to tinting only.
const TAG_CHIP: Record<TagKind, string> = {
  hold: "border border-danger-bd bg-danger-bg text-danger-text",
  ci: "border border-ink-200 bg-ink-100 text-ink-700",
};

const PILL = "inline-block rounded px-1.5 py-px text-[10px] font-semibold";

/** Reasons the tag was deliberately not applied — shown as the Status itself. */
const NOT_APPLIED_REASONS = new Set(["bill cancelled", "already dispatched", "bill removed"]);

function tagLabel(tag: string): string {
  return tag === "ci" ? "CI" : "Hold";
}

function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

function istDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00+05:30`).toLocaleDateString("en-GB", {
    month: "long", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── The month picker (tab row, replaces the date stepper on this tab) ───────

/**
 * ‹ September 2026 › — the same chrome as HeaderDateStepper, stepping whole IST
 * months. The right arrow is disabled at the current IST month.
 */
export function TelephonicMonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  const atCurrent = month >= currentIstMonth(new Date());
  return (
    <div className="inline-flex items-center gap-0">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
        className="cursor-pointer rounded-l-[4px] border border-gray-200 px-[6px] py-[3px] text-[10px] text-gray-400 hover:bg-gray-50"
      >
        <ChevronLeft size={12} />
      </button>
      <span className="inline-flex items-center border-b border-t border-gray-200 px-[10px] py-[3px] text-[10px] font-medium text-gray-900">
        {monthLabel(month)}
      </span>
      <button
        type="button"
        aria-label="Next month"
        onClick={() => !atCurrent && onChange(shiftMonth(month, 1))}
        className={`rounded-r-[4px] border border-gray-200 px-[6px] py-[3px] text-[10px] text-gray-400 ${
          atCurrent ? "pointer-events-none cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-gray-50"
        }`}
      >
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

// ── Status, per bill, from LIVE data — first match wins ─────────────────────

function BillStatus({ row, bill }: { row: TelephonicRow; bill: TelephonicBill | null }) {
  // No bill yet: the tag's own state is the whole story.
  if (bill === null) {
    return row.state === "expired" ? (
      <span className={`${PILL} bg-gray-100 text-gray-400`}>Expired</span>
    ) : (
      <span className={`${PILL} bg-warn-bg text-warn-text`}>Waiting</span>
    );
  }
  if (bill.ciSkipReason === "hold failed") {
    return <span className={`${PILL} bg-danger text-white`}>Not held</span>;
  }
  if (bill.ciSkipReason !== null && NOT_APPLIED_REASONS.has(bill.ciSkipReason)) {
    return <span className={`${PILL} bg-gray-100 text-gray-500`}>{bill.ciSkipReason}</span>;
  }
  if (bill.dispatchStatus === "hold") {
    return <span className={`${PILL} bg-ok-bg text-ok-text`}>Held</span>;
  }
  // Held on import, then a person released it on Floor.
  return <span className={`${PILL} border border-gray-200 bg-white text-gray-600`}>Released</span>;
}

/** The CI No. and CI Status cells (CI tags only). */
function CiCells({ row, bill, muted }: { row: TelephonicRow; bill: TelephonicBill | null; muted: string }) {
  const dash = <span className="text-gray-300">—</span>;
  if (row.tag !== "ci" || bill === null) {
    return (
      <>
        <td className={`${TD}${muted}`}>{dash}</td>
        <td className={`${TD}${muted}`}>{dash}</td>
      </>
    );
  }
  if (bill.ci !== null) {
    const closed = bill.ci.status === "closed";
    return (
      <>
        <td className={`${TD} leading-tight${muted}`}>
          {/* Plain link: /ci cannot open one CI by URL today. */}
          <a href="/ci" className="font-mono text-gray-800 hover:underline">
            {bill.ci.ciNumber ?? "—"}
          </a>
          {closed && bill.ci.sapCiNumber && (
            <div className="font-mono text-[10px] text-gray-400">{bill.ci.sapCiNumber}</div>
          )}
        </td>
        <td className={`${TD}${muted}`}>
          {closed ? (
            <span className={`${PILL} bg-ok-bg text-ok-text`}>Closed</span>
          ) : bill.ci.status === "submitted" ? (
            <span className={`${PILL} bg-warn-bg text-warn-text`}>Submitted</span>
          ) : (
            <span className={`${PILL} bg-gray-100 text-gray-500`}>{bill.ci.status}</span>
          )}
        </td>
      </>
    );
  }
  const reason = bill.ciSkipReason;
  if (reason !== null && reason !== "hold failed" && !NOT_APPLIED_REASONS.has(reason)) {
    return (
      <>
        <td className={`${TD}${muted}`} title={reason}>
          <span className="font-semibold text-danger-text">Couldn&apos;t raise — do by hand</span>
        </td>
        <td className={`${TD}${muted}`}>{dash}</td>
      </>
    );
  }
  return (
    <>
      <td className={`${TD}${muted}`}>{dash}</td>
      <td className={`${TD}${muted}`}>{dash}</td>
    </>
  );
}

// ── The tab body ─────────────────────────────────────────────────────────────

export function BillingTelephonicTab({ month, canEdit = false }: { month: string; canEdit?: boolean }) {
  const [data, setData] = useState<TelephonicList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soInput, setSoInput] = useState("");
  // No tag preselected on first load; after an add it STAYS selected.
  const [tag, setTag] = useState<TagKind | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqRef = useRef(0);

  const load = useCallback(async (): Promise<TelephonicList | null> => {
    const seq = ++reqRef.current;
    try {
      const res = await fetch(`${LIST_URL}?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      if (!res.ok) {
        if (seq === reqRef.current) setError(`HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as TelephonicList;
      if (seq !== reqRef.current) return null;
      setData(body);
      setError(null);
      return body;
    } catch {
      if (seq === reqRef.current) setError("Could not reach the server.");
      return null;
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  useBillingTelephonicMarkerSubscription(load);
  // No refetch while the operator is typing an SO or a write is in flight — the
  // table must not move under the box.
  useBillingTelephonicMarkerPause("telephonic-entry", soInput.trim() !== "" || busy);

  const normalised = normaliseSoNumber(soInput);
  const canAdd = canEdit && normalised !== null && tag !== null && !busy;

  const submit = useCallback(async () => {
    if (!canEdit || normalised === null || tag === null || busy) return;
    setBusy(true);
    setFieldError(null);
    try {
      const res = await fetch(ADD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soNumber: soInput, tag }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        existingTag?: string;
        addedByName?: string | null;
        addedAt?: string;
        tag?: { id: number; soNumber: string };
        applied?: { held: number; ciRaised: number; ciSkipped: number; recordOnly: number; errors: number } | null;
      };
      if (res.status === 409) {
        setFieldError(
          `Already on the list as ${tagLabel(body.existingTag ?? "")}, added by ${body.addedByName ?? "someone"}` +
            `${body.addedAt ? ` at ${istDay(body.addedAt)} ${istTime(body.addedAt)}` : ""}. Remove it first to change the tag.`,
        );
        return;
      }
      if (!res.ok) {
        setFieldError(body.error ?? `Could not add (HTTP ${res.status}).`);
        return;
      }
      // Added. Box clears and keeps focus; the tag stays selected.
      setSoInput("");
      const fresh = await load();
      if (body.applied && body.tag) {
        // The bill was already here — say what happened to it.
        const row = [...(fresh?.waiting ?? []), ...(fresh?.month ?? [])].find((r) => r.id === body.tag!.id);
        const parts = (row?.bills ?? []).map((b) => {
          if (b.ciSkipReason) return `${b.obdNumber}: ${b.ciSkipReason}`;
          if (b.ci) return `${b.obdNumber}: held, ${b.ci.ciNumber ?? "CI"} raised`;
          return `${b.obdNumber}: held`;
        });
        if (body.applied.errors > 0) {
          toast.error(`SO ${body.tag.soNumber}: the bill is here but the tag could not be applied.`);
        } else if (parts.length > 0) {
          toast.success(`SO ${body.tag.soNumber} — ${parts.join(" · ")}`);
        }
      }
    } catch {
      setFieldError("Could not reach the server.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [canEdit, normalised, tag, busy, soInput, load]);

  const remove = useCallback(
    async (id: number) => {
      setBusy(true);
      try {
        const res = await fetch(REMOVE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error ?? `Could not remove (HTTP ${res.status}).`);
        }
        await load();
      } catch {
        toast.error("Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const waiting = useMemo(() => data?.waiting ?? [], [data]);
  const monthRows = useMemo(() => data?.month ?? [], [data]);
  const empty = !loading && !error && waiting.length === 0 && monthRows.length === 0;

  function renderRows(rows: TelephonicRow[], startAt: number) {
    return rows.flatMap((row, ri) => {
      const bills: (TelephonicBill | null)[] = row.bills.length > 0 ? row.bills : [null];
      const isWaiting = row.state === "waiting";
      const muted = row.state === "expired" ? " !text-gray-400" : "";
      const edge = isWaiting ? "border-l-[3px] border-l-warn" : "border-l-[3px] border-l-transparent";
      const showX = canEdit && (row.state === "waiting" || row.state === "expired");
      return bills.map((bill, bi) => {
        const first = bi === 0;
        const invoice = bill?.invoiceNo ?? null;
        return (
          <tr key={`${row.id}-${bill?.orderId ?? "none"}`}>
            <td className={`${TD_C} ${edge}`}>{first ? startAt + ri : ""}</td>
            <td className={`${TD} font-mono text-gray-800${muted}`}>{first ? row.soNumber : ""}</td>
            <td className={TD}>
              {first && (
                <span className={`${PILL} ${TAG_CHIP[row.tag === "ci" ? "ci" : "hold"]}`}>{tagLabel(row.tag)}</span>
              )}
            </td>
            <td className={`${TD} leading-tight${muted}`}>
              {bill === null ? (
                <span className="text-gray-300">—</span>
              ) : (
                <>
                  <div className="overflow-hidden text-ellipsis font-medium text-[#111827]">
                    {bill.customerName ? smartTitleCase(bill.customerName) : "—"}
                  </div>
                  <div className="font-mono text-[10px] text-gray-400">{bill.obdNumber}</div>
                </>
              )}
            </td>
            <td className={`${TD}${muted}`}>
              {invoice !== null ? (
                <span className="font-mono">{invoice}</span>
              ) : bill !== null && row.tag === "ci" ? (
                <span className="text-gray-400">awaiting SAP</span>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </td>
            <td className={TD}>
              <BillStatus row={row} bill={bill} />
            </td>
            <CiCells row={row} bill={bill} muted={muted} />
            <td className={`${TD}${muted}`}>{first ? (row.addedByName ?? "—") : ""}</td>
            <td className={`${TD} !text-gray-400`} title={first ? `${istDay(row.addedAt)} ${istTime(row.addedAt)}` : undefined}>
              {first ? istDay(row.addedAt) : ""}
            </td>
            <td className={TD_C}>
              {first && showX && (
                <button
                  type="button"
                  aria-label={`Remove SO ${row.soNumber}`}
                  disabled={busy}
                  onClick={() => void remove(row.id)}
                  className="inline-flex h-[20px] w-[20px] items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X size={12} />
                </button>
              )}
            </td>
          </tr>
        );
      });
    });
  }

  function band(label: string) {
    return (
      <tr>
        <td
          colSpan={WIDTHS.length}
          className="h-[28px] border-b border-[#ebebeb] bg-gray-50 px-3.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-500"
        >
          {label}
        </td>
      </tr>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      {canEdit && (
        <form
          className="flex flex-shrink-0 items-start gap-2 border-b border-gray-200 px-[18px] py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="w-[220px]">
            <input
              ref={inputRef}
              value={soInput}
              onChange={(e) => {
                setSoInput(e.target.value);
                if (fieldError) setFieldError(null);
              }}
              placeholder="SO number"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className={`h-[32px] w-full rounded-md border px-3 font-mono text-[13px] text-gray-900 outline-none placeholder:font-sans placeholder:text-gray-300 focus:ring-2 ${
                fieldError
                  ? "border-danger focus:ring-danger/10"
                  : "border-gray-200 focus:border-brand-500 focus:ring-brand-500/10"
              }`}
            />
            {fieldError && <p className="mt-1 text-[11px] leading-snug text-danger-text">{fieldError}</p>}
          </div>
          <div className="inline-flex h-[32px] overflow-hidden rounded-md border border-gray-200" role="radiogroup">
            {(["hold", "ci"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={tag === k}
                onClick={() => setTag(k)}
                className={`px-3 text-[12px] font-semibold transition-colors ${
                  tag === k ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                {tagLabel(k)}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={!canAdd}
            className={`inline-flex h-[32px] items-center rounded-md border px-[15px] text-[12px] font-semibold transition-colors ${
              canAdd
                ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700"
                : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
            }`}
          >
            Add
          </button>
        </form>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && !data ? (
          <div className="px-5 py-10 text-center text-[11.5px] text-gray-400">Could not load the list ({error}).</div>
        ) : empty ? (
          <div className="px-5 py-14 text-center">
            <div className="text-[28px] leading-none text-gray-300">○</div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Nothing recorded yet</h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
              Type an SO number as soon as you punch a phone order in SAP. It is matched when its delivery arrives.
            </p>
          </div>
        ) : data ? (
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              {WIDTHS.map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={HEAD_TH_C}>#</th>
                <th className={HEAD_TH}>SO Number</th>
                <th className={HEAD_TH}>Tag</th>
                <th className={HEAD_TH}>Customer / OBD</th>
                <th className={HEAD_TH}>Invoice No</th>
                <th className={HEAD_TH}>Status</th>
                <th className={HEAD_TH}>CI No.</th>
                <th className={HEAD_TH}>CI Status</th>
                <th className={HEAD_TH}>Added by</th>
                <th className={HEAD_TH}>Added</th>
                <th className={HEAD_TH_C} aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {waiting.length > 0 && band("Waiting for OBD — all dates")}
              {renderRows(waiting, 1)}
              {monthRows.length > 0 && band(monthLabel(month))}
              {renderRows(monthRows, waiting.length + 1)}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
