"use client";

// Billing v2 — the BLOCKING Pick delete popup (owner, 2026-09-28).
//
// Billing must decide a same-SO group before anything else, so whenever the
// actionable-group count is above zero this opens by itself over the WHOLE
// Billing screen (every tab) and renders the one-group-at-a-time queue
// (billing-pick-delete-queue.tsx) — the exact view the Pick delete tab used to
// show. It closes by itself once the last group is decided and its confirmation
// panel has gone. Mounted only for `billing_pick_delete` canEdit holders
// (mail-orders-page.tsx); view-only or no tick → never mounted, nothing polls.
//
// 🔴 IT CANNOT BE DISMISSED. There is no close button, the backdrop has no click
// handler, and Esc does nothing (see the key guard below). The only way out is
// to decide.
//
// 🔴 THE PAGE BEHIND IS INERT, AND NOTHING THERE IS RESET.
//   · Mouse / focus: while open, every <body> child except this popup's own
//     portal host gets the `inert` attribute — no clicks, no focus, no text
//     selection behind. It is only an attribute: the DOM, React state and any
//     half-typed input behind are untouched, and the element that had focus is
//     re-focused on close, so the user continues where they left off.
//   · Keyboard: the billing screen binds its shortcuts as CAPTURE listeners on
//     window and document (mail-orders-page.tsx, review-view.tsx, …). A key
//     pressed inside the popup still passes through those, so `inert` alone
//     would let Space toggle a line on the Orders tab behind. The guard below is
//     registered on window, capture phase, when THIS MODULE LOADS — before any
//     component effect has run — so it is first in line for every keydown and
//     stops it reaching any other listener. It does NOT preventDefault, so the
//     browser's own Tab / Enter / Space still move focus and press the popup's
//     buttons.
//
// "INSTANT". The count comes from /api/billing/pick-delete/marker (the list's
// own rule, lib/billing/pick-delete.ts — one SQL statement since 2026-09-30):
//   · polled every 10s by BillingPickDeleteMarkerProvider
//     (BILLING_PICK_DELETE_POLL_MS), which also checks at once when the browser
//     tab becomes visible (lib/hooks/use-picking-marker.ts). 🔴 The popup READS
//     that answer (useBillingPickDeleteMarkerValue) — it no longer fetches the
//     marker a second time after every change the provider sees (2026-09-30);
//   · on mount: one check of its own (subject to the 10 s throttle below);
//   · on window focus: a check ONLY if nothing has checked in the last 10 s
//     (FOCUS_THROTTLE_MS — any check counts: the provider's probe or the
//     popup's own). The look happens 1.5 s after the focus, so returning to the
//     tab — where the provider's visible-again probe is already on its way —
//     does not fire two marker calls at once (it used to);
//   · at once, never throttled: an Import on this screen finishes (off
//     useImportProgress) and PICK_DELETE_CHECK_EVENT (the History tab's Undo).
// The poll still pauses during a write and while the confirmation panel shows
// (the queue holds the marker pause); while that is up the popup ignores the
// provider's answers too, and takes its count from the queue.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useBillingPickDeleteMarkerValue } from "@/components/billing/billing-marker-provider";
import {
  PICK_DELETE_BASE,
  PICK_DELETE_CHECK_EVENT,
  PickDeleteQueue,
  type PickDeleteQueueState,
} from "@/components/billing/billing-pick-delete-queue";
import { useImportProgress } from "@/components/import/import-progress-provider";

/** A focus check waits this long since the last check of any kind (2026-09-30). */
const FOCUS_THROTTLE_MS = 10_000;
/** …and looks this long after the focus, so a visible-again probe lands first. */
const FOCUS_SETTLE_MS = 1_500;

// ── The key guard (module scope — see the header) ───────────────────────────

let blocking = false;

if (typeof window !== "undefined") {
  const swallow = (e: KeyboardEvent) => {
    if (blocking) e.stopImmediatePropagation();
  };
  window.addEventListener("keydown", swallow, true);
  window.addEventListener("keyup", swallow, true);
  window.addEventListener("keypress", swallow, true);
}

// ── The host ────────────────────────────────────────────────────────────────

