"use client";

// components/tint/manager/missing-card.tsx — the missing-customer CARD
// (2026-10-02, docs/mockups/tint-manager/tint-manager-missing-card-mockup.html).
// Replaces the 8-second new-arrival nudge from 265606a3.
//
// ONE customer per card, a queue per user's screen (no server state):
//   - the queue is the missing-customer bills the board shows
//     (lib/tint/customer-missing.ts → missingOnBoard) that this user has NOT
//     dismissed today in this browser, OLDEST FIRST (orders.createdAt);
//     bills that appear on a later refetch join the END;
//   - shown on page open and whenever the queue is non-empty; never in history;
//   - each card lasts 2 minutes from when IT appears; at 0 the bill is dismissed
//     for today and the next card shows. The timer PAUSES while the Add ship-to
//     form is open; Cancel resumes it with the time left;
//   - a successful save shows "✓ Added" for ~1s, then the next card;
//   - a bill another user fixed leaves on the next refetch (if it is the
//     current card, the next one shows);
//   - when the queue empties the last card shrinks toward the orange chip
//     (~300ms) and the chip pulses once.
//
// DISMISSED ids live in localStorage under
//   tm_missing_dismissed:<userId>:<YYYY-MM-DD IST>
// (try/catch; in memory when storage is blocked), so they reset each IST day.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MissingCustomerBill, MissingOnBoard, MissingPlace } from "@/lib/tint/customer-missing";
import { cn } from "@/lib/utils";

export const CARD_MS = 2 * 60_000;
const ADDED_MS = 1000;
const LEAVE_MS = 300;

const PLACE_LABEL: Record<MissingPlace, string> = {
  rail: "Needs assignment", tinting: "Tint", base: "Base", ti: "TI", hold: "Hold",
};

function istDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function readDismissed(key: string | null): Set<number> {
  if (!key) return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is number => typeof x === "number") : []);
  } catch { return new Set(); }
}

function writeDismissed(key: string | null, ids: Set<number>): void {
  if (!key) return;
  try { window.localStorage.setItem(key, JSON.stringify(Array.from(ids))); } catch { /* in memory only */ }
}

const byCreated = (a: MissingCustomerBill, b: MissingCustomerBill) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.orderId - b.orderId;

export interface MissingCardState {
  bill:    MissingCustomerBill;
  place:   MissingPlace;
  /** Position in this run ("N of M"). */
  n:       number;
  m:       number;
  leftMs:  number;
  added:   boolean;
  leaving: boolean;
}

/**
 * The queue + timer. `ready` = the board, Base and (when visible) Hold have
 * loaded, so the first order is complete. `paused` = the Add ship-to form is open.
 */
