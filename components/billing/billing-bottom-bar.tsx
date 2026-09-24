"use client";

// Billing v2 — the Orders tab's pinned BOTTOM BAR (2026-09-24).
// Design: docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md §2 + §3.1;
// mockups docs/mockups/billing-mo-actions/billing-mo-actions-mockup.html (v12,
// tab 1) and billing-bar-polish-mockup.html (the polish pass — THE TARGET for
// size, tint and the CI card).
//
//   [⚑ Hold][✋ Hand][⊘ CI] | [⚡ Urgent][🕑 Slot]  ——spacer——  [Order No.][Punch]
//
// Renders THREE siblings into the right pane's fixed-height column, in order:
// the result notice (when there is one), the CI confirm card (when open), then
// the bar itself. They are siblings of the lines card, not children of the bar,
// so the card sits "just above the bar" as the mockup draws it and the bar keeps
// its fixed height. The lines card above is the only thing that gives way.
//
// Replaces BillingActionRibbon. Notes + Copy stay on the top row; the Order No
// box + Punch arrive as `soSlot`, rendered by review-view so the punch flow, its
// 10-digit gate, its edit pencil and Ctrl+V's `placeholder="Enter number"`
// lookup stay one definition.
//
// 🔴 NO DISPATCH BUTTON. Nothing lit = normal dispatch. Tapping a lit button
// clears it. Hold, Hand and CI are ONE choice of three: the server clears the
// other two (actions route, design §2) and this bar lights from the mail order
// it sends back — never from a local guess.
//
// 🔴 HIDDEN, NEVER DISABLED, WITHOUT THE TICK (CLAUDE_UI §10, BILLING §5). Each
// of the five buttons renders only when its billing_* canEdit is held. The route
// re-checks every one; this only decides what is drawn. The one faded state
// here is CI-on fading Urgent + Slot: that is "not now, for this bill", not "not
// yours" — the owner's choice (§2 "When CI is on, Urgent and Slot fade out").
//
// SIZING is by CONTAINER QUERY on the bar (= the pane's width), not the
// viewport — see the `.mo-bbar*` rules in app/globals.css.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DispatchSlotPicker, type DispatchWindow, type DispatchSlotValue } from "@/components/floor/dispatch-slot-picker";
import { postMailOrderAction, type BillingMoOrderState } from "@/lib/billing/mo-actions";
import { useBillingActionsAccess } from "@/components/billing/billing-actions-access-provider";
import type { MoOrder } from "@/lib/mail-orders/types";

// 48px, 15px semibold, 18px icon (polish mockup `.ab`). Width/padding and the
// icon-only collapse live in globals.css (`.mo-bbar-btn`).
const BTN =
  "mo-bbar-btn inline-flex items-center justify-center gap-2 rounded-[10px] border-[1.5px] text-[15px] font-semibold transition-colors disabled:cursor-wait";
const OFF = "border-ink-200 bg-white text-ink-600 hover:bg-ink-25";
// ON states — design §2 / §7. CI is the SOLID dark style, never the pale ink tag.
const ON = {
  hold:   "border-danger bg-danger text-white",
  hand:   "border-data-brown bg-data-brown text-white",
  ci:     "border-ink-900 bg-ink-900 text-white",
  urgent: "border-warn-text bg-warn-bg text-warn-text",
  slot:   "border-brand-600 bg-brand-50 text-brand-700",
} as const;
// The coloured icon on an OFF (white) button. When on, the icon inherits.
const ICON_OFF = {
  hold:   "text-danger",
  hand:   "text-data-brown",
  ci:     "text-ink-900",
  urgent: "text-warn-text",
  slot:   "text-brand-600",
} as const;

type Notice = { tone: "warn" | "error" | "quiet"; title: string; lines: string[] };

/**
 * ⚠ The CI card's optional NOTE is HIDDEN (2026-09-24). It must reach the raised
 * CI (`ci_returns.reasonRemark`), but it is typed at PRESS time and the CI is
 * raised at IMPORT, and no existing column can carry it between the two:
 * so_tags has no text field, and all four text columns on mo_orders are taken
 * (notes = the Notes button; remarks / billRemarks / deliveryRemarks = parsed
 * email text). It needs `mo_orders."billOnlyNote"` (or `so_tags."note"`),
 * written by markMoOrderCi and copied by raiseBillOnlyCi. Flip this once that
 * column exists and is wired.
 */
