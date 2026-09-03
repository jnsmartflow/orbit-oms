"use client";

import { ChevronLeft } from "lucide-react";
import { CiDetailLineRows, CiLineRows } from "./line-list";
import { CiDetailsStep, CiReturnSummaryBlock } from "./details-step";
import { summariseCiDetail, summariseCiReturn } from "@/lib/ci/derive";
import {
  CARD_PAD,
  CARD_SURFACE,
  CiHeaderStrip,
  CiSectionHead,
  CiSpineRow,
  CiSpineValue,
  MUTED_NOTE,
  formatCiDay,
} from "./spine";
import type { CiBillResult, CiDetail, CiReasonOption, CiBillLine } from "@/lib/ci/types";

// One submitted CI, opened from the Submitted tab.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 VIEWABLE ALWAYS. EDITABLE ONLY WHILE 'submitted', AND ONLY BY THE
//    SUPERVISOR WHO RAISED IT (owner ruling, 2026-09-01).
// ═══════════════════════════════════════════════════════════════════════════
//
// Once 'closed' it is read-only with NO exceptions — billing has punched it
// into SAP by then and the document is real. That ruling is also the answer to
// the long-open "return to floor" question (spec §11.1): billing does not send
// a CI back, they tell the floor and HE fixes it himself.
//
// 🔴 THIS COMPONENT DECIDES NOTHING. `editable` is computed by the board from
// the server's own `status` and `supervisorId`, and the two write routes re-test
// both inside a guarded updateMany. A screen that worked it out for itself would
// be a fourth opinion about who may write.
//
// ⚠ PRESENTATION ONLY — NO STATE, NO FETCH, NO history.*. All three live in
// components/ci/submitted-board.tsx, which holds THE ONE POPSTATE AUTHORITY for
// this tab exactly as new-return.tsx does for the New tab. Two authorities on
// one screen is the bug 7b existed to fix; do not start a second one here.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE TYPE SCALE IS PICKING'S, NOT A NEW ONE (step 10)
// ═══════════════════════════════════════════════════════════════════════════
//
// The LAYOUT below was the owner's, approved from a mockup. THE NUMBERS WERE
// NOT — every size, weight and colour is lifted from a live Picking component
// and each constant names its source line. Do not nudge one locally: change it
// here, for everything that uses it, or not at all.
//
// ⚠ ONE ROLE PICKING DOES NOT HAVE: a label-left / value-right facts row. There
// is no such thing anywhere in components/picking. The NEAREST NEIGHBOUR is its
// detail stat strip (picking-board-mobile.tsx:3555-3566), whose own comment
// states exactly the discipline this screen needed — "both halves are 13px and
// only their WEIGHT separates them. Weight is the dial here, not size." So
// FACT_LABEL and FACT_VALUE are that pair: 13px throughout, medium against
// semibold, with the label taking the muted grey Picking gives a card's
// secondary line.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 LABEL LEFT, VALUE RIGHT, ON ONE ALIGNMENT SPINE
// ═══════════════════════════════════════════════════════════════════════════
//
// Every value on this screen ends on the same edge — the details card, the
// Lines heading and the billing card alike. The three-column facts grid this
// replaced left a ragged right edge and could not take a long value without
// wrapping or truncating something that mattered.
//
// 🔴 NEUTRAL. The teal header is the ONLY colour here. No violet reason block,
// no amber or green fill. Status is stated ONCE, in the header pill — a second
// statement of it in a coloured band is the same fact shouted twice, and it was
// drowning the facts underneath.
//
// 🔴 NO RUPEE VALUE, in either state. Money is billing's business; it stays on
// components/ci/ci-detail-pane.tsx and does not appear on the floor's screen.
//
// 🔴 WEIGHT DISCIPLINE: exactly TWO things carry real weight — the DEALER NAME
// on a card, and the QUANTITY on a line row. Labels are regular and grey; values
// are ONE step up and no more. The six tiny uppercase letter-spaced labels that
// used to introduce these fields were doing more visual work than the values
// they introduced, and they are gone. The section HEADING keeps that treatment,
// because a section rule is not a field label — and it is Picking's own
// (picker-my-picks-board.tsx:1925).

