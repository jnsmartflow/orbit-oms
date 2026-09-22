"use client";

// Floor Control — the Cancel / Raise CI form (floor-bulk-actions v5, states 3-5;
// owner decisions 2026-09-22). ONE form, two tabs, for every way a bill is taken
// off the floor:
//
//   Raise CI — the DEFAULT tab, every time. A full-bill CI per bill lands on the
//              billing CI desk, and the bill leaves the floor. POST /api/floor/ci.
//   Cancel   — the bill stops here, restorable from the Cancel & CI tab.
//              POST /api/floor/actions { action: "cancel", reasonKey, remark }.
//
// Opened from the Floor bar's ··· More, the Hold bar's ··· More, and the detail
// panel's ⋯ menu (floor-page.tsx owns which bills, and what "applied" means for
// the selection it came from).
//
// 🔴 THE PRE-CHECK IS A PREVIEW, NOT THE RULE. Each bill arrives with the
// refusal offFloorRefusal() (lib/floor/off-floor.ts) gave it — the SAME function
// both routes call — so a greyed bill here is one the server would refuse. The
// server still decides: anything it refuses comes back in the result view with
// its own words. A bill the caller could not pre-check (the Hold feed carries no
// stage, trip or invoice) simply arrives with no refusal.
//
// ⚠ A MODAL OVER THE WHOLE PAGE, not just the bills column: the detail panel is
// a full-page fixed overlay (z-[110]) and this form opens from it too, so it
// sits above it — the pdf-preview.tsx pattern (fixed, bg-black/40, z-[120]).
// The scrim covers the bottom bar, so its brand CTA is never a second one.
//
// ⚠ NO KEY LISTENER. floor-page.tsx is the single Esc owner (CLAUDE_FLOOR §4.6);
// it closes this form through `onClose`. Focus in a textarea keeps Esc inert
// there, which is the owner's existing guard.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FLOOR_CANCEL_REASON_OPTIONS, FLOOR_REMARK_MAX } from "@/lib/floor/off-floor";
import type { CancelReason } from "@/lib/picking/cancel-reasons";
import { formatLitres } from "./status-pill";
import { BAR_DANGER, BAR_PRIMARY, BAR_SECONDARY } from "./floor-action-bar";

/** One ticked bill, as the caller could describe it. */
export interface OffFloorFormBill {
  orderId: number;
  obdNumber: string;
  dealerName: string | null;
  litres: number | null;
  /** null = no invoice yet; undefined = the caller does not know (Hold feed). */
  invoiceNo?: string | null;
  /** offFloorRefusal()'s answer, or null when the bill may go (or is unknown). */
  refusal: string | null;
}

export interface CiReasonOption {
  id: number;
  label: string;
  isPinned: boolean;
  sortOrder: number;
}

type Tab = "ci" | "cancel";

interface NotDone {
  orderId: number;
  obdNumber: string;
  reason: string;
}

