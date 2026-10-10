"use client";

// Floor Control — ADD INVOICES (2026-10-10, Phase 2, RECORD ONLY). The approved
// flow: docs/mockups/add-invoices/add-invoices-flow.html.
//
// SAP sometimes bills ONE OBD as several invoices; import brings one (SAP's,
// seq 1). The person records the rest PAPER BY PAPER: paper 1 is SAP's number
// (read-only), each later paper gets its number typed, and on every paper he
// ticks the items printed on it. Ticking a line puts ALL its tins still LEFT on
// this paper; "change" takes fewer (part-qty across papers is allowed). When
// nothing is left: a summary per invoice and "Save invoices".
//
// The SAVE rule is the server's — lib/order-invoices/rules.ts validateSplit —
// imported here so Save is only enabled when the server will accept it; the
// server still decides, and its errors are shown word for word. Only the FULL
// I + 9-digit number is ever sent (expandInvoiceNo).
//
// Opened from the Floor bar's ··· More (exactly one OBD ticked) or the detail
// panel's Invoices section. GET/POST/DELETE /api/floor/orders/[orderId]/invoices.
//
// ⚠ A MODAL OVER THE WHOLE PAGE (z-[120], above the detail panel's z-[110]) —
// the off-floor-dialog.tsx pattern. ⚠ NO KEY LISTENER: floor-page.tsx is the
// single Esc owner (CLAUDE_FLOOR §4.6); it bumps `escSignal`, and this form
// decides what Esc means (close, or "Discard?" when papers are unsaved).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateSplit, type SplitInvoiceInput } from "@/lib/order-invoices/rules";
import { expandInvoiceNo, kgShare, lineLitres, tinsLeft } from "@/lib/order-invoices/entry";
import type { SplitView } from "@/lib/order-invoices/split";
import { formatLitres } from "./status-pill";
import { BAR_DANGER, BAR_PRIMARY, BAR_SECONDARY } from "./floor-action-bar";

type View = SplitView & { canEdit: boolean };

/** One saved paper: its full number and the tins it holds, per active line index. */
interface Paper {
  no: string;
  q: number[];
}

/** The paper being filled. `raw` is what was typed (unused on SAP's paper). */
interface Draft {
  raw: string;
  q: number[];
  edit: boolean[];
}

type Step = "papers" | "other" | "discard" | "undo";

const zeros = (n: number) => Array.from({ length: n }, () => 0);
const falses = (n: number) => Array.from({ length: n }, () => false);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function fmtKg(kg: number | null): string | null {
  if (kg === null) return null;
  return `~${Math.round(kg).toLocaleString("en-IN")} kg`;
}

