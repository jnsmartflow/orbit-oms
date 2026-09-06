"use client";

import { ChevronLeft, X } from "lucide-react";
import { DIVIDER, FAINT, INK, MUTED, RULE } from "./v2-data";
import {
  formatSavedAt, formatTime, summaryLine, unitsOf,
  type V2SavedDraft, type V2SentOrder, type V2Snapshot,
} from "./v2-storage";

// The two list screens behind the landing screen's bottom nav. Presentational
// only — every decision (confirm before replacing work, reload as a fresh
// order) is the page's, so both screens stay readable.
//
// 🔴 CONTAINMENT — imports ./v2-data, ./v2-storage and node_modules only.

function ListShell({ title, onBack, children }: {
  title: string; onBack: () => void; children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="min-h-screen w-full bg-white" style={{ paddingBottom: 24 }}>
      <header
        className="sticky top-0 z-10 flex items-center gap-2 bg-white px-2 py-3"
        style={{ borderBottom: `1px solid ${RULE}` }}
      >
        <button
          type="button" aria-label="Back" onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} style={{ color: INK }} />
        </button>
        <h1 className="text-[17px] font-extrabold" style={{ color: INK, letterSpacing: "-0.02em" }}>
          {title}
        </h1>
      </header>
      {children}
    </main>
  );
}

/** Empty state: one grey line, nothing else. No illustration, no call to action. */
function Empty({ text }: { text: string }): React.JSX.Element {
  return <p className="px-4 py-12 text-center text-[13px]" style={{ color: FAINT }}>{text}</p>;
}

export function DraftsScreen({ drafts, onBack, onOpen, onRemove }: {
  drafts: V2SavedDraft[];
  onBack: () => void;
  onOpen: (draft: V2SavedDraft) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  return (
    <ListShell title="Saved drafts" onBack={onBack}>
      {drafts.length === 0 ? (
        <Empty text="No saved drafts." />
      ) : (
        drafts.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-4"
               style={{ borderBottom: `1px solid ${DIVIDER}` }}>
            <button
              type="button" onClick={() => onOpen(d)}
              className="flex min-w-0 flex-1 items-start gap-3 py-3 text-left"
            >
              <OrderSummary snapshot={d.snapshot} stamp={formatSavedAt(d.savedAt)} />
            </button>
            {/* No confirm on delete, by spec — a draft is cheap to lose and the
                row is the only thing being removed. Replacing LIVE work is the
                case that gets a confirm, and the page owns that. */}
            <button
              type="button" aria-label={`Remove ${d.label}`}
              onClick={() => onRemove(d.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center"
            >
              <X className="h-4 w-4" strokeWidth={2.5} style={{ color: FAINT }} />
            </button>
          </div>
        ))
      )}
    </ListShell>
  );
}

export function SentScreen({ orders, onBack, onOpen }: {
  orders: V2SentOrder[];
  onBack: () => void;
  onOpen: (order: V2SentOrder) => void;
}): React.JSX.Element {
  return (
    <ListShell title="Sent today" onBack={onBack}>
      {orders.length === 0 ? (
        <Empty text="Nothing sent today." />
      ) : (
        orders.map((o) => (
          <button
            key={o.id} type="button" onClick={() => onOpen(o)}
            className="flex w-full items-start gap-3 px-4 py-3 text-left"
            style={{ borderBottom: `1px solid ${DIVIDER}` }}
          >
            <OrderSummary snapshot={o.snapshot} stamp={formatTime(o.sentAt)} />
          </button>
        ))
      )}
    </ListShell>
  );
}

/**
 * The shared two-line row body for a stored order.
 *
 * The old row said only "{dealer} · N lines", which tells a salesman nothing
 * about which order it is — every row looked alike after a busy morning. What
 * he recognises an order by is what is IN it, so the second line is the
 * products themselves.
 */
function OrderSummary({ snapshot, stamp }: {
  snapshot: V2Snapshot; stamp: string;
}): React.JSX.Element {
  return (
    <>
      {/* min-w-0 lets both lines truncate instead of widening the row. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold" style={{ color: INK }}>
          {snapshot.customer.name}
        </span>
        <span className="block truncate text-[12px]" style={{ color: MUTED }}>
          {summaryLine(snapshot)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block whitespace-nowrap font-mono text-[11px]" style={{ color: MUTED }}>
          {stamp}
        </span>
        <span className="block whitespace-nowrap font-mono text-[11px]" style={{ color: MUTED }}>
          {unitsOf(snapshot)} units
        </span>
      </span>
    </>
  );
}
