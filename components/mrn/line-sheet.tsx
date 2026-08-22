"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Minus, Plus, X } from "lucide-react";
import {
  excessQty,
  shortQty,
  validateBatches,
  validateConditionCounts,
} from "@/lib/mrn/derive";
import type { MrnBatchInput, MrnDetailLine } from "@/lib/mrn/types";
import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-open";
import { describeWriteError } from "./modal-shell";

// S7 / S7b / S8 — the line sheet. The heart of the module.
//
// 🔴 PHYSICAL QTY OPENS PRE-FILLED TO qtySti, AND THAT IS THE WHOLE DESIGN.
// The common case is that the stock is there: he taps Confirm and types
// nothing. He types only when something is wrong. Removing the pre-fill would
// turn a 36-line truck from 36 taps into 36 numbers typed on a phone in a
// warehouse — design §6.1-6.2.
//
// 🔴 THERE IS NO BEST-BEFORE INPUT (2026-08-22, schema v27.17). The supervisor
// does not record one. Both pickers were removed from here, the requirement
// from validateBatches(), the field from MrnBatchInput, and the column from the
// desktop table. Earlier revisions had it TYPED per batch, and before that
// DERIVED as manufacturing + 24 months; both reversals are recorded in
// prisma/schema.prisma so neither is revived. Per batch there are now exactly
// three inputs: qty, month, year.
//
// ⚠️ EVERY RULE IS CALLED, NEVER RESTATED. validateBatches() and
// validateConditionCounts() own the arithmetic and the wording; this sheet
// renders their `message` verbatim and gates Confirm on their `ok`. The write
// route calls the SAME two functions, so the phone and the server can never
// disagree about why a line will not confirm.
//
// ⚠️ SHORT AND EXCESS ARE DERIVED AND READ-ONLY. They are shortQty()/excessQty()
// off the same file, rendered in the count grid so the supervisor can SEE the
// consequence of the number he just typed — but they are not inputs and must
// never become them (§11 OQ-2). Only SIX counts are typed: SND · Lky · Dmg ·
// Emp · QTD · REJ.
//
// ⚠️ EVERY INPUT IS text-[16px]. iOS auto-zooms any focused field below 16px and
// then leaves the page zoomed (UI §9). There is no exception on this screen.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One batch as the sheet holds it while being edited — months/years may still
 *  be unset, which MrnBatchInput (a submit shape) cannot express. */
interface DraftBatch {
  key: number;
  qty: number;
  mfgMonth: number | null;
  mfgYear: number | null;
}

type CountKey = "sndQty" | "leakyQty" | "damageQty" | "emptyQty" | "qtdQty" | "rejQty";
const COUNT_KEYS: { key: CountKey; label: string }[] = [
  { key: "sndQty", label: "SND" },
  { key: "leakyQty", label: "Lky" },
  { key: "damageQty", label: "Dmg" },
  { key: "emptyQty", label: "Emp" },
  { key: "qtdQty", label: "QTD" },
  { key: "rejQty", label: "REJ" },
];

interface LineSheetProps {
  mrnId: number;
  line: MrnDetailLine;
  /** "line 4 of 36" — position in the sheet's subtitle. */
  position: { index: number; total: number };
  onClose: () => void;
  onConfirmed: () => void;
}

