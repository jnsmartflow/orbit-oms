"use client";

// Floor Control — the left-rail card. Layout/copy authority:
// docs/mockups/floor-control/04-card-spec.html (+ 01-board.html). Colour is
// carried by ICONS and TEXT only — no paint on the card; status colour is
// reserved for the floor's status pills (design §6.2).
//
// Actions — THREE controls on one line (04-card-spec §"acts"), in one of two
// shapes depending on whether the bill has an engine suggestion:
//
//  A. WITH a suggestion (releasable && card.suggestion != null) —
//     [ ✓ {Today|Wed 05} {window} ▾ ] [ Hold ] [ ✕ ]
//     A teal SPLIT button. The body confirms the suggested slot in one click;
//     the caret opens the same shared picker to choose another. Both ends funnel
//     into the SAME onRelease the picker has always called, so there is exactly
//     one release path — the button is a shortcut through it, never around it.
//     Teal-600 (#7C3AED, the mockup's .bt) is the ONLY filled element on the
//     card; everything else stays icon/text colour (design §6.2, UI §1/§2).
//
//  B. WITHOUT one — [ pick slot ] [ Hold ] [ ✕ ], byte-identical to before:
//     the shared picker used AS-IS, its own "pick slot" pill being the whole
//     slot control. A non-tint card also gets a quiet grey "Why no slot?" link
//     explaining the decline (derived client-side from deliveryType — no backend
//     call). Tint cards do NOT get that link: their tint strip already says what
//     is happening, and completion-anchored tint suggestions are a later phase,
//     so "no slot suggested" would read as a fault rather than a not-yet.
//
//  - Hold → /api/floor/actions "hold" (dispatchStatus 'hold' + heldAt).
//    ✕ → /api/floor/actions "cancel" (workflowStage 'cancelled'). Wired Step 5.
//  - Hold and ✕ are DISABLED (visible, greyed, with a hover reason) on any tint
//    bill whose tinting is NOT FINISHED — waiting, assigned or mixing. Only
//    "ready" (pending_support) is still actionable. Cancelling an unfinished one
//    strands it past the tint stage on restore and can jam the operator's
//    machine; see the tintLocked block below for the live incidents and for why
//    the predicate is the TINT state and not `!releasable`.
//  - A bill is releasable only at pending_support (a non-tint bill, or a tint
//    bill whose shades are all done). On a mid-tint bill the picker is DIMMED
//    (disabled) — that IS the dimmed state; there is no separate greyed button.
//    A non-releasable bill therefore always takes shape B, suggestion or not.

import { useState } from "react";
import { Droplet, Mail } from "lucide-react";
import {
  DispatchSlotPicker,
  type DispatchWindow,
  type DispatchSlotValue,
} from "@/components/floor/dispatch-slot-picker";
import { getTodayIST } from "@/lib/dates";
import { TintStrip } from "./tint-strip";
import {
  DuplicateSoTag,
  DUP_SO_SOFT_BAR,
  DUP_SO_SOFT_BORDER,
  DUP_SO_SOFT_SURFACE,
} from "@/components/shared/duplicate-so-tag";
import type { FloorRailCard as RailCardData } from "@/lib/floor/types";