export function BillingPickDeletePopup() {
  /** Actionable groups — from the marker, then from each queue load. */
  const [count, setCount] = useState(0);
  /** A write is in flight or the confirmation panel is up. */
  const [held, setHeld] = useState(false);
  const open = count > 0 || held;

  // When anything last CHECKED the marker (the popup's own fetch starting, or a
  // provider answer arriving) — the focus throttle's clock.
  const lastCheckAtRef = useRef(0);
  // When the count shown was last SET (an answer applied, or the queue's own
  // state) — an answer older than this is never applied over it.
  const appliedAtRef = useRef(0);
  const heldRef = useRef(held);
  heldRef.current = held;

  const reqRef = useRef(0);
  const check = useCallback(async () => {
    const seq = ++reqRef.current;
    lastCheckAtRef.current = Date.now();
    try {
      const res = await fetch(`${PICK_DELETE_BASE}/marker`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { count?: number };
      if (seq !== reqRef.current) return;
      if (typeof body.count === "number") {
        appliedAtRef.current = Date.now();
        setCount(body.count);
      }
    } catch {
      // Silent — the next trigger or tick retries.
    }
  }, []);

  // First look on mount (the throttle cannot hold it — nothing has checked yet).
  useEffect(() => {
    if (Date.now() - lastCheckAtRef.current >= FOCUS_THROTTLE_MS) void check();
  }, [check]);

  // The provider's answer — every 10 s probe, its visible-again probe, and the
  // baseline. Replaces the second fetch the popup used to make on each change.
  // Ignored while a decision / confirmation holds the queue (the queue's own
  // state is newer), and never applied over a newer answer.
  const providerValue = useBillingPickDeleteMarkerValue();
  useEffect(() => {
    if (providerValue === null) return;
    lastCheckAtRef.current = Math.max(lastCheckAtRef.current, providerValue.at);
    if (heldRef.current || providerValue.at <= appliedAtRef.current) return;
    appliedAtRef.current = providerValue.at;
    setCount(providerValue.count);
  }, [providerValue]);

  // Window focus → a check only if nothing checked in the last 10 s, looked at
  // 1.5 s later so the provider's visible-again probe can land first.
  // The History tab's Undo → at once, never throttled.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (Date.now() - lastCheckAtRef.current >= FOCUS_THROTTLE_MS) void check();
      }, FOCUS_SETTLE_MS);
    };
    const now = () => void check();
    window.addEventListener("focus", onFocus);
    window.addEventListener(PICK_DELETE_CHECK_EVENT, now);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(PICK_DELETE_CHECK_EVENT, now);
    };
  }, [check]);

  // Immediate: an Import on this screen finished. `state` is replaced on every
  // transition, so this fires once per completed run.
  const { state: importState } = useImportProgress();
  useEffect(() => {
    if (importState.status === "done") void check();
  }, [importState, check]);

  const onQueueState = useCallback((s: PickDeleteQueueState) => {
    appliedAtRef.current = Date.now();
    setCount(s.groups);
    setHeld(s.held);
  }, []);

  // The portal host — a <body> child of its own, so it can be the one child
  // left un-inert.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-pick-delete-popup", "");
    document.body.appendChild(el);
    setHost(el);
    return () => {
      el.remove();
    };
  }, []);

  // Inert page + key guard + focus save/restore, for exactly as long as open.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || host === null) return;
    const hadFocus = document.activeElement as HTMLElement | null;
    const madeInert: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === host || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      madeInert.push(child);
    }
    blocking = true;
    dialogRef.current?.focus();
    return () => {
      blocking = false;
      for (const el of madeInert) el.removeAttribute("inert");
      if (hadFocus && document.contains(hadFocus)) hadFocus.focus();
    };
  }, [open, host]);

  if (!open || host === null) return null;

  return createPortal(
    // No onClick on the backdrop, no close button, no Esc — see the header.
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink-900/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pick-delete-popup-title"
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-ink-100 bg-ink-25 shadow-xl outline-none"
      >
        {/* Height fits the content (max 90vh); the queue scrolls inside. */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn/30 bg-warn-bg px-4 py-3">
          <AlertTriangle size={18} strokeWidth={2} className="shrink-0 text-warn" aria-hidden />
          <h2 id="pick-delete-popup-title" className="m-0 text-[16px] font-bold text-ink-900">
            Pick delete
          </h2>
          <span className="text-[12px] text-ink-600">
            Two or more bills share one SO number. Decide each group to continue.
          </span>
          {count > 0 && <span className="ml-auto text-[12px] font-semibold text-warn-text">{count} left</span>}
        </div>
        <PickDeleteQueue canEdit onState={onQueueState} />
      </div>
    </div>,
    host,
  );
}
