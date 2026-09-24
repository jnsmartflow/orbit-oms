"use client";

// Billing v2 — the Orders tab's pinned BOTTOM BAR (2026-09-24).
// Design: docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md §2;
// mockup docs/mockups/billing-mo-actions/billing-mo-actions-mockup.html (v12, tab 1).
//
//   [⚑ Hold][✋ Hand][⊘ CI] | [⚡ Urgent][🕑 Slot]          [Order No.][Punch]
//
// Replaces BillingActionRibbon (the small Urgent/Hold/Slot buttons that sat on
// the top row). Notes + Copy stay on the top row; the Order No box + Punch move
// here and arrive as `soSlot`, rendered by review-view so the punch flow, its
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
// re-checks every one; this only decides what is drawn. The one DISABLED state
// here is CI-on fading Urgent + Slot: that is "not now, for this bill", not "not
// yours" — the owner's choice (§2 "When CI is on, Urgent and Slot fade out").
//
// SIZING is by CONTAINER QUERY on the pane, not the viewport — see the
// `.mo-bbar*` rules in app/globals.css. Always one row down to ~520px.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DispatchSlotPicker, type DispatchWindow, type DispatchSlotValue } from "@/components/floor/dispatch-slot-picker";
import { postMailOrderAction, type BillingMoOrderState } from "@/lib/billing/mo-actions";
import { useBillingActionsAccess } from "@/components/billing/billing-actions-access-provider";
import type { MoOrder } from "@/lib/mail-orders/types";

const BTN =
  "mo-bbar-btn inline-flex items-center justify-center gap-[7px] rounded-[9px] border-[1.5px] text-[14px] font-semibold transition-colors disabled:cursor-wait";
const OFF = "border-ink-100 bg-white text-ink-600 hover:border-ink-200 hover:bg-ink-25";
// ON states — design §2 / §7. CI is the SOLID dark style, never the pale ink tag.
const ON = {
  hold:   "border-danger bg-danger text-white",
  hand:   "border-data-brown bg-data-brown text-white",
  ci:     "border-ink-900 bg-ink-900 text-white",
  urgent: "border-warn bg-warn-bg text-warn-text",
  slot:   "border-brand-600 bg-brand-50 text-brand-700",
} as const;
// The coloured icon on an OFF (grey) button. When on, the icon inherits.
const ICON_OFF = {
  hold:   "text-danger",
  hand:   "text-data-brown",
  ci:     "text-ink-900",
  urgent: "text-warn-text",
  slot:   "text-brand-600",
} as const;

type Notice = { tone: "warn" | "error" | "quiet"; title: string; lines: string[] };

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
  const [slotGen, setSlotGen] = useState(0);
  // The mail order as the route last saved it. Wins over the prop until the
  // page's reload hands down a NEW order object, then clears — so the bar shows
  // the saved state at once and the database's state as soon as it arrives.
  const [saved, setSaved] = useState<BillingMoOrderState | null>(null);
  useEffect(() => { setSaved(null); }, [order]);

  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (quietTimer.current) clearTimeout(quietTimer.current); }, []);

  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmCi) confirmBtnRef.current?.focus(); }, [confirmCi]);

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

  async function run(payload: Parameters<typeof postMailOrderAction>[1]) {
    if (busy) return;
    setBusy(true);
    setConfirmCi(false);
    showNotice(null);
    const res = await postMailOrderAction(order.id, payload);
    setBusy(false);
    if (!res.ok) {
      // Nothing was saved (bad input, no tick, LOCKED, a matched CI tag…).
      showNotice({ tone: "error", title: res.error, lines: [] });
      return;
    }
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
        <span aria-hidden className={`text-[15px] leading-none ${on ? "" : ICON_OFF[key]}`}>{icon}</span>
        <span className="mo-bbar-tx">{text}</span>
      </>
    );
  }

  return (
    <div className="mo-bbar mo-print-hide flex-shrink-0 border-t border-ink-100 bg-white px-[14px] py-3 shadow-[0_-6px_16px_rgba(27,24,38,0.06)]">
      {confirmCi && (
        <div
          role="alertdialog"
          aria-label="Confirm CI"
          className="mb-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-ink-25 px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setConfirmCi(false);
            }
          }}
        >
          <span className="min-w-0 flex-1 text-[13px] font-medium text-ink-900">
            Raise a CI for this bill when it imports?
          </span>
          <button
            type="button"
            onClick={() => setConfirmCi(false)}
            className="h-8 rounded-md border border-ink-200 bg-white px-3 text-[12px] font-medium text-ink-600 hover:bg-ink-50"
          >
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => void run({ action: "ci", on: true })}
            className="h-8 rounded-md border border-ink-900 bg-ink-900 px-3 text-[12px] font-semibold text-white hover:bg-ink-700"
          >
            Raise CI
          </button>
        </div>
      )}

      {notice && (
        <div
          role={notice.tone === "quiet" ? "status" : "alert"}
          className={`mb-2.5 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] ${
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
              <ul className="mt-1 space-y-0.5 font-mono text-[11.5px]">
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
                // Clearing a lit CI needs no question; SETTING one asks once.
                onClick={() => (ciOn ? void run({ action: "ci", on: false }) : setConfirmCi(true))}
                title={ciOn ? "Clear CI" : "CI — bill only, raise a CI when it imports"}
                aria-pressed={ciOn}
                className={`${BTN} ${ciOn ? ON.ci : OFF}`}
              >
                {label("⊘", "CI", "ci", ciOn)}
              </button>
            )}
          </div>
        )}

        {leftGroup && midGroup && <span aria-hidden className="mx-1 w-px self-stretch bg-ink-100" />}

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
  );
}