export interface RailReleaseSlot {
  dispatchTargetDate: string;
  dispatchWindowId: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Suggested day as the button reads it: "Today", else "Wed 05". Parsed as a
 *  UTC calendar date (same Date.UTC construction the picker's day strip uses),
 *  so the weekday can never drift by a timezone hour. */
function fmtSuggestionDay(iso: string, todayIso: string): string {
  if (iso === todayIso) return "Today";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${String(d).padStart(2, "0")}`;
}

/** Why the engine declined — read off the SAME field the engine gated on
 *  (delivery type), so the copy can never contradict the decision. Neutral and
 *  grey: a missing suggestion is a "you decide", not an error. */
function whyNoSlot(deliveryType: string | null): string {
  if (deliveryType === "IGT" || deliveryType === "Cross") {
    return "IGT / Cross aren't auto-slotted — pick a slot.";
  }
  if (!deliveryType) return "No route / delivery type — pick a slot.";
  return "No slot suggested — pick a slot.";
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    })
    .replace(",", "");
}

export function RailCard({
  card,
  windows,
  onRelease,
  onHold,
  onCancel,
  onOpenDetail,
  highlighted = false,
}: {
  card: RailCardData;
  windows: DispatchWindow[];
  onRelease: (orderId: number, slot: RailReleaseSlot) => void;
  onHold: (orderId: number) => void;
  onCancel: (orderId: number) => void;
  onOpenDetail: (orderId: number) => void;
  // Search match — a subtle ink-900 accent. The card is NEVER hidden by search.
  highlighted?: boolean;
}) {
  const releasable = card.workflowStage === "pending_support";
  const dropletReady = card.tint?.stage === "ready";

  // ── TINT LOCK (2026-09-08, widened same day) ──────────────────────────
  // Hold and ✕ acted on the order row only and never looked at the tint side.
  // Live incidents, all repaired by hand in SQL: OBD 9109265718 (2026-09-02) was
  // cancelled mid-tint, came back from Restore at pending_support and Release
  // then pushed it to pending_picking — jumping the tint stage and vanishing
  // from Tint Manager; OBD 9109367531 (2026-09-08) was cancelled NINE MINUTES
  // after Start and left tint_assignments at 'tinting_in_progress' while the job
  // disappeared from the operator's queue, so he could neither finish it nor
  // start anything else — the start-guard then blocked every new job on an
  // invisible one. Further bills were found stranded the same way that day.
  //
  // THE RULE IS "TINTING NOT FINISHED", not "an operator is attached". The first
  // cut of this lock left "waiting" (pending_tint_assignment) open on the
  // grounds that nobody was holding paint there yet. That was WRONG, and
  // 9109265718 is the proof: Floor's RESTORE always writes 'pending_support' —
  // it does NOT return a bill to the stage it was cancelled from — so a bill
  // cancelled at "waiting" also lands PAST the tint stage on restore and also
  // disappears from Tint Manager. The operator is irrelevant; the one-way
  // restore is the damage.
  //
  // The predicate is the TINT state, deliberately NOT `!releasable`. Those are
  // different questions: `!releasable` is true for ANY rail bill short of
  // pending_support, including a non-tint bill at order_created, which has no
  // tint stage to be stranded past. `stage` covers all three OPEN assignment
  // statuses: 'assigned' → "assigned", and BOTH 'tinting_in_progress' and
  // 'paused' → "mixing", because pause/resume write the assignment row only and
  // leave orders.workflowStage at 'tinting_in_progress' (CLAUDE_TINT §5).
  //
  // ONLY "ready" (pending_support) stays UNLOCKED, and it must: the tinting is
  // finished, there is no tint stage left to strand the bill behind, and the
  // floor has to be able to hold, cancel or release it. DO NOT WIDEN PAST THIS.
  const tintLocked =
    card.tint !== null &&
    (card.tint.stage === "waiting" ||
      card.tint.stage === "assigned" ||
      card.tint.stage === "mixing");
  // undefined when unlocked, so the wrapper renders no title attribute at all.
  const tintLockReason = !tintLocked
    ? undefined
    : card.tint?.stage === "mixing"
      ? "Tinting in progress — cancel from Tint Manager"
      : card.tint?.stage === "assigned"
        ? "Assigned to a tint operator — cancel from Tint Manager"
        : "Tint order not yet assigned — cancel from Tint Manager";

  // Gen counter that opens the shared picker programmatically — same mechanism
  // the assign bar and detail panel use. Bumped by the caret, and by a body tap
  // whose window has since been deactivated.
  const [slotGen, setSlotGen] = useState(0);
  const [whyOpen, setWhyOpen] = useState(false);

  const suggestion = card.suggestion;
  const showSuggestion = releasable && suggestion !== null;
  // The link is for bills the engine COULD have slotted and didn't. Tint bills
  // are excluded by design — see the header note.
  const showWhy = suggestion === null && !card.isTint;

  // windowTime → dispatch_slot_master id. `undefined` means the window has been
  // deactivated since the suggestion was computed, which is the one case where
  // the body must NOT post.
  const suggestedWindowId = suggestion
    ? windows.find((w) => w.windowTime === suggestion.windowTime)?.id
    : undefined;

  // Highlight payload for the picker. dispatchWindowId -1 is deliberate: when the
  // window no longer exists it matches no real id, so the popover highlights the
  // suggested DAY and leaves every window pill unselected — honest, rather than
  // pointing at a window that is gone.
  const suggestedValue: DispatchSlotValue | null = suggestion
    ? {
        date: suggestion.targetDate,
        dispatchWindowId: suggestedWindowId ?? -1,
        windowTime: suggestion.windowTime,
      }
    : null;

  const suggestionDay = suggestion ? fmtSuggestionDay(suggestion.targetDate, getTodayIST()) : "";

  // ── Duplicate-SO, SOFT variant ────────────────────────────────────────────
  // ⚠ SEARCH-HIGHLIGHT ON A DUPLICATE. Normally a match is an ink-900 border + ring
  // ring. Under the old solid fill the border was spoken for by the red, so a
  // highlighted duplicate had to take a WHITE border and keep the ring outside
  // the box. The soft variant frees the border again — the duplicate signal now
  // lives on the INSET accent, which cannot collide with a border or a ring — so
  // a highlighted duplicate takes ink-900 on the border AND keeps its red bar,
  // and both states read independently without either being disguised. The
  // rail's list padding is p-2.5 (10px), which still clears the 4px ring.
  const dup = card.hasDuplicateSo;
  // SOFT variant (2026-08-25): a red-50 wash, a red-200 hairline and a 3px
  // red-500 LEFT ACCENT as an inset shadow — the card form of the floor row.
  // Everything ON the card keeps its ordinary colours, so the ⚡, the ★, the
  // tint droplet and the Hold/✕ buttons no longer have to be flipped to white.
  // Search highlight still wins the BORDER and adds its outer ring; the inset
  // accent lives inside the box, so the two states stack instead of fighting.
  const cardStyle: React.CSSProperties | undefined = dup
    ? {
        background: DUP_SO_SOFT_SURFACE,
        borderColor: highlighted ? "#1B1826" : DUP_SO_SOFT_BORDER,
        // The bar comes from the shared constant, never a re-typed hex — the
        // file-top rule in duplicate-so-tag.tsx. On a search hit it is prepended
        // to the ring so one boxShadow carries both.
        boxShadow: highlighted
          ? `${DUP_SO_SOFT_BAR}, 0 0 0 2px #ffffff, 0 0 0 4px #1B1826`
          : DUP_SO_SOFT_BAR,
      }
    : undefined;

  function confirmSuggestion() {
    if (!suggestion) return;
    if (suggestedWindowId === undefined) {
      // Never post a bogus id — hand the operator the picker instead.
      setSlotGen((g) => g + 1);
      return;
    }
    onRelease(card.orderId, {
      dispatchTargetDate: suggestion.targetDate,
      dispatchWindowId: suggestedWindowId,
    });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(card.orderId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail(card.orderId);
        }
      }}
      className={
        "mb-2 cursor-pointer rounded-lg border px-3 py-[11px] transition-colors " +
        (dup
          ? // Colours come from cardStyle so the wash + accent beat the
            // highlight classes; the ring is folded into that same boxShadow.
            ""
          : highlighted
            ? "bg-white border-ink-900 ring-2 ring-ink-900/25"
            : "bg-white border-gray-200 hover:border-gray-300")
      }
      style={cardStyle}
    >
      {/* OBD · time · icons (fixed order: age → ★ → ⚡ → droplet) */}
      <div className="flex items-center gap-2">
        <span
          className={"font-mono text-[11.5px] tracking-[-0.01em] " + "text-gray-700"}
         