export function LineSheet({
  mrnId,
  line,
  position,
  onClose,
  onConfirmed,
}: LineSheetProps): React.JSX.Element {
  const keyboardOpen = useKeyboardOpen();

  // PRE-FILLED. Re-opening a confirmed line shows what he recorded, not the STI
  // figure again — correcting himself is a normal path while the MRN is
  // 'checking' and the route allows it.
  const [physicalQty, setPhysicalQty] = useState<number>(line.physicalQty ?? line.qtySti);

  const [batches, setBatches] = useState<DraftBatch[]>(() => {
    if (line.batches.length > 0) {
      return line.batches.map((b, i) => ({
        key: i,
        qty: b.qty,
        mfgMonth: b.mfgMonth,
        mfgYear: b.mfgYear,
      }));
    }
    // The DEFAULT is always ONE batch — a single mfg pair and a single BB pair,
    // exactly as S7 draws it. Splitting is the rare path behind a link.
    // YEAR defaults to the current year — it is right on almost every line, so
    // it saves a tap each time, and a wrong year is obvious at a glance. MONTH
    // stays unset: nothing can guess it, and a pre-filled month is a month
    // nobody read off a tin.
    return [
      {
        key: 0,
        qty: line.physicalQty ?? line.qtySti,
        mfgMonth: null,
        mfgYear: new Date().getFullYear(),
      },
    ];
  });

  const [issueOpen, setIssueOpen] = useState<boolean>(
    line.sndQty !== null || line.leakyQty !== null || line.damageQty !== null || line.emptyQty !== null,
  );
  const [counts, setCounts] = useState<Record<CountKey, number | null>>({
    sndQty: line.sndQty,
    leakyQty: line.leakyQty,
    damageQty: line.damageQty,
    emptyQty: line.emptyQty,
    qtdQty: line.qtdQty,
    rejQty: line.rejQty,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const split = batches.length > 1;

  // A single batch always carries the WHOLE physical qty — the operator never
  // types a quantity in the unsplit case, so it must follow the stepper.
  const effectiveBatches: DraftBatch[] = split
    ? batches
    : batches.map((b) => ({ ...b, qty: physicalQty }));

  // ⚠ physicalQty === 0 is VALID and takes ZERO batches (§11 OQ-4). Nothing
  // arrived, so there is no quantity to attribute and no month to record —
  // demanding a manufacturing date for goods that did not come would be asking
  // him to invent one.
  const submitBatches: MrnBatchInput[] =
    physicalQty === 0
      ? []
      : effectiveBatches.map((b) => ({
          qty: b.qty,
          mfgMonth: b.mfgMonth ?? 0,
          mfgYear: b.mfgYear ?? 0,
        }));

  // CALLED, not restated. Its `message` is what the sheet shows.
  const batchCheck = useMemo(
    () => validateBatches(physicalQty, submitBatches),
    // submitBatches is derived fresh each render; depending on its inputs is
    // what actually changes the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [physicalQty, JSON.stringify(submitBatches)],
  );

  const countCheck = useMemo(
    () => validateConditionCounts(physicalQty, counts),
    [physicalQty, counts],
  );

  // Derived, never typed — rendered read-only in the grid below.
  const short = shortQty({ qtySti: line.qtySti, physicalQty });
  const excess = excessQty({ qtySti: line.qtySti, physicalQty });

  // A year that is missing reads as 0 through submitBatches, which
  // validateBatches does not test (it deliberately declines to judge "a
  // reasonable year" — that ages). The sheet still has to stop a save that
  // would write a zero year, so it checks PRESENCE here — a storability guard,
  // not a second copy of the domain rule.
  const yearsMissing =
    physicalQty > 0 &&
    effectiveBatches.some((b) => !b.mfgMonth || !b.mfgYear);

  const canConfirm = batchCheck.ok && (countCheck === null || countCheck.ok) && !yearsMissing && !busy;

  /**
   * 🔴 VALIDATION MESSAGES ARE SILENT UNTIL HE HAS ACTUALLY DONE SOMETHING.
   *
   * The amber "Every batch needs a manufacturing month and a best-before
   * month" banner used to render from the moment the sheet OPENED, before the
   * operator had touched a control — a warning present at rest, which is noise
   * and which trains people to ignore the warnings that matter.
   *
   * Two triggers now reveal them, and nothing else:
   *   • `attempted` — he pressed Confirm while it was blocked. He asked, so he
   *     gets the reason.
   *   • `touched` — he VISITED a field and left it (blur), so the message is
   *     about something he was just looking at.
   *
   * Until then Confirm is simply disabled, which already says "not yet"
   * without scolding him.
   */
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState(false);
  const showValidation = attempted || touched;

  function setBatch(key: number, patch: Partial<DraftBatch>): void {
    setBatches((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addBatch(): void {
    setBatches((rows) => {
      const nextKey = Math.max(...rows.map((r) => r.key)) + 1;
      // The new batch starts at whatever is left over, so the sum strip reads
      // correct the moment it appears rather than immediately red.
      const used = rows.reduce((s, r) => s + r.qty, 0);
      const first = rows.length === 1 ? [{ ...rows[0], qty: rows[0].qty || physicalQty }] : rows;
      const remaining = Math.max(0, physicalQty - (rows.length === 1 ? (first[0].qty || physicalQty) : used));
      return [
        ...first,
        { key: nextKey, qty: remaining, mfgMonth: null, mfgYear: new Date().getFullYear() },
      ];
    });
  }

  function removeBatch(key: number): void {
    setBatches((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)));
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mrn/${mrnId}/line/${line.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          physicalQty,
          // Only the six TYPED counts cross the wire. Short and Excess are
          // derived server-side too, from the same derive.ts — sending them
          // would be offering the server a number it must not trust.
          ...(issueOpen
            ? counts
            : { sndQty: null, leakyQty: null, damageQty: null, emptyQty: null, qtdQty: null, rejQty: null }),
          batches: submitBatches.map((b, i) => ({ batchNo: i + 1, ...b })),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // The route returns derive.ts's OWN message for a failed sum, so this
        // is the same sentence the strip above already showed. A 409 means the
        // MRN moved out of 'checking' under him.
        setError(describeWriteError(res.status, json.error, "confirm this line"));
        return;
      }
      onConfirmed();
    } catch {
      setError("Could not reach the server. Nothing was saved — try again.");
    } finally {
      setBusy(false);
    }
  }

  // ⚠ FULL SCREEN since 2026-08-22 — it was a bottom sheet, and the content
  // stopped fitting once the chip pickers replaced the dropdowns.
  //
  // 🔴 THE BACK-PRESS CONTRACT IS UNCHANGED. There is still ONE history entry
  // and ONE popstate handler, both owned by supervisor-board.tsx: this screen
  // pushes nothing and closes nothing itself. ✕, Cancel and the hardware back
  // ALL call the same `onClose`, which is `window.history.back()` at the call
  // site — so every close runs the identical path and the handler's nested
  // branch re-pushes, leaving him in the truck. Now that ✕ makes the close
  // VISIBLE it would be easy to wire it straight to a setState; that is exactly
  // the two-paths-disagree desync this module has been protected against since
  // 9a. Never close directly.
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex flex-col bg-white"
    >
      <div className="shrink-0 border-b border-gray-100 px-4 pt-3 pb-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold leading-tight text-gray-900">
              {line.isCatalogued ? line.description : "Not in catalog"}
            </div>
            <div className="mt-1 text-[13px] text-[#667085]">
            <span className="font-mono">{line.skuCode}</span>
              {line.pack && ` · ${line.pack}`} · line {position.index} of {position.total}
            </div>
          </div>
          {/* Routes through the SAME onClose as Cancel and the hardware back —
              see the block comment above. 44px tap target (UI §60). */}
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            aria-label="Close"
            className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 active:bg-gray-100"
          >
            <X size={22} />
          </button>
        </div>
      </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {/* ── Physical qty ─────────────────────────────────────────────── */}
          {/* mt-4 — the first section was sitting hard against "line 1 of 10"
              in the sheet header with no separation. */}
          <Label className="mt-4">Physical qty received</Label>
          <div className="mt-1.5 flex items-center gap-2.5">
            <StepButton
              label="Decrease"
              onClick={() => setPhysicalQty((n) => Math.max(0, n - 1))}
            >
              <Minus size={20} />
            </StepButton>
            {/* Tappable for direct entry — a supervisor counting 342 tins is not
                going to press − 300 times. text-[16px] minimum (UI §9). */}
            <input
              value={physicalQty}
              inputMode="numeric"
              aria-label="Physical qty received"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (v === "") return setPhysicalQty(0);
                const n = Number(v);
                if (Number.isInteger(n) && n >= 0) setPhysicalQty(n);
              }}
              className={
                "h-[52px] min-w-0 flex-1 rounded-[13px] border text-center text-[22px] font-bold tabular-nums outline-none " +
                (physicalQty === line.qtySti
                  ? "border-gray-200 text-[#1d2939]"
                  : "border-red-200 bg-red-50 text-[#b42318]")
              }
            />
            <StepButton label="Increase" onClick={() => setPhysicalQty((n) => n + 1)}>
              <Plus size={20} />
            </StepButton>
          </div>
          <p
            className={
              "mt-[7px] text-[11.5px] leading-[1.5] " +
              (short > 0 || excess > 0 ? "font-semibold text-[#b42318]" : "text-[#98a2b3]")
            }
          >
            {short > 0
              ? `${short} less than the STI qty of ${line.qtySti} → recorded as Short ${short}.`
              : excess > 0
                ? `${excess} more than the STI qty of ${line.qtySti} → recorded as Excess ${excess}.`
                : `Matches the STI qty of ${line.qtySti}. Change it only if the count differs.`}
          </p>

          {/* ── Batches ──────────────────────────────────────────────────── */}
          {physicalQty === 0 ? (
            // Nothing arrived. No batch, no month — see the OQ-4 note above.
            <div className="mt-4 rounded-[11px] border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] leading-[1.55] text-[#667085]">
              Nothing was received on this line, so it carries no manufacturing batch.
            </div>
          ) : !split ? (
            <>
              <Label className="mt-4">Manufacturing</Label>
              <MfgPicker
                month={batches[0].mfgMonth}
                year={batches[0].mfgYear}
                onMonth={(m) => {
                  setBatch(batches[0].key, { mfgMonth: m });
                  setTouched(true);
                }}
                onYear={(y) => {
                  setBatch(batches[0].key, { mfgYear: y });
                  setTouched(true);
                }}
              />

              <AddBatchLink onClick={addBatch} />
            </>
          ) : (
            <>
              <Label className="mt-4">Manufacturing · {batches.length} batches</Label>
              {batches.map((b, i) => (
                <div key={b.key} className="mt-2 rounded-[13px] border border-gray-200 p-3">
                  <div className="mb-2 flex items-center">
                    <span className="text-[12px] font-semibold text-[#475467]">
                      Batch {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeBatch(b.key)}
                      aria-label={`Remove batch ${i + 1}`}
                      className="ml-auto flex h-11 w-11 items-center justify-center text-[#c2c8d0] active:text-[#b42318]"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={b.qty}
                      inputMode="numeric"
                      aria-label={`Batch ${i + 1} quantity`}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        const n = v === "" ? 0 : Number(v);
                        if (Number.isInteger(n) && n >= 0) setBatch(b.key, { qty: n });
                      }}
                      className="h-[46px] w-[72px] shrink-0 rounded-[10px] border border-gray-200 text-center text-[16px] font-semibold tabular-nums outline-none"
                    />
                    <span className="text-[12px] text-gray-400">tins in this batch</span>
                  </div>
                  {/* The SAME picker as the unsplit case — one implementation,
                      so a split line cannot drift from a plain one. */}
                  <MfgPicker
                    month={b.mfgMonth}
                    year={b.mfgYear}
                    onMonth={(m) => {
                      setBatch(b.key, { mfgMonth: m });
                      setTouched(true);
                    }}
                    onYear={(y) => {
                      setBatch(b.key, { mfgYear: y });
                      setTouched(true);
                    }}
                  />
                </div>
              ))}

              {/* Live sum strip — validateBatches' own numbers, not a second
                  count. Confirm is blocked until it reads ✓. */}
              <div
                className={
                  // Green as soon as it MATCHES — that is a positive
                  // confirmation, not a complaint, so it needs no gate. Red
                  // only once he has engaged; before that it sits neutral
                  // rather than accusing him of a sum he has not finished.
                  "mt-2.5 flex items-center justify-between rounded-[11px] px-3 py-2.5 text-[13px] font-semibold " +
                  (batchCheck.ok
                    ? "bg-green-50 text-green-700"
                    : showValidation
                      ? "bg-red-50 text-[#b42318]"
                      : "bg-gray-50 text-[#667085]")
                }
              >
                <span className="tabular-nums">
                  {batches.map((b) => b.qty).join(" + ")} = <b>{batchCheck.actual}</b>
                </span>
                <span>
                  {batchCheck.ok
                    ? "matches qty received ✓"
                    : `needs ${batchCheck.expected}`}
                </span>
              </div>

              <AddBatchLink onClick={addBatch} />
            </>
          )}

          {/* ── Issue toggle ─────────────────────────────────────────────── */}
          <button
            type="button"
            onClick={() => setIssueOpen((v) => !v)}
            className="mt-4 flex w-full items-center gap-3 rounded-[13px] border border-gray-200 px-3 py-3 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[#1d2939]">
                Something wrong with this line?
              </div>
              <div className="mt-0.5 text-[12px] text-[#98a2b3]">
                {issueOpen ? `Split the ${physicalQty} you received` : "Leaky, damaged, short, excess…"}
              </div>
            </div>
            <span
              className={
                "relative h-[28px] w-[48px] shrink-0 rounded-full transition-colors " +
                (issueOpen ? "bg-teal-600" : "bg-gray-200")
              }
            >
              <span
                className={
                  "absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all " +
                  (issueOpen ? "left-[23px]" : "left-[3px]")
                }
              />
            </span>
          </button>

          {issueOpen && (
            <>
              <div className="mt-2.5 grid grid-cols-4 gap-2">
                {COUNT_KEYS.map((c) => (
                  <CountBox
                    key={c.key}
                    label={c.label}
                    value={counts[c.key]}
                    onChange={(v) => setCounts((p) => ({ ...p, [c.key]: v }))}
                    onBlur={() => setTouched(true)}
                  />
                ))}
                {/* 🔴 READ-ONLY. Derived from the stepper above by derive.ts —
                    they have no columns of their own and must never become
                    inputs (§11 OQ-2). Shown so he can see the consequence of
                    the number he just typed. */}
                <ReadOnlyCount label="Sht" value={short} />
                <ReadOnlyCount label="Exc" value={excess} />
              </div>

              {showValidation && countCheck && !countCheck.ok && (
                <div className="mt-2.5 flex gap-2.5 rounded-[11px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-[1.55] text-amber-900">
                  <AlertTriangle size={15} className="mt-px shrink-0" />
                  {/* derive.ts's own sentence, verbatim. */}
                  <div>{countCheck.message}</div>
                </div>
              )}
            </>
          )}

          {showValidation && !batchCheck.ok && physicalQty > 0 && !split && (
            <div className="mt-3 flex gap-2.5 rounded-[11px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-[1.55] text-amber-900">
              <AlertTriangle size={15} className="mt-px shrink-0" />
              <div>{batchCheck.message}</div>
            </div>
          )}
          {showValidation && yearsMissing && batchCheck.ok && (
            <div className="mt-3 flex gap-2.5 rounded-[11px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-[1.55] text-amber-900">
              <AlertTriangle size={15} className="mt-px shrink-0" />
              <div>Every batch needs a manufacturing month and year.</div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-[11px] border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-[1.55] text-[#b42318]">
              {error}
            </div>
          )}
        </div>

        {/* ⚠ HIDDEN WHILE THE KEYBOARD IS UP — gated on the MEASURED viewport
            drop, never on input focus. Android dismisses the keyboard without
            blurring, so a focus-gated footer stays stuck hidden (UI §55/§59.6).
            It also stops this bar covering the count box being typed into. */}
        {!keyboardOpen && (
          <div
            className="shrink-0 border-t border-gray-100 px-4 pt-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          >
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="h-[50px] flex-1 rounded-[13px] bg-gray-100 text-[15px] font-semibold text-[#475467] disabled:opacity-60"
              >
                Cancel
              </button>
              {/* ⚠ NOT `disabled` — deliberately. It LOOKS disabled (grey,
                  not-allowed) and cannot submit, but it still takes the tap, so
                  pressing it while blocked sets `attempted` and reveals WHY.
                  A truly disabled button swallows the event, leaving him
                  pressing a dead control with no explanation — which is how the
                  banner ended up permanently visible in the first place.
                  `busy` is inside canConfirm, so this cannot double-submit. */}
              <button
                type="button"
                aria-disabled={!canConfirm}
                onClick={() => {
                  setAttempted(true);
                  if (canConfirm) void confirm();
                }}
                className={
                  "h-[50px] flex-1 rounded-[13px] text-[15px] font-bold " +
                  (canConfirm
                    ? "bg-teal-600 text-white active:bg-teal-700"
                    : "cursor-not-allowed bg-gray-100 text-gray-400")
                }
              >
                {busy ? "Saving…" : "Confirm line"}
              </button>
            </div>
          </div>
        )}
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

function Label({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400 ${className}`}
    >
      {children}
    </div>
  );
}

/** 52px — a thumb target on a warehouse floor, not a mouse target (UI §60). */
function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[13px] bg-gray-100 text-[#475467] active:bg-gray-200"
    >
      {children}
    </button>
  );
}

/**
 * Manufacturing month + year, as INLINE CHIPS. No dropdown.
 *
 * ⚠️ THIS REPLACED TWO NATIVE <select>s (2026-08-22). They raised the iOS wheel,
 * which is slow to spin on a warehouse floor, and — worse — they offered
 * impossible values: the year list ran to 2035, so a mis-spin could record a
 * tin manufactured nine years in the future and nothing downstream would catch
 * it (validateBatches deliberately does not judge years, and there is no DB
 * constraint on them either). Chips make the wrong answers unreachable rather
 * than merely discouraged.
 *
 * 🔴 THE RANGES ARE THE VALIDATION. There is no year check anywhere in the
 * stack, so this control IS the guard:
 *   • YEAR — exactly four chips, currentYear − 3 … currentYear. A manufacturing
 *     date cannot be in the future, and the depot does not receive stock older
 *     than three years.
 *   • MONTH — when the selected year IS the current year, months after the
 *     current month are DISABLED. A tin cannot be made next month. Recomputed
 *     whenever the year chip changes, so picking an older year re-enables all
 *     twelve.
 *
 * The clock is read ONCE per mount. A sheet open across midnight on 31 Dec
 * would keep the year list it opened with, which is correct — re-deriving
 * mid-edit could disable a month he had already chosen.
 *
 * Chips reuse the pack-chip treatment already on this screen, at a 44px minimum
 * tap target (UI §60).
 */
function MfgPicker({
  month,
  year,
  onMonth,
  onYear,
}: {
  month: number | null;
  year: number | null;
  onMonth: (m: number) => void;
  onYear: (y: number) => void;
}): React.JSX.Element {
  const now = useMemo(() => new Date(), []);
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;

  const years = [thisYear - 3, thisYear - 2, thisYear - 1, thisYear];

  // Only the CURRENT year can have unreachable months. Any earlier year is
  // wholly in the past, so all twelve are live.
  const maxMonth = year === thisYear ? thisMonth : 12;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5">
        {years.map((y) => (
          <Chip key={y} active={year === y} onClick={() => onYear(y)}>
            {y}
          </Chip>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {MONTHS.map((label, i) => {
          const m = i + 1;
          const disabled = m > maxMonth;
          return (
            <Chip
              key={label}
              active={month === m}
              disabled={disabled}
              onClick={() => onMonth(m)}
            >
              {label}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The pack-chip treatment from components/mrn/line-list.tsx, at a thumb-sized
 * tap target. `disabled` is a real attribute, not just a colour — a month in
 * the future must be unpressable, not merely discouraged.
 */
function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "h-11 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap " +
        (disabled
          ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
          : active
            ? "bg-[#2a323c] border-[#2a323c] text-white font-semibold"
            : "bg-white border-gray-200 text-[#6b7480] active:bg-gray-50")
      }
    >
      {children}
    </button>
  );
}

function AddBatchLink({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 flex h-11 items-center gap-1.5 text-[13.5px] font-semibold text-teal-700"
    >
      <Plus size={14} strokeWidth={2.4} />
      Add another manufacturing batch
    </button>
  );
}

function CountBox({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  onBlur?: () => void;
}): React.JSX.Element {
  return (
    <label className="flex flex-col items-center rounded-[10px] border border-gray-200 px-1 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">
        {label}
      </span>
      <input
        value={value ?? ""}
        inputMode="numeric"
        placeholder="0"
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={onBlur}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (v === "") return onChange(null);
          const n = Number(v);
          if (Number.isInteger(n) && n >= 0) onChange(n);
        }}
        className="mt-0.5 h-[30px] w-full min-w-0 border-0 bg-transparent text-center text-[16px] font-semibold tabular-nums text-[#1d2939] outline-none placeholder:font-normal placeholder:text-gray-300"
      />
    </label>
  );
}

/** Short / Excess. Derived, and visibly not an input. */
function ReadOnlyCount({ label, value }: { label: string; value: number }): React.JSX.Element {
  const set = value > 0;
  return (
    <div
      className={
        "flex flex-col items-center rounded-[10px] border px-1 py-1.5 " +
        (set ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50")
      }
    >
      <span
        className={
          "text-[10px] font-semibold uppercase tracking-[0.05em] " +
          (set ? "text-[#b42318]" : "text-gray-400")
        }
      >
        {label}
      </span>
      <span
        className={
          "mt-0.5 flex h-[30px] items-center text-[16px] font-semibold tabular-nums " +
          (set ? "text-[#b42318]" : "text-gray-400")
        }
      >
        {value === 0 ? "—" : value}
      </span>
    </div>
  );
}