// ⚠ THE SCALE MOVED TO components/ci/spine.tsx (step 11), where the EDITABLE
// details step reads the same constants. It used to be declared here, and that
// is precisely why the two screens drifted: the entry step could not import
// from this file (this file imports IT — a cycle), so it re-typed its own
// values and then diverged. One module, both screens, no local overrides.

export function CiSubmittedDetail({
  detail,
  bill,
  editable,
  raced,
  materialMoved,
  onOpenMaterial,
  receivedOn,
  onReceivedOn,
  reason,
  onOpenReasons,
  remark,
  onRemark,
  returned,
  onOpenLine,
  dirty,
  saving,
  onSave,
}: {
  detail: CiDetail | null;
  /** The whole bill, fetched only when the CI is editable AND part — he needs
   *  every active line to be able to ADD one back, not just the ones already on
   *  the return. Null while loading, and on a read-only CI where it is never
   *  fetched at all. */
  bill: CiBillResult | null;
  editable: boolean;
  /** Set when a write lost the race. A band that does not go away — a toast
   *  would be gone before he looked up from the shelf. */
  raced: string | null;
  materialMoved: "moved" | "not_moved";
  /** Opens the material sheet — the board owns it, as it owns the reason one. */
  onOpenMaterial: () => void;
  receivedOn: string;
  onReceivedOn: (v: string) => void;
  reason: CiReasonOption | null;
  onOpenReasons: () => void;
  remark: string;
  onRemark: (v: string) => void;
  returned: Map<number, number>;
  onOpenLine: (line: CiBillLine) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}): React.JSX.Element {
  const closed = detail?.status === "closed";
  const isFull = detail?.returnType === "full";
  // 🔴 A FULL-BILL RETURN'S LINES ARE NOT EDITABLE, and that is not an omission.
  // "Full bill" MEANS every active line at its delivered quantity, and the lines
  // route COMPUTES that set server-side precisely so a stale phone cannot file a
  // "full" return that quietly omits a line. Ticking lines on one would be
  // silently turning it into a PART return — a different document.
  const linesEditable = editable && !isFull && bill !== null;

  return (
    <>
      {/* ── TEAL HEADER — the New flow's geometry exactly ─────────────────────
          CI number (mono) + the status pill, dealer beneath. On this screen the
          CI is the subject and the dealer is context — the reverse of the New
          flow's bill header, where the dealer is what you are choosing. */}
      <div
        className="bg-teal-600 pl-3.5 pr-1.5 pb-3.5 flex flex-col shrink-0"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            // 🔴 history.back(), NEVER a direct close. This chevron, Android's
            // hardware back and the iOS edge-swipe all run the SAME logic, and
            // that logic lives in the board's popstate handler.
            onClick={() => window.history.back()}
            aria-label="Back"
            className="w-[38px] h-[38px] rounded-[10px] bg-white/[0.16] flex items-center justify-center text-white shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[16px] font-semibold text-white truncate min-w-0">
                {detail?.ciNumber ?? "—"}
              </span>
              {/* 🔴 STATUS IS STATED HERE AND NOWHERE ELSE ON THIS SCREEN. */}
              {detail !== null && <StatusChip status={detail.status} />}
            </div>
            <div className="text-[11.5px] text-white/70 truncate">
              {detail?.customerName ?? ""}
            </div>
          </div>
        </div>
      </div>

      {/* ── WHITE STRIP — date · invoice number → litres, right ───────────────
          🔴 ONE IMPLEMENTATION, SHARED WITH THE ENTRY STEP (step 12). It was
          hand-rolled on both screens, which is where the stray separator lived —
          see CiHeaderStrip in spine.tsx.

          ⚠ THE PART/FULL TAG HAS LEFT THIS STRIP (step 10). It is the "Return"
          row in the card below now, and nothing on this screen is said twice. */}
      {/* ⚠ NO LITRES HERE ANY MORE, AND THIS SUPERSEDES STEP 13. That step
          kept them on this screen because the figure genuinely is the RETURN's
          total, unlike on the create flow where it was the bill's. What changed
          is that the "Material received" block now renders on THIS screen too,
          and states the same figure as "Quantity — N tins · N L". Two
          statements of one number on one screen is the thing this module keeps
          removing; the strip is the weaker of the two, because it cannot say
          tins. The prop is gone from CiHeaderStrip entirely rather than left
          unused — a dead parameter is an invitation. */}
      <CiHeaderStrip
        isoDate={detail?.invoiceDate ?? null}
        invoiceNo={detail?.invoiceNo ?? null}
      />

      {/* ── THE RACE BAND ────────────────────────────────────────────────────
          🔴 THE ONE EXCEPTION TO "NEUTRAL", and it earns it: billing closed this
          under him and he must not walk away thinking it saved. A BAND, not a
          toast — a toast is gone in four seconds and he is at a shelf with stock
          in his hands. It stays until he leaves, and the screen behind it has
          already flipped to read-only off a fresh fetch, so what he is told and
          what he can do agree. */}
      {raced !== null && (
        <div
          className={
            "shrink-0 bg-[#FDF4E3] border-b border-[#F0E0BE] py-2.5 flex gap-2.5 " + CARD_PAD
          }
        >
          <span className="text-[#A8620A] text-[12px] leading-[1.5] shrink-0">▲</span>
          <p className="text-[12.5px] text-[#7A4708] leading-[1.45] min-w-0">{raced}</p>
        </div>
      )}

      {detail === null ? (
        /* The New flow's skeleton — the frame slides in immediately and fills,
           rather than a tap doing nothing visible on depot wifi. */
        <div className="flex-1 px-3 pt-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[64px] bg-white rounded-[14px] mb-2 animate-pulse"
              style={{ boxShadow: "0 1px 2px rgba(16,25,29,0.04), 0 3px 12px rgba(16,25,29,0.05)" }}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ══ THE BILL'S DIVISION ═════════════════════════════════════════
              The same fact billing's pane carries in its facts row, in this
              screen's own grammar: one spine row, label left, value right.

              🔴 DIRECTLY UNDER THE STRIP, WHICH IS WHERE THE INVOICE NUMBER IS.
              On the desk it sits immediately after the "Invoice no" cell; here
              the strip IS those two bill facts, so the row beneath it is the
              same position. It is a fact about the BILL and belongs above the
              card that answers for the RETURN.

              ⚠ NOT A THIRD SEGMENT IN CiHeaderStrip. That component is shared
              with the create flow (new-return.tsx), whose bill payload carries
              no SMU at all, and the strip is a two-pole band with NO LABELS —
              a bare "70" out there says nothing, where "Division 70" does.

              ⚠ NOT A ROW INSIDE CARD 1 EITHER. That card is the four ANSWERS,
              and it is swapped for CiDetailsStep the moment the CI is editable
              — a bill fact parked inside it would vanish while he edits. This
              renders in BOTH states, exactly as the strip above it does.

              ⚠ SHOWN ON EVERY CI, "70" INCLUDED, matching the desk pane cell
              for cell — the two screens must not disagree about a bill. Null
              (no `smu` on the order, or a name the map does not carry) takes
              the em-dash every other read value on this screen uses. */}
          <div className={CARD_SURFACE + " mt-3"}>
            <CiSpineRow label="Division" last>
              <CiSpineValue>{detail.division ?? "—"}</CiSpineValue>
            </CiSpineRow>
          </div>

          {/* ══ CARD 1 · the four answers, FIRST ════════════════════════════
              Label left, value right, hairline between. When it is editable the
              New flow's own details step takes over — the same four controls he
              filled in to raise the return, so there is one way to answer them
              rather than two. */}
          {editable ? (
            <CiDetailsStep
              materialMoved={materialMoved}
              onOpenMaterial={onOpenMaterial}
              receivedOn={receivedOn}
              onReceivedOn={onReceivedOn}
              reason={reason}
              onOpenReasons={onOpenReasons}
              remark={remark}
              onRemark={onRemark}
            />
          ) : (
            /* ⚠ CARD A IS Received on · Material · Reason · Remark, AND NO
               "RETURN" ROW (step 14). It used to carry one here while the
               editable screen did not — the same fact stated in two places on
               one screen and in one place on the other. Return now lives in the
               "Material received" block below, on ALL THREE screens. */
            <div className={CARD_SURFACE + " mt-3"}>
              <CiSpineRow label="Received on">
                <CiSpineValue>{formatCiDay(detail.materialReceivedDate)}</CiSpineValue>
              </CiSpineRow>
              <CiSpineRow label="Material">
                <CiSpineValue>
                  {detail.materialMoved === "moved" ? "Moved" : "Not moved"}
                </CiSpineValue>
              </CiSpineRow>
              <CiSpineRow label="Reason" last={detail.reasonRemark === null}>
                <CiSpineValue>{detail.reasonLabel}</CiSpineValue>
              </CiSpineRow>
              {/* 🔴 HIDDEN ENTIRELY WHEN THERE IS NO REMARK (step 14) — not an
                  empty labelled row, which reads as a field that failed to load.
                  The ENTRY step keeps its always-present input, because there an
                  empty box is a control he can still type into; here it would be
                  a blank claiming to be a value.

                  It runs FULL WIDTH beneath rather than opposite a label: it is
                  a sentence, and a sentence squeezed into a value column wraps
                  into a ribbon two words wide. */}
              {detail.reasonRemark !== null && (
                <div className={CARD_PAD + " pb-3"}>
                  <p className={MUTED_NOTE}>{detail.reasonRemark}</p>
                </div>
              )}
            </div>
          )}

          {/* ══ "Material received" — THE SAME BLOCK THE ENTRY STEP RENDERS ══
              🔴 ON EVERY SCREEN, and it is the only place the return TYPE is
              stated. Editable reads from the live selection (what Save will
              store); read-only reads from the CI's own stored lines, because a
              submitted return is a record and the bill behind it may have moved.
              Both go through lib/ci/derive.ts, so no screen can show a total the
              write would not produce. */}
          <CiReturnSummaryBlock
            mode={detail.returnType === "full" ? "full" : "part"}
            totals={
              linesEditable && bill !== null
                ? summariseCiReturn(bill.lines, "part", returned)
                : summariseCiDetail(detail.lines)
            }
          />

          {/* ══ SECTION HEAD · Lines — PART ONLY ════════════════════════════
              🔴 A FULL-BILL CI SHOWS NO LINES, AND NO HEADING EITHER (step 14).
              "Full bill" means the whole invoice came back; a list adds nothing
              those two words did not say, and the "Material received" block
              above now carries the quantity — which is the thing a full return
              was previously never shown. A heading over nothing is worse than no
              heading.

              PART shows the rows, because on a part return WHICH lines came back
              IS the document.

              ⚠ `SECTION_INSET` IS `CARD_PAD` — that is the whole reason both are
              named constants. A section title and the field labels above it
              share one left edge, so the screen reads as one spine and not two
              competing margins. */}
          {!isFull && (
            <>
              <CiSectionHead
                label="Lines"
                right={`${detail.lineCount} line${detail.lineCount === 1 ? "" : "s"}`}
              />

              {/* 🔴 ONE LINE-ROW COMPONENT, in components/ci/line-list.tsx. The
                  editable screen used to draw a floating card with a 56px pack
                  gutter and the closed one a full-bleed row with the pack
                  inline — same data, two components, already drifted. Tappable
                  is a PROP now, not a second component. */}
              {linesEditable && bill !== null ? (
                <CiLineRows
                  lines={bill.lines}
                  // ⚠ ALWAYS "ALL" — THE PACK FILTER STRIP IS GONE FROM THIS
                  // SCREEN (step 14). The approved sequence has no chip strip,
                  // and the closed screen never had one: leaving it on the
                  // editable half was the last thing making the two submitted
                  // screens different objects. The filter stays on the BILL
                  // screen in the create flow, where the list is a whole bill
                  // being picked through rather than a return being corrected.
                  activePackFilter="ALL"
                  mode="part"
                  returned={returned}
                  onOpenLine={onOpenLine}
                />
              ) : (
                <CiDetailLineRows lines={detail.lines} />
              )}
            </>
          )}

          {/* ══ CARD 3 · Billing ════════════════════════════════════════════
              🔴 NO RUPEE VALUE, closed or not. The figure exists, is stored and
              sent as a STRING, and is shown on billing's own pane — it is simply
              not the floor's to read. Putting money in front of a supervisor
              invites a conversation about a number he did not enter and cannot
              change. Do not add it back "for completeness". */}
          {/* ⚠ THE RIGHT SIDE IS NOT A PILL. Status is stated once, in the
              header; this is the same neutral section-count type the Lines
              heading uses, so it reads as a caption and not a second badge. */}
          <CiSectionHead label="Billing" right={closed ? "Closed" : "Waiting"} />

          {closed ? (
            <div className={CARD_SURFACE}>
              <CiSpineRow label="CI date">
                <CiSpineValue>{formatCiDay(detail.ciDate)}</CiSpineValue>
              </CiSpineRow>
              <CiSpineRow label="CI number" last>
                <CiSpineValue mono>{detail.sapCiNumber ?? "—"}</CiSpineValue>
              </CiSpineRow>
              {/* A FOOTER LINE, not a row — it names a PERSON, and a name sitting
                  opposite a label reads as a field he might be able to edit. */}
              <div className={CARD_PAD + " pb-3"}>
                <p className={MUTED_NOTE}>Closed by {detail.billingOperatorName ?? "—"}</p>
              </div>
            </div>
          ) : (
            <div className={CARD_SURFACE + " " + CARD_PAD + " py-3.5"}>
              <p className={MUTED_NOTE}>Not punched yet.</p>
            </div>
          )}

          {/* Breathing room above the save pill, which is fixed over this. */}
          <div className="h-24" />
        </div>
      )}

      {/* ── SAVE ────────────────────────────────────────────────────────────
          Present only while editing, and DISABLED until something actually
          changed — a live Save on an untouched CI invites a pointless write that
          would bump `updatedAt` and shake billing's rail for nothing. */}
      {editable && detail !== null && (
        <div
          className="shrink-0 bg-white border-t border-gray-200 px-3.5 pt-2.5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
        >
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className={
              "w-full h-12 rounded-full text-[15px] font-bold " +
              (dirty && !saving
                ? "bg-teal-600 active:bg-teal-700 text-white shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
                : "bg-gray-100 text-gray-400")
            }
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
          </button>
        </div>
      )}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: CiDetail["status"] }): React.JSX.Element {
  // ⚠ WHITE-ALPHA, NOT the card's amber/green pills — this one sits ON THE TEAL
  // HEADER, where a coloured pill reads as a sticker. The WORD carries the
  // status, as everywhere else in this module.
  const label =
    status === "closed"
      ? "Done"
      : status === "returned_to_floor"
        ? "Sent back"
        : "With billing";
  return (
    <span className="shrink-0 rounded-full bg-white/[0.18] px-2 py-[2px] text-[10.5px] font-semibold text-white whitespace-nowrap">
      {label}
    </span>
  );
}