        >
          {card.obdNumber}
        </span>
        <span className={"text-[10.5px] " + "text-gray-400"}>
          {fmtWhen(card.obdDateTime)}
        </span>
        {card.isEmailTime && (
          <span title="Email time" className="inline-flex shrink-0">
            <Mail size={10.5} className="text-gray-400" />
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {/* The tag leads the icon cluster — it is why the card is red. */}
          {dup && <DuplicateSoTag variant="soft" />}
          {card.ageDays > 0 && (
            <span
              className={
                "rounded-[3px] px-[5px] py-px text-[9.5px] font-bold leading-[1.5] " +
                "bg-gray-100 text-gray-500"
              }
            >
              {card.ageDays}d
            </span>
          )}
          {/* ★ amber and ⚡ red both die on the fill — white glyphs on a
              duplicate, shapes unchanged so the two stay tellable apart. */}
          {card.isKeyCustomer && (
            <span className="text-[12px] leading-none" style={{ color: "#f59e0b" }}>
              ★
            </span>
          )}
          {card.priorityLevel === 1 && (
            <span className="text-[12px] leading-none" style={{ color: "#ef4444" }}>
              ⚡
            </span>
          )}
          {card.isTint && (
            <Droplet
              size={13}
              className={dropletReady ? "text-[#16a34a]" : "text-tint-600"}
             
            />
          )}
        </span>
      </div>

      {/* Customer (original ship-to) — largest thing on the card */}
      <div
        className={"mt-1.5 text-[14px] font-bold leading-[1.3] " + "text-gray-900"}
       
      >
        {card.customerName ?? card.dealerName}
      </div>

      {/* Route · Vol */}
      <div className={"mt-[3px] text-[11.5px] " + "text-gray-600"}>
        {card.route ?? "—"}{" "}
        <span className="text-gray-400">
          &middot; {card.volumeLitres ?? 0} L
        </span>
      </div>

      {/* Ship-to override line — override only (04-card-spec §4) */}
      {card.isShipToOverride && card.shipToOverrideName && (
        <div className={"mt-[3px] text-[11px] " + "text-gray-600"}>
          Ship to{" "}
          <b className={"font-semibold " + "text-gray-700"}>
            {card.shipToOverrideName}
          </b>
        </div>
      )}

      {/* Tint strip (tint bills only) */}
      {card.tint && <TintStrip tint={card.tint} />}

      {/* Actions — three controls, one line (04-card-spec). Shape A or B per the
          header note. Wrapper stops click-through so the action row never also
          opens the detail panel (the card body opens it). */}
      <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {showSuggestion ? (
          /* A — teal split button. Body confirms; caret opens the shared picker
             pre-highlighted on the suggestion. Both ends call the same
             onRelease. `flex-1` matches the mockup's .bt, which takes the row's
             free width while Hold/✕ stay at their natural size. */
          <div className="flex h-[30px] flex-1 items-stretch overflow-hidden rounded-md">
            <button
              type="button"
              title={`Release to ${suggestionDay} ${suggestion!.windowTime}`}
              onClick={confirmSuggestion}
              className="flex flex-1 items-center justify-center gap-1.5 border border-brand-200 bg-white px-2.5 text-[11.5px] font-semibold text-brand-700 transition-colors hover:bg-brand-50"
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" className="shrink-0">
                <path
                  d="M1.5 5l2.5 2.5 4.5-5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="tabular-nums">
                {suggestionDay} {suggestion!.windowTime}
              </span>
            </button>
            {/* `relative` is the box the hidden picker trigger stretches into —
                so the popover anchors on the caret, not on the whole button. */}
            <div className="relative flex">
              <button
                type="button"
                title="Choose a different slot"
                onClick={() => setSlotGen((g) => g + 1)}
                className="flex w-[26px] items-center justify-center border border-l-0 border-brand-200 bg-white text-brand-700 transition-colors hover:bg-brand-50"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <DispatchSlotPicker
                value={null}
                onChange={(v) => {
                  if (v) onRelease(card.orderId, { dispatchTargetDate: v.date, dispatchWindowId: v.dispatchWindowId });
                }}
                windows={windows}
                disabled={!releasable}
                suggested={suggestedValue}
                hideTrigger
                forceOpenGen={slotGen || undefined}
                popoverAlign="right"
              />
            </div>
          </div>
        ) : (
          /* B — unchanged: reused picker, picking a slot releases the bill. */
          <DispatchSlotPicker
            value={null}
            onChange={(v) => {
              if (v) onRelease(card.orderId, { dispatchTargetDate: v.date, dispatchWindowId: v.dispatchWindowId });
            }}
            windows={windows}
            disabled={!releasable}
          />
        )}

        {/* Hold + ✕ (cancel) — wired to /api/floor/actions (Step 5). */}
        {/* Both secondary controls take the white alpha wash on a duplicate —
            a white-filled button would read as the card's primary action, and
            the teal Release split button next to them must stay the loudest
            thing on the row (UI §10, one teal per surface). */}
        {/* The reason lives on a SPAN WRAPPER, not on the button: a disabled
            button generates no mouse events in Chrome, so its own `title` never
            appears — and a reason the operator cannot read is worth nothing. The
            span is inline-flex, so it shrink-wraps the button and the row keeps
            its exact geometry. No tooltip component: components/ui/tooltip.tsx is
            hover-only with no touch fallback (CLAUDE_TINT §14), and the depot is
            desktop. The disabled styling is the picker trigger's OWN fragment,
            "opacity-40 cursor-not-allowed" (dispatch-slot-picker.tsx:235), reused
            verbatim so a blocked action reads the same on both controls. Neutral
            only — a blocked action on the rail is a "not yet", not an error
            (CLAUDE_FLOOR §8), which is also why the ✕ drops its red hover arms
            when locked: a dead button must not paint red under the cursor. */}
        <span className="inline-flex" title={tintLockReason}>
          <button
            type="button"
            disabled={tintLocked}
            title={tintLocked ? undefined : "Hold — remove from decisions to the hold list"}
            onClick={() => onHold(card.orderId)}
            className={
              "h-[30px] rounded-md border px-2.5 text-[11px] " +
              "border-gray-200 bg-white text-gray-500 " +
              (tintLocked ? "opacity-40 cursor-not-allowed" : "hover:border-gray-300")
            }
          >
            Hold
          </button>
        </span>
        <span className="inline-flex" title={tintLockReason}>
          <button
            type="button"
            disabled={tintLocked}
            title={tintLocked ? undefined : "Cancel this bill"}
            onClick={() => onCancel(card.orderId)}
            className={
              "h-[30px] rounded-md border px-2.5 text-[11px] " +
              "border-gray-200 bg-white text-gray-500 " +
              (tintLocked
                ? "opacity-40 cursor-not-allowed"
                : "hover:border-red-200 hover:text-red-600")
            }
          >
            &#10005;
          </button>
        </span>
      </div>

      {/* "Why no slot?" — its own line, so the action row keeps its three-controls
          rhythm. Grey only: this is a "you decide", never a fault, so no red or
          amber. Own stopPropagation — it sits OUTSIDE the action row's wrapper,
          and a bare click here would otherwise open the detail panel. */}
      {showWhy && (
        <div className="mt-1.5 text-[10.5px] leading-[1.4]" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setWhyOpen((v) => !v)}
            className={"underline underline-offset-2 " + "text-gray-400 hover:text-gray-600"}
           
          >
            Why no slot?
          </button>
          {whyOpen && (
            <span className={"ml-1.5 " + "text-gray-500"}>
              {whyNoSlot(card.deliveryType)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
