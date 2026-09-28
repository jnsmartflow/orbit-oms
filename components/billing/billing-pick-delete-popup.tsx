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
// own rule, lib/billing/pick-delete.ts getActionableGroups):
//   · polled every 10s by BillingPickDeleteMarkerProvider
//     (BILLING_PICK_DELETE_POLL_MS), which also checks at once when the browser
//     tab becomes visible (lib/hooks/use-picking-marker.ts);
//   · checked at once on window focus (below);
//   · checked at once when an Import on this screen finishes (below, off
//     useImportProgress — the one place every Import run reports "done");
//   · checked at once on PICK_DELETE_CHECK_EVENT (the History tab after Undo).
// The poll still pauses during a write and while the confirmation panel shows
// (the queue holds the marker pause).

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBillingPickDeleteMarkerSubscription } from "@/components/billing/billing-marker-provider";
import {
  PICK_DELETE_BASE,
  PICK_DELETE_CHECK_EVENT,
  PickDeleteQueue,
  type PickDeleteQueueState,
} from "@/components/billing/billing-pick-delete-queue";
import { useImportProgress } from "@/components/import/import-progress-provider";

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

  const reqRef = useRef(0);
  const check = useCallback(async () => {
    const seq = ++reqRef.current;
    try {
      const res = await fetch(`${PICK_DELETE_BASE}/marker`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { count?: number };
      if (seq !== reqRef.current) return;
      if (typeof body.count === "number") setCount(body.count);
    } catch {
      // Silent — the next trigger or tick retries.
    }
  }, []);

  // First look on mount, then every detected marker change (10s poll + the
  // hook's own visible-again check).
  useEffect(() => {
    void check();
  }, [check]);
  useBillingPickDeleteMarkerSubscription(check);

  // Immediate: window focus, and the History tab's Undo.
  useEffect(() => {
    const now = () => void check();
    window.addEventListener("focus", now);
    window.addEventListener(PICK_DELETE_CHECK_EVENT, now);
    return () => {
      window.removeEventListener("focus", now);
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
        className="flex h-full max-h-[calc(100vh-32px)] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-ink-100 bg-ink-25 shadow-xl outline-none"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-ink-100 bg-white px-4 py-3">
          <h2 id="pick-delete-popup-title" className="m-0 text-[15px] font-semibold text-ink-900">
            Pick delete
          </h2>
          <span className="text-[12px] text-ink-500">
            Two or more bills share one SO number. Decide each group to continue.
          </span>
        </div>
        <PickDeleteQueue canEdit onState={onQueueState} />
      </div>
    </div>,
    host,
  );
}