export function AddInvoicesDialog({
  orderId,
  obdNumber,
  obdKg,
  escSignal,
  onClose,
  onSaved,
  onUndone,
  onBusyChange,
}: {
  orderId: number;
  obdNumber: string;
  /** The OBD's header kg (board row weightKg) — shared by litres for ~kg. */
  obdKg: number | null;
  /** Bumped by floor-page's Esc listener. */
  escSignal: number;
  onClose: () => void;
  /** Saved — the caller toasts "{OBD} now has {n} invoices" + Undo, and reloads. */
  onSaved: (n: number) => void;
  /** Undo split went through — the caller toasts and reloads. */
  onUndone: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Paper[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [cur, setCur] = useState<Draft>({ raw: "", q: [], edit: [] });
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState<Step>("papers");
  const [otherObds, setOtherObds] = useState<{ invoiceNo: string; obdNumbers: string[] }[]>([]);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const setBusy = useCallback(
    (b: boolean) => {
      setBusyState(b);
      onBusyChange(b);
    },
    [onBusyChange],
  );
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  // ── Load the split as it stands ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/floor/orders/${orderId}/invoices`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Partial<View> & { error?: string };
        if (cancelled) return;
        if (!res.ok || !Array.isArray(body.activeLines)) {
          setLoadError(body.error ?? `Could not load this bill's invoices (HTTP ${res.status})`);
          return;
        }
        const v = body as View;
        const n = v.activeLines.length;
        const indexById = new Map(v.activeLines.map((l, i) => [l.rawLineItemId, i]));
        setView(v);
        if (v.split) {
          // EDIT: every recorded paper, in seq order. A line no longer active
          // (stale) has nowhere to go and is dropped — the summary then shows
          // what is left to place.
          setSaved(
            v.invoices.map((inv) => {
              const q = zeros(n);
              for (const l of inv.lines) {
                const i = indexById.get(l.rawLineItemId);
                if (i !== undefined) q[i] += l.qty;
              }
              return { no: inv.invoiceNo ?? "", q };
            }),
          );
        }
        setCur({ raw: "", q: zeros(n), edit: falses(n) });
      } catch {
        if (!cancelled) setLoadError("Could not reach the server — check your connection.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const lines = view?.activeLines ?? [];
  const sapNo = view?.sapInvoice?.invoiceNo ?? null;
  const unitQtys = useMemo(() => lines.map((l) => l.unitQty), [lines]);
  const totalTins = sum(unitQtys.map((u) => Math.max(u, 0)));
  const obdLitres = sum(lines.map((l) => l.volumeLine ?? 0));
  const left = useMemo(() => tinsLeft(unitQtys, saved.map((p) => p.q)), [unitQtys, saved]);
  const leftAll = sum(left.map((x) => Math.max(x, 0)));
  const paperIndex = editingIndex ?? saved.length;
  const isSapPaper = paperIndex === 0;
  const curHasTicks = cur.q.some((x) => x > 0);
  const curEmpty = !curHasTicks && cur.raw.trim() === "";
  const showSummary = view !== null && editingIndex === null && saved.length > 0 && leftAll === 0 && !curHasTicks;
  const isEditMode = view?.split === true;

  const curNo = isSapPaper ? sapNo ?? "" : expandInvoiceNo(cur.raw, sapNo);

  // ── The current paper's message (the mockup's check()) ───────────────────
  const paperCheck = useMemo((): { ok: boolean; text: string; tone: "ok" | "warn" | "err" } => {
    if (!curNo) return { ok: false, text: "Type the invoice number from the paper", tone: "warn" };
    if (saved.some((p) => p.no === curNo)) return { ok: false, text: `${curNo} is already added`, tone: "err" };
    if (!curHasTicks) return { ok: false, text: "Tick the items on this paper", tone: "warn" };
    if (cur.q.some((x, i) => x > Math.max(left[i] ?? 0, 0))) return { ok: false, text: "More tins than are left on a line", tone: "err" };
    if (cur.q.some((x) => !Number.isInteger(x) || x < 0)) return { ok: false, text: "Tins must be whole numbers", tone: "err" };
    return { ok: true, text: `${sum(cur.q)} tins on ${curNo}`, tone: "ok" };
  }, [curNo, saved, curHasTicks, cur.q, left]);

  // ── The whole split, as the server will see it ───────────────────────────
  const splitInput: SplitInvoiceInput[] = useMemo(
    () =>
      saved.map((p) => ({
        invoiceNo: p.no,
        lines: lines.flatMap((l, i) => (p.q[i] > 0 ? [{ rawLineItemId: l.rawLineItemId, qty: p.q[i] }] : [])),
      })),
    [saved, lines],
  );
  const splitErrors = useMemo(() => (view ? validateSplit(lines, splitInput, sapNo) : []), [view, lines, splitInput, sapNo]);

  // ── Paper actions ─────────────────────────────────────────────────────────
  const touch = () => {
    setDirty(true);
    setError(null);
    setServerErrors([]);
  };
  const toggleLine = (i: number) => {
    touch();
    setCur((c) => {
      const q = [...c.q];
      const edit = [...c.edit];
      q[i] = q[i] > 0 ? 0 : Math.max(left[i] ?? 0, 0);
      edit[i] = false;
      return { ...c, q, edit };
    });
  };
  const openChange = (i: number) => setCur((c) => ({ ...c, edit: c.edit.map((e, j) => (j === i ? true : e)) }));
  const setQty = (i: number, v: string) => {
    touch();
    const n = v.trim() === "" ? 0 : Math.max(0, Math.floor(Number(v)) || 0);
    setCur((c) => ({ ...c, q: c.q.map((x, j) => (j === i ? n : x)) }));
  };
  const putAllLeft = () => {
    touch();
    setCur((c) => ({ ...c, q: left.map((x) => Math.max(x, 0)), edit: falses(lines.length) }));
  };
  const saveThisPaper = () => {
    if (!paperCheck.ok) return;
    touch();
    const paper: Paper = { no: curNo, q: [...cur.q] };
    setSaved((s) => {
      const next = [...s];
      next.splice(editingIndex ?? next.length, 0, paper);
      return next;
    });
    setEditingIndex(null);
    setCur({ raw: "", q: zeros(lines.length), edit: falses(lines.length) });
  };
  /** Take a saved paper back into the form. Only from an empty form. */
  const editPaper = (i: number) => {
    if (!curEmpty || editingIndex !== null) return;
    const p = saved[i];
    setSaved((s) => s.filter((_, j) => j !== i));
    setEditingIndex(i);
    setCur({
      raw: i === 0 ? "" : p.no,
      q: [...p.q],
      edit: p.q.map((x, j) => x > 0 && x < (unitQtys[j] ?? 0)),
    });
  };

  // ── Close / Esc ───────────────────────────────────────────────────────────
  const requestClose = useCallback(() => {
    if (busy) return;
    if (step !== "papers") {
      setStep("papers");
      return;
    }
    if (dirty) setStep("discard");
    else onClose();
  }, [busy, step, dirty, onClose]);
  const firstEsc = useRef(escSignal);
  useEffect(() => {
    if (escSignal === firstEsc.current) return;
    requestClose();
    // Only a NEW press acts; requestClose is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escSignal]);

  // ── Save / Undo ───────────────────────────────────────────────────────────
  const save = async (confirmOtherObd: boolean) => {
    if (splitErrors.length > 0 || busy) return;
    setBusy(true);
    setError(null);
    setServerErrors([]);
    try {
      const res = await fetch(`/api/floor/orders/${orderId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoices: splitInput, confirmOtherObd }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        errors?: string[];
        otherObds?: { invoiceNo: string; obdNumbers: string[] }[];
      };
      if (res.status === 409 && Array.isArray(body.otherObds) && body.otherObds.length > 0) {
        setOtherObds(body.otherObds);
        setStep("other");
        return;
      }
      if (!res.ok || body.ok !== true) {
        setStep("papers");
        setError(body.error ?? `Save failed (HTTP ${res.status})`);
        setServerErrors(Array.isArray(body.errors) ? body.errors.filter((e) => e !== body.error) : []);
        return;
      }
      onSaved(saved.length);
    } catch {
      setError("Could not reach the server — check your connection. Nothing may have been saved; press Save again.");
    } finally {
      setBusy(false);
    }
  };

  const undoSplit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/floor/orders/${orderId}/invoices`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok !== true) {
        setStep("papers");
        setError(body.error ?? `Undo failed (HTTP ${res.status})`);
        return;
      }
      onUndone();
    } catch {
      setStep("papers");
      setError("Could not reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const title = `${isEditMode ? "Edit invoices" : "Add invoices"} · ${obdNumber}`;
  const blocked = view !== null && (view.blockedReason !== null || !view.canEdit);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={requestClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[calc(100vh-40px)] w-[680px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 border-b border-ink-100 px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-[18px] font-bold text-ink-900">{title}</h3>
            {view && (
              <p className="mt-0.5 text-[13px] text-ink-600">
                {lines.length} line{lines.length === 1 ? "" : "s"} · {totalTins} tins ·{" "}
                <b className={leftAll > 0 ? "font-semibold text-ink-900" : "font-semibold text-ok-text"}>
                  {leftAll} still to place
                </b>
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            disabled={busy}
            className="ml-auto rounded-md px-2 py-1 text-[16px] text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loadError ? (
            <p className="text-[13px] text-danger-text">{loadError}</p>
          ) : view === null ? (
            <p className="text-[13px] text-ink-500">Loading…</p>
          ) : blocked ? (
            <p className="rounded-[9px] border border-ink-100 bg-ink-25 px-3 py-2.5 text-[13px] text-ink-700">
              {view.blockedReason ?? "You do not have the Add invoices tick."}
            </p>
          ) : step === "discard" ? (
            <div>
              <p className="text-[15px] font-semibold text-ink-900">Discard these invoices?</p>
              <p className="mt-1 text-[13px] text-ink-600">Nothing has been saved. The papers you entered will be lost.</p>
            </div>
          ) : step === "undo" ? (
            <div>
              <p className="text-[15px] font-semibold text-ink-900">Undo the split?</p>
              <p className="mt-1 text-[13px] text-ink-600">
                {obdNumber} goes back to SAP&apos;s invoice {sapNo} only. The {saved.length > 1 ? saved.length - 1 : ""} typed
                invoice{saved.length === 2 ? "" : "s"} are removed.
              </p>
            </div>
          ) : step === "other" ? (
            <div>
              {otherObds.map((o) => (
                <p key={o.invoiceNo} className="text-[14px] text-ink-900">
                  <b className="font-mono font-semibold">{o.invoiceNo}</b> is also on OBD{" "}
                  <b className="font-mono font-semibold">{o.obdNumbers.join(", ")}</b>.
                </p>
              ))}
              <p className="mt-2 text-[13px] text-ink-600">Same invoice covers both? Save anyway, or go back and check the number.</p>
            </div>
          ) : (
            <>
              {view.stale && (
                <p className="mb-3 rounded-[9px] border border-warn/40 bg-warn-bg px-3 py-2 text-[12.5px] text-warn-text">
                  Lines changed in SAP since these invoices were recorded — re-check every paper.
                </p>
              )}

              {/* ── Done chips — saved papers; click one to change it ───────── */}
              {saved.length > 0 && !showSummary && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {saved.map((p, i) => (
                    <button
                      key={`${p.no}-${i}`}
                      type="button"
                      disabled={!curEmpty || editingIndex !== null}
                      title={!curEmpty || editingIndex !== null ? "Save or clear this paper first" : "Change this invoice"}
                      onClick={() => editPaper(i)}
                      className="inline-flex items-center gap-1 rounded-[6px] bg-ok-bg px-2 py-1 text-[12px] font-semibold text-ok-text enabled:hover:brightness-95 disabled:cursor-default"
                    >
                      ✓ <span className="font-mono">{p.no}</span> · {sum(p.q)} tins
                    </button>
                  ))}
                </div>
              )}

              {showSummary ? (
                <Summary
                  saved={saved}
                  lines={lines}
                  obdLitres={obdLitres}
                  obdKg={obdKg}
                  totalTins={totalTins}
                  onChange={editPaper}
                />
              ) : (
                <PaperForm
                  paperIndex={paperIndex}
                  isSapPaper={isSapPaper}
                  sapNo={sapNo}
                  draft={cur}
                  curNo={curNo}
                  lines={lines}
                  left={left}
                  check={paperCheck}
                  busy={busy}
                  onRaw={(v) => {
                    touch();
                    setCur((c) => ({ ...c, raw: v }));
                  }}
                  onToggle={toggleLine}
                  onOpenChange={openChange}
                  onQty={setQty}
                />
              )}

              {showSummary && splitErrors.length > 0 && (
                <ul className="mt-3 list-disc rounded-[9px] border border-warn/40 bg-warn-bg py-2 pl-7 pr-3 text-[12.5px] text-warn-text">
                  {splitErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {error && (
                <div className="mt-3 rounded-[9px] border border-danger-bd bg-danger-bg px-3 py-2.5 text-[13px] text-danger-text">
                  {error}
                  {serverErrors.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">
                      {serverErrors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 border-t border-ink-100 bg-ink-25 px-6 py-3.5">
          {view && !blocked && step === "papers" && isEditMode && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep("undo")}
              className="text-[13px] font-semibold text-danger-text hover:underline disabled:text-gray-400"
            >
              Undo split
            </button>
          )}
          <div className="ml-auto flex items-center gap-2.5">
            {view === null || blocked || loadError ? (
              <button type="button" autoFocus onClick={onClose} className={BAR_SECONDARY}>
                Close
              </button>
            ) : step === "discard" ? (
              <>
                <button type="button" autoFocus onClick={() => setStep("papers")} className={BAR_SECONDARY}>
                  Keep editing
                </button>
                <button type="button" onClick={onClose} className={BAR_DANGER}>
                  Discard
                </button>
              </>
            ) : step === "undo" ? (
              <>
                <button type="button" autoFocus disabled={busy} onClick={() => setStep("papers")} className={BAR_SECONDARY}>
                  Back
                </button>
                <button type="button" disabled={busy} onClick={() => void undoSplit()} className={BAR_DANGER}>
                  {busy ? "Undoing…" : "Undo split"}
                </button>
              </>
            ) : step === "other" ? (
              <>
                <button type="button" autoFocus disabled={busy} onClick={() => setStep("papers")} className={BAR_SECONDARY}>
                  Back
                </button>
                <button type="button" disabled={busy} onClick={() => void save(true)} className={BAR_PRIMARY}>
                  {busy ? "Saving…" : "Save anyway"}
                </button>
              </>
            ) : showSummary ? (
              <>
                <button type="button" disabled={busy} onClick={() => editPaper(saved.length - 1)} className={BAR_SECONDARY}>
                  ← Change last invoice
                </button>
                <button
                  type="button"
                  disabled={busy || splitErrors.length > 0}
                  title={splitErrors[0]}
                  onClick={() => void save(false)}
                  className={BAR_PRIMARY}
                >
                  {busy ? "Saving…" : "Save invoices"}
                </button>
              </>
            ) : (
              <>
                {!isSapPaper && (
                  <button type="button" disabled={busy || leftAll === 0} onClick={putAllLeft} className={BAR_SECONDARY}>
                    Put all that&apos;s left here
                  </button>
                )}
                <button type="button" disabled={busy || !paperCheck.ok} onClick={saveThisPaper} className={BAR_PRIMARY}>
                  Save this invoice →
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── One paper ────────────────────────────────────────────────────────────────

function PaperForm({
  paperIndex,
  isSapPaper,
  sapNo,
  draft,
  curNo,
  lines,
  left,
  check,
  busy,
  onRaw,
  onToggle,
  onOpenChange,
  onQty,
}: {
  paperIndex: number;
  isSapPaper: boolean;
  sapNo: string | null;
  draft: Draft;
  curNo: string;
  lines: View["activeLines"];
  left: number[];
  check: { ok: boolean; text: string; tone: "ok" | "warn" | "err" };
  busy: boolean;
  onRaw: (v: string) => void;
  onToggle: (i: number) => void;
  onOpenChange: (i: number) => void;
  onQty: (i: number, v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-500">Invoice {paperIndex + 1}</span>
        {isSapPaper ? (
          <span className="inline-flex items-center gap-2 rounded-[7px] border border-ink-200 bg-ink-25 px-2.5 py-1">
            <span className="font-mono text-[14px] font-semibold text-ink-900">{sapNo}</span>
            <span className="text-[11.5px] text-ink-500">from SAP</span>
          </span>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={draft.raw}
              disabled={busy}
              onChange={(e) => onRaw(e.target.value)}
              placeholder="Number on the paper"
              aria-label={`Invoice ${paperIndex + 1} number`}
              className="h-[36px] w-[190px] rounded-[8px] border border-ink-200 px-3 font-mono text-[14px] text-ink-900 placeholder:font-sans placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10"
            />
            {curNo && <span className="font-mono text-[13px] text-ink-600">→ {curNo}</span>}
          </>
        )}
      </div>
      <p className="mt-3 text-[13px] text-ink-600">Tick every item printed on this paper.</p>

      <div className="mt-2 overflow-hidden rounded-[10px] border border-ink-100">
        <div className="grid grid-cols-[28px_1fr_76px_150px] items-center gap-2 border-b border-ink-100 bg-ink-25 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.03em] text-ink-500">
          <span />
          <span>Item</span>
          <span className="text-right">Tins left</span>
          <span className="text-right">On this paper</span>
        </div>
        {lines.map((l, i) => {
          const lf = Math.max(left[i] ?? 0, 0);
          const on = draft.q[i] > 0;
          const done = lf === 0 && !on;
          const over = draft.q[i] > lf;
          return (
            <div
              key={l.rawLineItemId}
              className={`grid grid-cols-[28px_1fr_76px_150px] items-center gap-2 border-b border-ink-50 px-3 py-2 text-[13px] last:border-b-0 ${
                done ? "text-ink-400" : "text-ink-900"
              }`}
            >
              <input
                type="checkbox"
                aria-label={`Tick line ${l.lineId}`}
                checked={on}
                disabled={busy || done}
                onChange={() => onToggle(i)}
                className="h-[15px] w-[15px] cursor-pointer accent-brand-600 disabled:cursor-not-allowed"
              />
              <span className="min-w-0">
                <span className="block truncate">{l.description ?? l.skuCodeRaw}</span>
                <span className="block font-mono text-[11px] text-ink-400">
                  {l.skuCodeRaw} · line {l.lineId}
                </span>
              </span>
              <span className="text-right tabular-nums">{done ? "done" : lf}</span>
              <span className="text-right">
                {!on ? (
                  <span className="text-ink-200">—</span>
                ) : draft.edit[i] ? (
                  <span className="inline-flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={lf}
                      step={1}
                      value={draft.q[i]}
                      disabled={busy}
                      onChange={(e) => onQty(i, e.target.value)}
                      aria-label={`Tins of line ${l.lineId} on this paper`}
                      className={`h-[30px] w-[64px] rounded-[7px] border px-2 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/10 ${
                        over ? "border-danger text-danger-text" : "border-ink-200"
                      }`}
                    />
                    <span className="text-[12px] text-ink-500">of {lf}</span>
                  </span>
                ) : (
                  <span className="tabular-nums">
                    {draft.q[i]} tins{" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onOpenChange(i)}
                      className="ml-1 text-[12px] font-semibold text-brand-700 hover:underline"
                    >
                      change
                    </button>
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p
        className={`mt-3 text-[12.5px] ${
          check.tone === "ok" ? "text-ok-text" : check.tone === "err" ? "text-danger-text" : "text-ink-500"
        }`}
      >
        {check.text}
      </p>
    </div>
  );
}

// ── The summary, when every tin is placed ───────────────────────────────────

function Summary({
  saved,
  lines,
  obdLitres,
  obdKg,
  totalTins,
  onChange,
}: {
  saved: Paper[];
  lines: View["activeLines"];
  obdLitres: number;
  obdKg: number | null;
  totalTins: number;
  onChange: (i: number) => void;
}) {
  return (
    <div>
      <p className="text-[14px] font-semibold text-ink-900">
        All {totalTins} tins placed on {saved.length} invoice{saved.length === 1 ? "" : "s"}.
      </p>
      <div className="mt-3 overflow-hidden rounded-[10px] border border-ink-100">
        {saved.map((p, i) => {
          const litres = sum(lines.map((l, j) => lineLitres(l.volumeLine, l.unitQty, p.q[j] ?? 0)));
          const kg = fmtKg(kgShare(obdKg, litres, obdLitres));
          const nLines = p.q.filter((x) => x > 0).length;
          return (
            <div key={`${p.no}-${i}`} className="flex items-center gap-3 border-b border-ink-50 px-3 py-2.5 text-[13px] last:border-b-0">
              <span className="font-mono font-semibold text-ink-900">{p.no}</span>
              {i === 0 && <span className="rounded-[4px] bg-ink-100 px-1.5 py-px text-[10.5px] font-semibold text-ink-600">SAP</span>}
              <span className="text-ink-600">
                {nLines} line{nLines === 1 ? "" : "s"} · {sum(p.q)} tins · {formatLitres(litres)} L{kg ? ` · ${kg}` : ""}
              </span>
              <button
                type="button"
                onClick={() => onChange(i)}
                className="ml-auto text-[12px] font-semibold text-brand-700 hover:underline"
              >
                Change
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