export function useMissingCardQueue({
  board, ready, history, userId, paused, onQueueEnd,
}: {
  board:      MissingOnBoard;
  ready:      boolean;
  history:    boolean;
  userId:     string | null | undefined;
  paused:     boolean;
  onQueueEnd: () => void;
}): { card: MissingCardState | null; markAdded: (customerCode: string) => void } {
  const key = userId ? `tm_missing_dismissed:${userId}:${istDate()}` : null;
  const dismissedRef = useRef<Set<number>>(new Set());
  const keyRef = useRef<string | null>(null);
  if (keyRef.current !== key) {
    keyRef.current = key;
    dismissedRef.current = typeof window === "undefined" ? new Set() : readDismissed(key);
  }

  const [order, setOrder] = useState<number[]>([]);
  const [shown, setShown] = useState<{ id: number; bill: MissingCustomerBill; place: MissingPlace } | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [leftMs, setLeftMs] = useState(CARD_MS);
  const [added, setAdded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leftRef = useRef(CARD_MS);
  // The exit timer lives in a ref: a board refetch during the 300ms exit must
  // not cancel it (an effect cleanup would, leaving the card stuck).
  const leaveTimerRef = useRef<number | null>(null);
  const onEndRef = useRef(onQueueEnd);
  onEndRef.current = onQueueEnd;

  // Keep the queue in step with the board: drop what left or was dismissed,
  // append what is new (oldest first among the new ones).
  useEffect(() => {
    if (!ready || history) return;
    const dismissed = dismissedRef.current;
    setOrder((prev) => {
      const kept = prev.filter((id) => board.byOrder.has(id) && !dismissed.has(id));
      const known = new Set(kept);
      const fresh = Array.from(board.byOrder.values())
        .filter((b) => !known.has(b.orderId) && !dismissed.has(b.orderId))
        .sort(byCreated)
        .map((b) => b.orderId);
      const next = [...kept, ...fresh];
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [board, ready, history, key]);

  const dismiss = useCallback((id: number) => {
    dismissedRef.current.add(id);
    writeDismissed(keyRef.current, dismissedRef.current);
    setOrder((o) => o.filter((x) => x !== id));
  }, []);

  // Which card is on screen. Frozen while "✓ Added" or the exit animation runs.
  useEffect(() => {
    if (added || leaving) return;
    const head = order[0];
    if (head !== undefined) {
      if (shown?.id === head) return;
      const bill = board.byOrder.get(head);
      const place = board.placeOf.get(head);
      if (!bill || !place) return;
      if (shown) setDoneCount((n) => n + 1);   // the previous card ended (any reason)
      setShown({ id: head, bill, place });
      leftRef.current = CARD_MS;
      setLeftMs(CARD_MS);
      return;
    }
    if (shown && leaveTimerRef.current === null) {
      // Queue empty → shrink toward the chip, then pulse it once.
      setLeaving(true);
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = null;
        setShown(null);
        setLeaving(false);
        setDoneCount(0);
        onEndRef.current();
      }, LEAVE_MS);
    }
  }, [order, board, shown, added, leaving]);

  // The 2-minute timer — runs only while a card is visible and not paused.
  useEffect(() => {
    if (!shown || added || leaving || paused || history) return;
    let last = Date.now();
    const iv = window.setInterval(() => {
      const now = Date.now();
      leftRef.current = Math.max(0, leftRef.current - (now - last));
      last = now;
      setLeftMs(leftRef.current);
      if (leftRef.current <= 0) {
        window.clearInterval(iv);
        dismiss(shown.id);
      }
    }, 250);
    return () => window.clearInterval(iv);
  }, [shown, added, leaving, paused, history, dismiss]);

  const markAdded = useCallback((customerCode: string) => {
    if (!shown) return;
    if ((shown.bill.shipToCustomerId ?? "").toUpperCase() !== customerCode.toUpperCase()) return;
    const id = shown.id;
    setAdded(true);
    window.setTimeout(() => {
      dismiss(id);
      setAdded(false);
    }, ADDED_MS);
  }, [shown, dismiss]);

  if (!shown || history) return { card: null, markAdded };
  const inQueue = order.includes(shown.id);
  return {
    card: {
      bill:    shown.bill,
      place:   shown.place,
      n:       doneCount + 1,
      m:       doneCount + order.length + (inQueue ? 0 : 1),
      leftMs,
      added,
      leaving,
    },
    markAdded,
  };
}

/** The card, bottom-right. ONE button; no Later, no ✕. */
export function MissingCustomerCard({ card, canAdd, onAdd, bottomBarOffset = 0 }: {
  card:   MissingCardState;
  canAdd: boolean;
  onAdd:  () => void;
  /** Height the page MEASURED for an open bottom bar (0 = none). The card then
   *  sits 12px above it, and drops BELOW the bar in z-order so the bar and its
   *  menus are never covered (2026-10-02). */
  bottomBarOffset?: number;
}) {
  const barUp = bottomBarOffset > 0;
  const secs = Math.ceil(card.leftMs / 1000);
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div
      className={cn(
        "fixed right-6 w-[440px] overflow-hidden rounded-[14px] border border-[#FDE68A] border-t-4 border-t-warn bg-white shadow-[0_18px_40px_rgba(27,24,38,0.18)]",
        // The bar (FloorActionBar, z-20) and its More menu stay on top while it is open.
        barUp ? "z-[15]" : "z-[60]",
        "origin-top-right",
        card.leaving ? "-translate-y-[70vh] scale-[0.2] opacity-0" : "translate-y-0 scale-100 opacity-100",
      )}
      // bottom: 24px normally; bar height + 12px while a bottom bar is open.
      // The move animates in 200ms; the exit (transform/opacity) in 300ms.
      style={{
        bottom: barUp ? bottomBarOffset + 12 : 24,
        transition: "bottom 200ms ease-out, transform 300ms ease-in, opacity 300ms ease-in",
      }}
      role="status"
    >
      <div className="px-4 pb-4 pt-3.5">
        <div className="flex items-start gap-3">
          <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-warn-bg font-bold text-warn">⚠</span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-ink-900">Missing customer</p>
            <p className="text-[11.5px] text-ink-500">{card.m <= 1 ? "1 new" : `${card.n} of ${card.m} · oldest first`}</p>
          </div>
        </div>
        <p className="mt-3 truncate text-[17px] font-bold leading-tight text-ink-900">{card.bill.shipToCustomerName ?? "—"}</p>
        <p className="mt-1 text-[12px] text-ink-500">
          <span className="font-mono">{card.bill.shipToCustomerId ?? "—"}</span>
          {" · OBD "}<span className="font-mono">{card.bill.obdNumber}</span>
          {" · "}{PLACE_LABEL[card.place]}
        </p>
        <div className="mt-3 h-1 overflow-hidden rounded bg-ink-50">
          <i
            className="block h-full rounded bg-warn transition-[width] duration-300"
            style={{ width: card.added ? "0%" : `${(card.leftMs / CARD_MS) * 100}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-400">
          {card.added ? "Next one in a moment…" : mmss}
        </p>
        <div className="mt-3 flex justify-end">
          {card.added ? (
            <span className="inline-flex h-[30px] items-center rounded-md bg-ok px-3.5 text-[12.5px] font-semibold text-white">✓ Added</span>
          ) : canAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="h-[30px] rounded-md bg-ink-900 px-3.5 text-[12.5px] font-semibold text-white hover:bg-ink-700"
            >
              + Add ship-to
            </button>
          ) : (
            <span title="No permission to add customers">
              <span className="inline-flex h-[30px] cursor-not-allowed items-center rounded-md bg-gray-100 px-3.5 text-[12.5px] font-semibold text-gray-400">+ Add ship-to</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