const SHOW_CI_NOTE = false;

function toDateString(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

export function BillingBottomBar({
  order,
  windows,
  soSlot,
  onSaved,
}: {
  order: MoOrder;
  windows: DispatchWindow[];
  /** The Order No box + Punch (or the punched pill / edit box) — review-view's. */
  soSlot: ReactNode;
  onSaved: () => void;
}) {
  const access = useBillingActionsAccess();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmCi, setConfirmCi] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [slotGen, setSlotGen] = useState(0);
  // The mail order as the route last saved it. Wins over the prop until the
  // page's reload hands down a NEW order object, then clears — so the bar shows
  // the saved state at once and the database's state as soon as it arrives.
  const [saved, setSaved] = useState<BillingMoOrderState | null>(null);
  useEffect(() => { setSaved(null); }, [order]);

  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (quietTimer.current) clearTimeout(quietTimer.current); }, []);

  // The card takes focus when it opens — the card ITSELF, not "Yes": Enter must
  // never confirm unless the Yes button is the focused element (a native button
  // is the only thing Enter clicks), and Esc must reach the card's handler.
  const cardRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!confirmCi) return;
    (SHOW_CI_NOTE ? noteRef.current : cardRef.current)?.focus();
  }, [confirmCi]);

  const s = saved && saved.id === order.id ? saved : null;
  const dispatchStatus = s ? s.dispatchStatus : (order.dispatchStatus ?? null);
  const dispatchPriority = s ? s.dispatchPriority : (order.dispatchPriority ?? null);
  const targetDate = s ? s.dispatchTargetDate : (order.dispatchTargetDate ?? null);
  const windowId = s ? s.dispatchWindowId : (order.dispatchWindowId ?? null);
  const handAt = s ? s.handAt : (order.handAt ?? null);
  const billOnlyAt = s ? s.billOnlyAt : (order.billOnlyAt ?? null);

  const holdOn = (dispatchStatus ?? "").toLowerCase() === "hold";
  const handOn = !!handAt;
  const ciOn = !!billOnlyAt;
  const urgentOn = dispatchPriority === "Urgent";
  const slotDate = toDateString(targetDate);
  const slotWindow = windows.find((w) => w.id === windowId) ?? null;
  const slotOn = !!slotDate && !!slotWindow;
  const slotValue: DispatchSlotValue | null =
    slotOn && slotDate && slotWindow
      ? { date: slotDate, dispatchWindowId: slotWindow.id, windowTime: slotWindow.windowTime }
      : null;

  function showNotice(n: Notice | null) {
    if (quietTimer.current) clearTimeout(quietTimer.current);
    setNotice(n);
    if (n?.tone === "quiet") quietTimer.current = setTimeout(() => setNotice(null), 2500);
  }

  function closeCard() {
    setConfirmCi(false);
    setCardError(null);
  }

  async function run(payload: Parameters<typeof postMailOrderAction>[1]) {
    if (busy) return;
    const fromCard = payload.action === "ci" && payload.on;
    setBusy(true);
    setCardError(null);
    showNotice(null);
    const res = await postMailOrderAction(order.id, payload);
    setBusy(false);
    if (!res.ok) {
      // Nothing was saved (bad input, no tick, LOCKED, a matched CI tag…).
      // A refused CI press keeps the card OPEN with the reason inside it.
      if (fromCard) setCardError(res.error);
      else showNotice({ tone: "error", title: res.error, lines: [] });
      return;
    }
    if (fromCard) closeCard();
    if (res.moOrder) setSaved(res.moOrder);
    if (res.failed.length > 0) {
      // 🔴 The MAIL ORDER DID SAVE — only these bills refused. Never "nothing changed".
      const n = res.failed.length;
      showNotice({
        tone: "warn",
        title: `Saved on the mail order — ${n} bill${n === 1 ? "" : "s"} not changed:`,
        lines: res.failed.map((f) => `${f.obdNumber} — ${f.reason}`),
      });
    } else if (res.skipped.length > 0 && res.updated.length === 0) {
      showNotice({ tone: "quiet", title: "Already set", lines: [] });
    }
    onSaved();
  }

  const leftGroup = access.hold || access.hand || access.ci;
  const midGroup = access.urgent || access.slot;
  // CI on → Urgent + Slot fade: still in the DOM, aria-disabled, no click.
  const fade = ciOn ? " opacity-[.35] pointer-events-none" : "";

  function label(icon: string, text: string, key: keyof typeof ICON_OFF, on: boolean) {
    return (
      <>
        <span aria-hidden className={`text-[18px] leading-none ${on ? "" : ICON_OFF[key]}`}>{icon}</span>
        <span className="mo-bbar-tx">{text}</span>
      </>
    );
  }

  return (
    <>
      {notice && (
        <div
          role={notice.tone === "quiet" ? "status" : "alert"}
          className={`mo-print-hide mx-4 mb-2.5 flex flex-shrink-0 items-start gap-2 rounded-lg border px-3 py-2 text-[12px] ${
            notice.tone === "warn"
              ? "border-warn/40 bg-warn-bg text-warn-text"
              : notice.tone === "error"
                ? "border-danger-bd bg-danger-bg text-danger-text"
                : "border-ink-100 bg-ink-25 text-ink-500"
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{notice.title}</div>
            {notice.lines.length > 0 && (
              <ul className="mt-1 max-h-[96px] space-y-0.5 overflow-y-auto font-mono text-[11.5px]">
                {notice.lines.map((l) => <li key={l} className="break-words">{l}</li>)}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => showNotice(null)}
            aria-label="Dismiss"
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[14px] leading-none opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* ── CI confirm card (design §3.1, polish mockup `.confirm`) ── Just above
          the bar. `data-mo-kbd-local`: the page's single-key and line-nav
          listeners stand down while focus is inside, so Tab / Space / R / F
          act on the card and never on the order behind it. */}
      {confirmCi && (
        <div
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Raise CI"
          data-mo-kbd-local
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeCard();
            }
          }}
          className="mo-print-hide mx-4 mb-2.5 w-[calc(100%-2rem)] max-w-[560px] flex-shrink-0 rounded-xl border-[1.5px] border-ink-900 bg-white px-4 py-3.5 shadow-[0_8px_24px_rgb(27_24_38/0.14)] outline-none"
        >
          <h3 className="mb-1.5 flex items-center gap-2 text-[15px] font-semibold text-ink-900">
            <span className="rounded-md bg-ink-900 px-2 py-px text-[12px] text-white">⊘ CI</span>
            Raise a CI for this bill?
          </h3>
          <p className="mb-1 text-[13px] text-ink-600">
            When the SAP bill imports, it will be <b className="text-ink-900">cancelled</b> and a full-bill CI raised.
          </p>
          <p className="mb-1 text-[13px] text-ink-600">
            Reason: <b className="text-ink-900">Wrong order by S.O.</b> · Raised by: <b className="text-ink-900">you</b>
          </p>
          <div className="mb-2.5 mt-1.5 text-[12px] font-semibold text-warn-text">
            ⚠ You can undo this only until the bill imports.
          </div>
          {SHOW_CI_NOTE && (
            <>
              <label htmlFor="mo-ci-note" className="mb-1 block text-[11px] font-semibold text-ink-600">
                Note (optional)
              </label>
              <input
                ref={noteRef}
                id="mo-ci-note"
                maxLength={200}
                placeholder="e.g. dealer cancelled on call, rate issue"
                className="h-[38px] w-full rounded-lg border-[1.5px] border-ink-200 px-2.5 text-[13px] outline-none focus:border-brand-600 focus:ring-[3px] focus:ring-brand-600/10"
              />
            </>
          )}
          {cardError && (
            <div role="alert" className="mt-2 rounded-lg border border-danger-bd bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-text">
              {cardError}
            </div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <span className="mr-auto text-[11px] text-ink-400">Esc to cancel</span>
            <button
              type="button"
              onClick={closeCard}
              className="h-10 rounded-[9px] border-[1.5px] border-ink-200 bg-white px-4 text-[14px] font-semibold text-ink-600 hover:bg-ink-25"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run({ action: "ci", on: true })}
              className="h-10 rounded-[9px] border-[1.5px] border-ink-900 bg-ink-900 px-4 text-[14px] font-semibold text-white hover:bg-ink-700 disabled:cursor-wait"
            >
              Yes, raise CI
            </button>
          </div>
        </div>
      )}

      <div className="mo-bbar mo-print-hide flex-shrink-0 border-t border-ink-100 bg-ink-50 px-4 py-3 shadow-[0_-4px_12px_rgb(27_24_38/0.06)]">
        <div className="mo-bbar-row">
          {leftGroup && (
            <div className="mo-bbar-grp">
              {access.hold && (
                <button
                  type="button"
                  disabled={busy}
                  data-icon-able
                  onClick={() => void run({ action: "hold", on: !holdOn })}
                  title={holdOn ? "Release hold" : "Hold"}
                  aria-pressed={holdOn}
                  className={`${BTN} ${holdOn ? ON.hold : OFF}`}
                >
                  {label("⚑", "Hold", "hold", holdOn)}
                </button>
              )}
              {access.hand && (
                <button
                  type="button"
                  disabled={busy}
                  data-icon-able
                  onClick={() => void run({ action: "hand", on: !handOn })}
                  title={handOn ? "Clear Hand" : "Hand — dealer collects"}
                  aria-pressed={handOn}
                  className={`${BTN} ${handOn ? ON.hand : OFF}`}
                >
                  {label("✋", "Hand", "hand", handOn)}
                </button>
              )}
              {access.ci && (
                <button
                  type="button"
                  disabled={busy}
                  data-icon-able
                  // Clearing a lit CI needs no card; SETTING one opens it.
                  onClick={() => {
                    if (ciOn) void run({ action: "ci", on: false });
                    else { setCardError(null); setConfirmCi(true); }
                  }}
                  title={ciOn ? "Clear CI" : "CI — bill only, raise a CI when it imports"}
                  aria-pressed={ciOn}
                  className={`${BTN} ${ciOn ? ON.ci : OFF}`}
                >
                  {label("⊘", "CI", "ci", ciOn)}
                </button>
              )}
            </div>
          )}

          {leftGroup && midGroup && <span aria-hidden className="mx-0.5 h-8 w-px flex-shrink-0 bg-ink-200" />}

          {midGroup && (
            <div className="mo-bbar-grp">
              {access.urgent && (
                <button
                  type="button"
                  disabled={busy}
                  data-icon-able
                  aria-disabled={ciOn || undefined}
                  tabIndex={ciOn ? -1 : undefined}
                  onClick={() => { if (!ciOn) void run({ action: "urgent", on: !urgentOn }); }}
                  title={ciOn ? "Urgent — not used on a CI bill" : urgentOn ? "Clear urgent" : "Urgent"}
                  aria-pressed={urgentOn}
                  className={`${BTN} ${urgentOn ? ON.urgent : OFF}${fade}`}
                >
                  {label("⚡", "Urgent", "urgent", urgentOn)}
                </button>
              )}
              {/* Slot — the reused Floor picker overlaid invisibly on this button to
                  anchor its popover (the technique the old ribbon used). The
                  overlay is a real trigger, so it is NOT rendered while CI fades
                  the button or a write is in flight. */}
              {access.slot && (
                <span className={`relative inline-flex${fade}`}>
                  <button
                    type="button"
                    disabled={busy}
                    data-icon-able
                    aria-disabled={ciOn || undefined}
                    tabIndex={ciOn ? -1 : undefined}
                    onClick={() => { if (!ciOn) setSlotGen((g) => g + 1); }}
                    title={
                      ciOn
                        ? "Slot — not used on a CI bill"
                        : slotOn && slotWindow
                          ? `Slot ${slotDate?.slice(8, 10)}-${slotDate?.slice(5, 7)} · ${slotWindow.windowTime}`
                          : "Slot"
                    }
                    aria-pressed={slotOn}
                    className={`${BTN} ${slotOn ? ON.slot : OFF}`}
                  >
                    {label("🕑", slotOn && slotWindow ? slotWindow.windowTime : "Slot", "slot", slotOn)}
                  </button>
                  {!busy && !ciOn && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 opacity-0 [&>div]:!block [&>div]:h-full [&>div]:w-full [&>div>button]:!h-full [&>div>button]:!w-full"
                    >
                      <DispatchSlotPicker
                        value={slotValue}
                        windows={windows}
                        popoverDir="up"
                        popoverAlign="left"
                        forceOpenGen={slotGen || undefined}
                        onChange={(v) =>
                          void run(
                            v === null
                              ? { action: "slot", date: null, dispatchWindowId: null }
                              : { action: "slot", date: v.date, dispatchWindowId: v.dispatchWindowId },
                          )
                        }
                      />
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          <div className="mo-bbar-grp mo-bbar-end">{soSlot}</div>
        </div>
      </div>
    </>
  );
}