export function OffFloorDialog({
  bills,
  reasons,
  reasonsError,
  onApplied,
  onBusyChange,
  onClose,
}: {
  bills: OffFloorFormBill[];
  /** Active CI reasons, pinned first then sortOrder. null while loading. */
  reasons: CiReasonOption[] | null;
  reasonsError: string | null;
  /**
   * A request went through (some or all bills). The caller keeps ONLY the
   * not-done bills ticked and reloads. Called before the result view shows.
   */
  onApplied: (doneIds: number[], notDoneIds: number[]) => void;
  /** Lets floor-page's Esc refuse to close the form mid-request. */
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  // 🔴 RAISE CI IS THE DEFAULT TAB, EVERY TIME THE FORM OPENS (owner).
  const [tab, setTab] = useState<Tab>("ci");
  // Each tab keeps its own answers — switching tabs loses nothing typed.
  const [ciReasonId, setCiReasonId] = useState<number | null>(null);
  const [ciRemark, setCiRemark] = useState("");
  const [cancelReason, setCancelReason] = useState<CancelReason>(FLOOR_CANCEL_REASON_OPTIONS[0].value);
  const [cancelRemark, setCancelRemark] = useState("");
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tab: Tab; done: number; notDone: NotDone[] } | null>(null);

  const setBusy = (b: boolean) => {
    setBusyState(b);
    onBusyChange(b);
  };
  // Never leave floor-page thinking a request is in flight after unmount.
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const eligible = bills.filter((b) => b.refusal === null);
  const refused = bills.filter((b) => b.refusal !== null);
  const n = eligible.length;
  const remark = tab === "ci" ? ciRemark : cancelRemark;
  const remarkTooLong = remark.trim().length > FLOOR_REMARK_MAX;
  const canSubmit =
    !busy && n > 0 && !remarkTooLong && (tab === "ci" ? ciReasonId !== null : true);

  const obdOf = (id: number) => bills.find((b) => b.orderId === id)?.obdNumber ?? `#${id}`;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const orderIds = eligible.map((b) => b.orderId);
    const trimmed = remark.trim();
    // The pre-refused bills are part of the answer too: they were ticked and
    // did not go, for the reason already shown against them.
    const preRefused: NotDone[] = refused.map((b) => ({ orderId: b.orderId, obdNumber: b.obdNumber, reason: b.refusal ?? "" }));
    try {
      if (tab === "ci") {
        const res = await fetch("/api/floor/ci", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds, reasonId: ciReasonId, remark: trimmed === "" ? undefined : trimmed }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          raised?: Array<{ orderId: number; obdNumber: string; ciNumber: string }>;
          skipped?: Array<{ orderId: number; obdNumber: string | null; reason: string }>;
        };
        if (!Array.isArray(body.raised) || !Array.isArray(body.skipped)) {
          // The whole request failed — nothing was written. Keep everything.
          setError(body.error ?? `Could not raise the CIs — HTTP ${res.status}`);
          return;
        }
        const notDone = [
          ...body.skipped.map((s) => ({ orderId: s.orderId, obdNumber: s.obdNumber ?? obdOf(s.orderId), reason: s.reason })),
          ...preRefused,
        ];
        onApplied(body.raised.map((r) => r.orderId), notDone.map((x) => x.orderId));
        if (notDone.length === 0) {
          const k = body.raised.length;
          toast.success(k === 1 ? `${body.raised[0].ciNumber} raised · with billing` : `${k} CIs raised · with billing`);
          onClose();
          return;
        }
        setResult({ tab, done: body.raised.length, notDone });
      } else {
        const res = await fetch("/api/floor/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cancel",
            orderIds,
            reasonKey: cancelReason,
            remark: trimmed === "" ? undefined : trimmed,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          done?: number[];
          failed?: Array<{ orderId: number; error: string }>;
        };
        if (!Array.isArray(body.done) || !Array.isArray(body.failed)) {
          setError(body.error ?? `Could not cancel — HTTP ${res.status}`);
          return;
        }
        const notDone = [
          ...body.failed.map((f) => ({ orderId: f.orderId, obdNumber: obdOf(f.orderId), reason: f.error })),
          ...preRefused,
        ];
        onApplied(body.done, notDone.map((x) => x.orderId));
        if (notDone.length === 0) {
          const k = body.done.length;
          toast.success(`${k} bill${k === 1 ? "" : "s"} cancelled`);
          onClose();
          return;
        }
        setResult({ tab, done: body.done.length, notDone });
      }
    } catch {
      setError("Could not reach the server — check your connection. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const title = `Cancel or Raise CI — ${bills.length} bill${bills.length === 1 ? "" : "s"}`;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[calc(100vh-40px)] w-[600px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {result !== null ? (
          // ── The result view — some bills did not go ─────────────────────────
          <>
            <div className="overflow-y-auto px-6 py-5">
              <h3 className="text-[18px] font-bold text-ink-900">
                {result.done} done · {result.notDone.length} not done
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">
                {result.tab === "ci"
                  ? "The CIs that were raised are with billing, and those bills have left the floor."
                  : "The cancelled bills have left the floor."}{" "}
                The bills below were not changed and stay ticked.
              </p>
              <div className="mt-4 overflow-hidden rounded-[10px] border border-ink-100">
                {result.notDone.map((x) => (
                  <div key={x.orderId} className="flex items-start justify-between gap-3 border-b border-ink-50 px-3 py-2.5 text-[13px] last:border-b-0">
                    <span className="font-mono text-ink-900">{x.obdNumber}</span>
                    <span className="text-right text-ink-600">{x.reason}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2.5 border-t border-ink-100 bg-ink-25 px-6 py-3.5">
              <button type="button" autoFocus onClick={onClose} className={BAR_PRIMARY}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="overflow-y-auto px-6 py-5">
              <h3 className="text-[18px] font-bold text-ink-900">{title}</h3>

              {/* ── The two tabs — Raise CI first (owner) ───────────────────── */}
              <div className="mt-4 grid grid-cols-2 rounded-[10px] bg-ink-50 p-1">
                {(
                  [
                    { key: "ci", label: "Raise CI", hint: "Return goes to billing" },
                    { key: "cancel", label: "Cancel", hint: "Bill stops here" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setTab(t.key);
                      setError(null);
                    }}
                    disabled={busy}
                    className={`rounded-lg border px-3 py-2.5 text-left ${
                      tab === t.key ? "border-ink-200 bg-white shadow-sm" : "border-transparent hover:bg-ink-100"
                    }`}
                  >
                    <span className={`block text-[15px] font-bold ${tab === t.key ? "text-ink-900" : "text-ink-600"}`}>{t.label}</span>
                    <span className="mt-0.5 block text-[12px] text-ink-500">{t.hint}</span>
                  </button>
                ))}
              </div>

              {/* ── What it does, in one line ──────────────────────────────── */}
              <p className="mt-4 rounded-[9px] border border-ink-100 bg-ink-25 px-3 py-2.5 text-[13px] leading-relaxed text-ink-700">
                {tab === "ci"
                  ? "A CI is raised for each bill and lands on the billing CI desk. These bills also leave the floor."
                  : "These bills leave the floor and do not move ahead. You can Restore them from the Cancel & CI tab."}
              </p>

              {/* ── The bills ──────────────────────────────────────────────── */}
              <div className="mb-2 mt-4 text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-500">
                Bills · {n} of {bills.length} will go
              </div>
              <div className="overflow-hidden rounded-[10px] border border-ink-100">
                {bills.map((b) => {
                  const off = b.refusal !== null;
                  return (
                    <div
                      key={b.orderId}
                      className={`flex items-center justify-between gap-3 border-b border-ink-50 px-3 py-2 text-[13px] last:border-b-0 ${
                        off ? "text-ink-400" : "text-ink-900"
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-mono">{b.obdNumber}</span>
                        {b.dealerName && <span className={off ? "" : "text-ink-600"}> · {b.dealerName}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {off ? (
                          <span className="whitespace-nowrap rounded-[5px] bg-warn-bg px-1.5 py-0.5 text-[11px] font-semibold text-warn-text">
                            {b.refusal}
                          </span>
                        ) : (
                          tab === "ci" &&
                          b.invoiceNo === null && (
                            // SOFT — the bill still counts (CLAUDE_CI §5: never blocked).
                            <span className="whitespace-nowrap rounded-[5px] bg-ink-50 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600">
                              Invoice not in Orbit yet — fills in when SAP sends it
                            </span>
                          )
                        )}
                        {b.litres !== null && (
                          <span className="whitespace-nowrap tabular-nums text-ink-500">{formatLitres(b.litres)} L</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ── The reason ─────────────────────────────────────────────── */}
              <div className="mb-2 mt-4 text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-500">
                {tab === "ci" ? "CI reason" : "Cancel reason"} <span className="text-danger-text">*</span>
              </div>
              {tab === "ci" ? (
                reasons === null ? (
                  <div className="text-[13px] text-ink-500">{reasonsError ?? "Loading reasons…"}</div>
                ) : reasons.length === 0 ? (
                  <div className="text-[13px] text-ink-500">No active CI reasons — nothing can be raised.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {reasons.map((r) => (
                      <ReasonTile
                        key={r.id}
                        name="ci-reason"
                        label={r.label}
                        checked={ciReasonId === r.id}
                        disabled={busy}
                        onPick={() => setCiReasonId(r.id)}
                      />
                    ))}
                  </div>
                )
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {FLOOR_CANCEL_REASON_OPTIONS.map((o) => (
                    <ReasonTile
                      key={o.value}
                      name="cancel-reason"
                      label={o.label}
                      checked={cancelReason === o.value}
                      disabled={busy}
                      onPick={() => setCancelReason(o.value)}
                    />
                  ))}
                </div>
              )}

              {/* ── Remarks — one per tab ──────────────────────────────────── */}
              <textarea
                value={remark}
                onChange={(e) => (tab === "ci" ? setCiRemark(e.target.value) : setCancelRemark(e.target.value))}
                disabled={busy}
                placeholder={tab === "ci" ? "Remarks for billing (optional)" : "Remarks (optional)"}
                className="mt-3 h-[62px] w-full resize-none rounded-[9px] border border-ink-200 px-3 py-2.5 text-[13.5px] text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10"
              />
              <div className="mt-1 flex items-start justify-between gap-3 text-[12px] text-ink-500">
                <span>
                  {tab === "ci" && (
                    <>
                      Filled in for you: <b className="font-semibold text-ink-700">Full bill</b> ·{" "}
                      <b className="font-semibold text-ink-700">Goods in depot</b> ·{" "}
                      <b className="font-semibold text-ink-700">Received today</b>
                    </>
                  )}
                </span>
                <span className={`tabular-nums ${remarkTooLong ? "text-danger-text" : ""}`}>
                  {remark.trim().length}/{FLOOR_REMARK_MAX}
                </span>
              </div>

              {error && (
                <div className="mt-3 rounded-[9px] border border-danger-bd bg-danger-bg px-3 py-2.5 text-[13px] text-danger-text">
                  {error}
                </div>
              )}
            </div>

            {/* ── Footer — Back gets the first focus, so Esc works at once ──── */}
            <div className="flex items-center justify-end gap-2.5 border-t border-ink-100 bg-ink-25 px-6 py-3.5">
              <button type="button" autoFocus onClick={onClose} disabled={busy} className={BAR_SECONDARY}>
                Back
              </button>
              {tab === "ci" ? (
                <button type="button" onClick={() => void submit()} disabled={!canSubmit} className={BAR_PRIMARY}>
                  {busy ? "Raising…" : `Raise ${n} CI${n === 1 ? "" : "s"}`}
                </button>
              ) : (
                <button type="button" onClick={() => void submit()} disabled={!canSubmit} className={BAR_DANGER}>
                  {busy ? "Cancelling…" : `Cancel ${n} bill${n === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One radio tile in the 2-column reason grid. */
function ReasonTile({
  name,
  label,
  checked,
  disabled,
  onPick,
}: {
  name: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2.5 rounded-[9px] border px-3 py-2.5 text-[13.5px] ${
        checked ? "border-ink-400 bg-ink-25 font-semibold text-ink-900" : "border-ink-200 text-ink-700 hover:bg-ink-25"
      } ${disabled ? "cursor-not-allowed" : ""}`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onPick}
        className="h-4 w-4 flex-none accent-brand-600"
      />
      {label}
    </label>
  );
}
