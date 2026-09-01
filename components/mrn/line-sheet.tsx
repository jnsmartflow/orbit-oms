"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Camera, Minus, Plus, X } from "lucide-react";
import {
  excessQty,
  shortQty,
  validateBatches,
  validateConditionCounts,
} from "@/lib/mrn/derive";
import type { MrnBatchInput, MrnDetailLine } from "@/lib/mrn/types";
import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-open";
import { MRN_PHOTO_KIND_LABEL, type MrnPhotoKind } from "@/lib/mrn/photo";
import { MrnPhotoCapture, PhotoKindSheet } from "./photo-capture";
import { describeWriteError } from "./modal-shell";

// The line sheet — the heart of the module.
//
// ⚠️ THE SPEC IS docs/mockups/mrn/03-line-sheet.html, frames L1-L5. It
// SUPERSEDES 02-supervisor-mobile.html's S7 / S7b / S8, which drew a bottom
// sheet with native dropdowns and a best-before pair — all three are STALE and
// must not be rebuilt from. The new mock's ALT frame (a recent-months shortcut
// row) is an idea for later and is deliberately NOT built.
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

  // ── Photos on this line ───────────────────────────────────────────────────
  //
  // ⚠ COUNTED FROM THE SERVER, NOT FROM THIS SESSION. Re-opening a line he
  // photographed ten minutes ago must show the photos it already carries, not
  // zero — otherwise the count reads as "your save was lost" and he takes it
  // again. The fetch is fire-and-forget: a photo count is not worth blocking
  // the sheet on, and a failure simply leaves it unknown rather than wrong.
  //
  // ⚠ NOT ON MrnDetailLine. The board payload deliberately does not carry
  // photos — billing's face loads them separately (step 6) and the phone has no
  // use for the metadata, only the count. Widening the board payload for this
  // would put a join on every card render.
  const [photoCount, setPhotoCount] = useState<number | null>(null);
  const [kindSheet, setKindSheet] = useState(false);
  const [capturingKind, setCapturingKind] = useState<MrnPhotoKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/mrn/${mrnId}/photos`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { photos: { lineId: number | null }[] };
        if (cancelled) return;
        setPhotoCount(json.photos.filter((ph) => ph.lineId === line.id).length);
      } catch {
        // Leave it null — "unknown" renders as no badge, which is honest. A 0
        // here would claim there are none.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mrnId, line.id]);

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
      {/* ── HEADER BAND ─────────────────────────────────────────────────────
          🔴 THE SAFE-AREA INSET IS INSIDE THIS BAND'S OWN PADDING, and that is
          the whole fix. app/layout.tsx sets `viewportFit: "cover"` app-wide
          (CLAUDE_UI.md §55), which tells iOS to paint the page BENEATH the
          status bar and the notch — so every full-screen surface has to reserve
          that space itself. This header had a bare `pt-3`: the right 12px
          floor, but no `env()`, so on an iPhone the product title drew under
          the clock and the ✕ under the battery icon.
          `max(env(safe-area-inset-top, 0px), 12px)` is the SAME shape the MRN
          detail screen uses (supervisor-board.tsx), and the same shape both
          picking boards and ModuleMobileHeader use — a deliberate app-wide
          convention, not an accident of one screen. The 0px fallback matters:
          Android and desktop report no inset, and a bare `env()` there would
          collapse to nothing.
          The band is `shrink-0` inside the `flex flex-col` root and carries its
          own white ground, so the scrolling body passes UNDER it and can never
          appear in the inset. */}
      <div
        className="shrink-0 border-b border-[#eceff2] bg-white px-4 pb-3"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
      >
        <div className="flex items-start gap-2">
          {/* ⚠ THE SKU IS THE HERO, THE NAME CONFIRMS — swapped 2026-08-22, and
              this is the SAME rule the line list follows: he matches the CODE
              against the tin in his hand, then reads the name to check he
              opened the right one. It was the other way round, which made the
              thing he is actually looking for the small grey line.
              It also costs less height: a long product name used to wrap the
              hero onto three lines, and as a single truncated line beneath it
              can only ever be two. */}
          <div className="min-w-0 flex-1">
            {/* Row 1 — mono SKU large and bold, meta trailing it on the same
                baseline. `items-baseline` is what keeps the 12.5px meta sitting
                on the 20px code's baseline rather than centred against it. */}
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-mono text-[20px] font-bold leading-tight text-gray-900">
                {line.skuCode}
              </span>
              <span className="text-[12.5px] text-[#98a2b3]">
                {line.pack && `· ${line.pack} `}· line {position.index} of {position.total}
              </span>
            </div>
            {/* Row 2 — the product name, demoted. ONE line: `truncate` needs the
                `min-w-0` on the flex parent above to actually ellipsis rather
                than push the ✕ off the row. */}
            <div className="mt-0.5 truncate text-[12.5px] text-gray-500">
              {line.isCatalogued ? line.description : "Not in catalog"}
            </div>
          </div>
          {/* Routes through the SAME onClose as Cancel and the hardware back —
              see the block comment above. 44px tap target (UI §60). */}
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            aria-label="Close"
            // RED (mock L1): a #fef2f2 disc with a #dc2626 glyph, 34px. The
            // 44px tap target is preserved by the wrapper, so the visible disc
            // can be small without the target being.
            className="flex h-11 w-11 shrink-0 items-center justify-center"
          >
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#fef2f2] text-[#dc2626] active:bg-[#fde4e4]">
              <X size={17} strokeWidth={2.4} />
            </span>
          </button>
        </div>
      </div>

      {/* The BODY scrolls UNDER the pinned band above. Padding is the mock’s
          .body exactly: 14px 16px 20px. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-3.5">
          {/* ── Physical qty ─────────────────────────────────────────────── */}
          {/* No top margin: the header is a real bordered band now and the body
              carries the mock’s own 14px of top padding. */}
          <Label>Physical qty received</Label>
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

          {/* ⚠ THE NEUTRAL HELPER IS GONE (2026-08-22, mock L1). It read
              "Matches the STI qty of N. Change it only if the count differs."
              and sat under the stepper on EVERY untouched line — a sentence
              present at rest, telling him nothing he could act on. The RED one
              stays: "3 less than the STI qty of 32 → recorded as Short 3" names
              a consequence he has just caused, and it is the only warning that
              a mis-tap on the stepper produces. */}
          {(short > 0 || excess > 0) && (
            <p className="mt-[7px] text-[11.5px] font-semibold leading-[1.5] text-[#b42318]">
              {short > 0
                ? `${short} less than the STI qty of ${line.qtySti} → recorded as Short ${short}.`
                : `${excess} more than the STI qty of ${line.qtySti} → recorded as Excess ${excess}.`}
            </p>
          )}

          {/* ── Manufacturing ────────────────────────────────────────────────
              ⚠ NO SECTION LABEL. "MANUFACTURING" (and its
              "Manufacturing · N batches" variant) were removed per mock L1/L4 —
              the block describes itself, the caption underneath names its two
              halves, and the batch cards carry their own "Batch 1 / Batch 2"
              headers. The 20px top margin is what separates it from the
              stepper now that no label does. */}
          {physicalQty === 0 ? (
            // Nothing arrived. No batch, no month, and the whole date block
            // disappears — mock L5, design §11 OQ-4.
            <div className="mt-[18px] flex gap-[9px] rounded-[11px] border border-gray-200 bg-[#f7f8fa] px-[13px] py-[11px] text-[12.5px] font-medium leading-[1.5] text-[#667085]">
              Nothing was received on this line, so it carries no manufacturing batch.
            </div>
          ) : !split ? (
            <>
              <div className="mt-5">
                <DateBlock
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
                <DateCaption />
              </div>

              <AddBatchLink onClick={addBatch} />
            </>
          ) : (
            <>
              {batches.map((b, i) => (
                // .bcard — the first card carries no top margin because the
                // stepper's own 20px already separates them (mock L4).
                <div
                  key={b.key}
                  className={
                    "rounded-[12px] border border-gray-200 bg-[#fcfcfd] px-3 pb-3 pt-[11px] " +
                    (i === 0 ? "mt-5" : "mt-2.5")
                  }
                >
                  <div className="mb-[9px] flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.05em] text-gray-400">
                    Batch {i + 1}
                    <button
                      type="button"
                      onClick={() => removeBatch(b.key)}
                      aria-label={`Remove batch ${i + 1}`}
                      className="-mr-2 flex h-11 w-11 items-center justify-center text-[#c2c8d0] active:text-[#b42318]"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="mb-[9px] flex items-center gap-[9px]">
                    <span className="w-[34px] shrink-0 text-[10.5px] font-bold uppercase tracking-[0.05em] text-gray-400">
                      Qty
                    </span>
                    <input
                      value={b.qty}
                      inputMode="numeric"
                      aria-label={`Batch ${i + 1} quantity`}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        const n = v === "" ? 0 : Number(v);
                        if (Number.isInteger(n) && n >= 0) {
                          setBatch(b.key, { qty: n });
                          setTouched(true);
                        }
                      }}
                      className="h-[42px] min-w-0 flex-1 rounded-[10px] border border-gray-200 bg-white text-center text-[18px] font-bold tabular-nums text-[#1d2939] outline-none"
                    />
                  </div>

                  {/* The SAME block as the unsplit case — one implementation,
                      so a split line cannot drift from a plain one. No caption
                      inside a card; the first card's caption would repeat on
                      every one. */}
                  <DateBlock
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
                  "mt-[11px] flex items-center justify-between rounded-[10px] border px-3 py-[9px] text-[12.5px] font-semibold " +
                  (batchCheck.ok
                    ? "border-green-200 bg-green-50 text-green-700"
                    : showValidation
                      ? "border-red-200 bg-red-50 text-[#b42318]"
                      : "border-gray-200 bg-gray-50 text-[#667085]")
                }
              >
                <span className="tabular-nums">
                  {batches.map((b) => b.qty).join(" + ")} = {batchCheck.actual}
                </span>
                <span>
                  {batchCheck.ok ? "matches qty received ✓" : `needs ${batchCheck.expected}`}
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
              {/* ⚠ FOUR COLUMNS, JOINED CELLS — was a 3-wide grid of separate
                  boxes with gaps. Eight cells over four columns is exactly two
                  rows, and its dividers line up with the date block above, so
                  the sheet sits on ONE column rhythm instead of three
                  competing ones (mock L3). Same border/divider treatment as
                  DateBlock: one outer border, 1px internal rules, corners
                  clipped by overflow-hidden, no gaps anywhere.
                  Order is fixed: SND · Lky · Dmg · Emp / QTD · REJ · Short ·
                  Excess — the two derived cells land in the bottom row on the
                  tinted ground, which is what makes them read as not-inputs. */}
              <div className="mt-2.5 grid grid-cols-4 overflow-hidden rounded-[12px] border border-[#dfe3e8]">
                {COUNT_KEYS.map((c, i) => (
                  <CountCell
                    key={c.key}
                    label={c.label}
                    value={counts[c.key]}
                    onChange={(v) => setCounts((p) => ({ ...p, [c.key]: v }))}
                    onBlur={() => setTouched(true)}
                    noRightBorder={(i + 1) % 4 === 0}
                    noBottomBorder={i >= 4}
                  />
                ))}
                {/* 🔴 READ-ONLY. Derived from the stepper above by derive.ts —
                    they have no columns of their own and must never become
                    inputs (§11 OQ-2). Shown so he can see the consequence of
                    the number he just typed. Cells 7 and 8, so both sit on the
                    bottom row with no bottom border. */}
                <ReadOnlyCell label="Short" value={short} />
                <ReadOnlyCell label="Excess" value={excess} noRightBorder />
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

          {/* ── Photos ───────────────────────────────────────────────────────
              🔴 ALWAYS ENABLED. Never gated on a condition count being
              non-zero: he is standing in front of a leaking tin, and making him
              type a number before he can photograph it inverts the real
              sequence. The photo is often how he works out what the number
              should be.

              ⚠ THE WORD "Batch" IS FORBIDDEN ON THIS BUTTON AND ITS SHEETS.
              This same screen already says "Batch 1 / Batch 2" for the first
              and second MANUFACTURING group; a second meaning for that word,
              inches away, would be read as the first. It is "photo", or the
              kind's own name. */}
          <button
            type="button"
            onClick={() => setKindSheet(true)}
            className="mt-2.5 flex w-full items-center gap-3 rounded-[13px] border border-gray-200 px-3 py-3 text-left active:bg-gray-50"
          >
            <Camera size={18} className="shrink-0 text-[#667085]" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[#1d2939]">Add a photo</div>
              <div className="mt-0.5 text-[12px] text-[#98a2b3]">
                {photoCount === null
                  ? "Leaky, damaged, anything worth showing billing"
                  : photoCount === 0
                    ? "Leaky, damaged, anything worth showing billing"
                    : `${photoCount} photo${photoCount === 1 ? "" : "s"} on this line`}
              </div>
            </div>
            {/* The count rides on the row itself so a save he just made is
                visible without opening anything. A save he cannot see is a save
                he will make twice. */}
            {photoCount !== null && photoCount > 0 && (
              <span className="shrink-0 rounded-[6px] bg-teal-50 px-[7px] py-[3px] text-[12px] font-bold text-teal-700">
                {photoCount}
              </span>
            )}
          </button>

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

      {/* ── Photo capture ─────────────────────────────────────
          Both overlays sit INSIDE this sheet's root and above it in z-order,
          so the line stays mounted underneath: the physical qty, the batches
          and the counts he has already typed are still there when the camera
          closes. Unmounting the sheet to take a photo would throw all of that
          away.

          ⚠ ORDER MATTERS — the kind is chosen BEFORE the camera opens, never
          after. Asking "what was that?" once he has already taken the shot
          invites the wrong answer, and the kind is what billing filters on. */}
      {kindSheet && (
        <PhotoKindSheet
          onPick={(k) => {
            setKindSheet(false);
            setCapturingKind(k);
          }}
          onCancel={() => setKindSheet(false)}
        />
      )}

      {capturingKind && (
        <MrnPhotoCapture
          mrnId={mrnId}
          lineId={line.id}
          kind={capturingKind}
          title={`${MRN_PHOTO_KIND_LABEL[capturingKind]} photo · line ${line.lineNo}`}
          onUploaded={() => {
            // Optimistic +1 rather than a refetch: the row is on the server (a
            // 201 is what got us here), and a second round trip to learn a
            // number we already know would leave the count stale for a beat on
            // a slow depot connection. The null-coalesce covers the case where
            // the initial count fetch failed — one photo he just took is a
            // better answer than none.
            setPhotoCount((n) => (n ?? 0) + 1);
            setCapturingKind(null);
          }}
          onCancel={() => setCapturingKind(null)}
        />
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
/**
 * ONE 4-COLUMN BLOCK — year on the top row, months on the three beneath.
 *
 * ⚠️ THIS REPLACED A YEAR STRIP PLUS A SEPARATE MONTH GRID (2026-08-22, mock
 * L1). Four year chips could never line up with a six-column month grid because
 * they were two controls; joining them into one 4-column grid makes every
 * vertical divider run the full height BY CONSTRUCTION rather than by matching
 * two sets of widths by hand. It also reads as a small calendar instead of two
 * unrelated strips.
 *
 * ⚠️ THE MOCK IS docs/mockups/mrn/03-line-sheet.html (frames L1-L5). It
 * SUPERSEDES 02-supervisor-mobile.html's S7 / S7b / S8, which drew the old
 * bottom sheet with dropdowns and a best-before pair — all three are stale and
 * must not be rebuilt from. The ALT frame in the new mock (a recent-months
 * shortcut row) is an idea for later and is deliberately NOT built.
 *
 * 🔴 THE RANGES ARE THE VALIDATION. Nothing downstream judges a year —
 * validateBatches deliberately declines to, and there is no DB constraint — so
 * this control is the guard:
 *   • YEAR — exactly four cells, currentYear − 3 … currentYear. A manufacturing
 *     date cannot be in the future, and the depot does not receive stock older
 *     than three years.
 *   • MONTH — when the selected year IS the current year, months after the
 *     current month are DISABLED, recomputed on every year tap. Picking an
 *     earlier year re-enables all twelve.
 *
 * 🔴 `disabled` IS A REAL ATTRIBUTE, not just the #d6dade colour. A future month
 * must be genuinely unpressable — styling alone leaves it tappable, and a tap
 * that silently does nothing reads as a broken screen.
 *
 * Geometry, from the mock: 46px cells, one outer border #dfe3e8 at radius 12,
 * 1px internal rules #e6eaee, corners clipped by overflow-hidden, NO gaps. The
 * year row is tinted #f6f8f9 so it reads as its own band; months are white.
 * Selected is #1d2939 with white bold text.
 *
 * The clock is read ONCE per mount. A sheet left open across midnight on 31 Dec
 * keeps the year list it opened with, which is right — re-deriving mid-edit
 * could disable a month he had already chosen.
 */
function DateBlock({
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

  // Only the CURRENT year can have unreachable months; any earlier year is
  // wholly in the past, so all twelve are live.
  const maxMonth = year === thisYear ? thisMonth : 12;

  // Every cell: 46px, centred, tabular. The right border is dropped on column 4
  // and the bottom border on the last row, so the outer border is never
  // doubled.
  const cell =
    "h-[46px] flex items-center justify-center font-semibold tabular-nums border-r border-b border-[#e6eaee]";

  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-[12px] border border-[#dfe3e8]">
      {years.map((y, i) => {
        const on = year === y;
        return (
          <button
            key={y}
            type="button"
            aria-pressed={on}
            onClick={() => onYear(y)}
            className={
              cell +
              " text-[14.5px] tracking-[0.01em] " +
              // The year row's bottom rule is the DARKER outer colour, so the
              // band reads as separated from the months rather than as a
              // fourth month row.
              "border-b-[#dfe3e8] " +
              (i === 3 ? "border-r-0 " : "") +
              (on ? "bg-[#1d2939] font-bold text-white" : "bg-[#f6f8f9] text-[#475467]")
            }
          >
            {y}
          </button>
        );
      })}

      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const on = month === m;
        const disabled = m > maxMonth;
        return (
          <button
            key={m}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            aria-label={`Month ${m}`}
            onClick={() => onMonth(m)}
            className={
              cell +
              " text-[15.5px] " +
              (m % 4 === 0 ? "border-r-0 " : "") +
              (m >= 9 ? "border-b-0 " : "") +
              (on
                ? "bg-[#1d2939] font-bold text-white"
                : disabled
                  ? "cursor-not-allowed bg-[#fbfcfd] text-[#d6dade]"
                  : "bg-white text-[#475467]")
            }
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

/** The one-line legend under the block. It earns its place on someone's first
 *  day — two rows of numbers with no headers are ambiguous until you have used
 *  it once — and costs a single 10px line after that. */
function DateCaption(): React.JSX.Element {
  return (
    <div className="mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-[0.04em] text-[#b6bcc4]">
      <span>Year on top</span>
      <span>Month below</span>
    </div>
  );
}

function AddBatchLink({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3.5 flex h-11 items-center gap-1.5 text-[13.5px] font-semibold text-teal-700"
    >
      <Plus size={13} strokeWidth={2.6} />
      Add another manufacturing batch
    </button>
  );
}

/**
 * One TYPED condition count, as a joined cell in the 4-column grid.
 *
 * The borders are passed in rather than derived with nth-child, because two of
 * the eight cells (Short / Excess) are a different component — a CSS rule
 * keyed on position would have to know about both.
 */
function CountCell({
  label,
  value,
  onChange,
  onBlur,
  noRightBorder,
  noBottomBorder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  onBlur?: () => void;
  noRightBorder?: boolean;
  noBottomBorder?: boolean;
}): React.JSX.Element {
  const set = value !== null && value > 0;
  return (
    <label
      className={
        "flex flex-col items-center bg-white px-1 pb-[9px] pt-2 text-center border-[#e6eaee] " +
        (noRightBorder ? "" : "border-r ") +
        (noBottomBorder ? "" : "border-b")
      }
    >
      <span
        className={
          "text-[9.5px] font-bold uppercase tracking-[0.05em] " +
          (set ? "text-[#b42318]" : "text-gray-400")
        }
      >
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
        // text-[16px] would be the iOS rule, but the mock's value type here is
        // 19px — larger, so the zoom guard holds comfortably (UI §9).
        className={
          "mt-0.5 w-full min-w-0 border-0 bg-transparent text-center text-[19px] font-bold tabular-nums outline-none placeholder:font-bold placeholder:text-[#c2c8d0] " +
          (set ? "text-[#b42318]" : "text-[#c2c8d0]")
        }
      />
    </label>
  );
}

/** Short / Excess — DERIVED, and visibly not an input: tinted ground, no field,
 *  no caret. Bottom row of the grid, so neither carries a bottom border. */
function ReadOnlyCell({
  label,
  value,
  noRightBorder,
}: {
  label: string;
  value: number;
  noRightBorder?: boolean;
}): React.JSX.Element {
  const set = value > 0;
  return (
    <div
      className={
        "bg-[#f6f8f9] px-1 pb-[9px] pt-2 text-center border-[#e6eaee] " +
        (noRightBorder ? "" : "border-r")
      }
    >
      <div
        className={
          "text-[9.5px] font-bold uppercase tracking-[0.05em] " +
          (set ? "text-[#b42318]" : "text-[#b0b6bf]")
        }
      >
        {label}
      </div>
      <div
        className={
          "mt-0.5 text-[19px] font-bold tabular-nums " +
          (set ? "text-[#b42318]" : "text-[#667085]")
        }
      >
        {value === 0 ? "0" : value}
      </div>
    </div>
  );
}
