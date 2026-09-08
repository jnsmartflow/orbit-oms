"use client";

import { ChevronLeft } from "lucide-react";
import { CARD_SHADOW, FAINT, INK, MUTED, PAGE, RULE, SURFACE } from "./v2-data";
import { NAV_H, OrderTins, Pill, dispatchLabel, productCount } from "./order-sheet";
import { formatTime, draftDisplayName, type V2SavedDraft, type V2SentOrder, type V2Snapshot } from "./v2-storage";

// The two list screens behind the board's bottom nav. Presentational only —
// every decision (replace or add, delete, rename, reload as a fresh order) is
// the page's, so both screens stay readable.
//
// 🔴 CONTAINMENT — imports ./v2-data, ./v2-storage, ./order-sheet and
// node_modules only.
//
// 🔴 CARDS, NOT ROWS, AND THE REASON IS RECOGNITION. Both lists used to be two
// lines of text: a dealer name and a comma-joined product string. After a busy
// morning every row looked alike, and the only way to tell two Mohan orders
// apart was to open both. A card carries the TINS, which is what a salesman
// actually recognises an order by — three blue tubs and a small white one is a
// different order from four green ones, at a glance and without reading.
//
// 🔴 NO UNIT TOTALS ON A ROW. They said "N units", which adds 1L tins to 20L
// drums and produces a number nobody can act on. "N products" is a fact.

/** The bottom nav sits over the list, so the last card needs its height back. */
const LIST_PAD = `calc(${NAV_H} + 16px)`;

function ListShell({ title, onBack, children }: {
  title: string; onBack: () => void; children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="min-h-screen w-full" style={{ background: PAGE, paddingBottom: LIST_PAD }}>
      <header
        className="sticky top-0 z-10 flex items-center gap-1 px-2 py-3"
        style={{ background: SURFACE, borderBottom: `1px solid ${RULE}` }}
      >
        {/* 44px, CLAUDE_UI §60's floor. It was h-8 w-8 — 32px — which is the
            one control on this screen a thumb has to hit first. */}
        <button
          type="button" aria-label="Back" onClick={onBack}
          className="flex h-11 w-11 shrink-0 items-center justify-center"
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

/** A section heading — the day on Sent, the kind of draft on Drafts. */
function Heading({ text }: { text: string }): React.JSX.Element {
  return (
    <h2 className="px-4 pb-1.5 pt-4 text-[11.5px] font-extrabold uppercase"
        style={{ color: FAINT, letterSpacing: ".08em" }}>
      {text}
    </h2>
  );
}

/**
 * "10:42" today · "Yesterday" · "Fri 18:05" older.
 *
 * Device-local and deliberately so, like every other caption in this app: the
 * IST rule is what PRUNES the list (v2-storage), and this only says when.
 */
function stampFor(ts: number): string {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(ts);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return `${d.toLocaleDateString("en-IN", { weekday: "short" })} ${formatTime(ts)}`;
}

/** Today · Yesterday · "Fri 5 Sep" — the day heading a sent card sits under. */
function dayHeading(ts: number): string {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * ONE CARD. The whole card is the tap target, so there is no "open" chevron to
 * aim at and no way to miss.
 *
 * `accent` is the left edge an In-progress card carries — see DraftsScreen for
 * why the two draft kinds must not look alike.
 */
function OrderCard({ title, subtitle, stamp, snapshot, status, statusTone, accent, onOpen, trailing }: {
  title: string;
  subtitle: string | null;
  stamp: string;
  snapshot: V2Snapshot;
  status: string;
  statusTone: "quiet" | "urgent" | "violet";
  accent?: string;
  onOpen: () => void;
  trailing?: React.ReactNode;
}): React.JSX.Element {
  const urgent = snapshot.dispatch === "Urgent";
  return (
    <div className="px-4 pb-2">
      <div className="relative overflow-hidden rounded-[14px]"
           style={{ background: SURFACE, boxShadow: CARD_SHADOW,
                    borderLeft: accent ? `3px solid ${accent}` : undefined }}>
        <button type="button" onClick={onOpen}
                className="block w-full px-3 py-3 text-left">
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold"
                    style={{ color: snapshot.customer || title ? INK : MUTED }}>
                {title}
              </span>
              {subtitle && (
                <span className="mt-0.5 block truncate font-mono text-[11.5px]" style={{ color: MUTED }}>
                  {subtitle}
                </span>
              )}
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono text-[11.5px]" style={{ color: MUTED }}>
              {stamp}
            </span>
          </span>

          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <Pill text={dispatchLabel(snapshot)} tone={urgent ? "urgent" : "quiet"} />
            <Pill text={status} tone={statusTone} />
          </span>

          <span className="mt-2.5 flex items-center justify-between gap-3">
            <OrderTins lines={snapshot.lines} />
            <span className="shrink-0 text-[12px] font-semibold" style={{ color: MUTED }}>
              {productCount(snapshot)}
            </span>
          </span>
        </button>
        {trailing}
      </div>
    </div>
  );
}

/**
 * SAVED DRAFTS — two sections, and the split is the point of the screen.
 *
 * 🔴 THE AUTO-SAVE AND A DRAFT HE PARKED ARE NOT THE SAME THING. One is the
 * order he is standing in the middle of, written every few seconds by the page
 * whether he asked or not; the other is a basket he deliberately named and
 * intends to reuse. They used to sit in one list looking identical, one tap
 * apart, and the failure that invites is loading last Tuesday's auto-save over
 * a named route order.
 *
 * So they are separated and drawn differently: In progress carries a violet
 * left edge, an "AUTO-SAVED" pill and no delete, because deleting it means
 * clearing the board and that belongs on the board. Saved cards are plain, and
 * they are the only ones that can be renamed or removed.
 */
export function DraftsScreen({ live, drafts, onBack, onOpenLive, onOpen }: {
  /** The board's own state, when it has lines. Null when the board is empty. */
  live: { snapshot: V2Snapshot; savedAt: number } | null;
  drafts: V2SavedDraft[];
  onBack: () => void;
  onOpenLive: () => void;
  onOpen: (draft: V2SavedDraft) => void;
}): React.JSX.Element {
  return (
    <ListShell title="Drafts" onBack={onBack}>
      {!live && drafts.length === 0 && <Empty text="No drafts yet." />}

      {live && (
        <>
          <Heading text="In progress" />
          <OrderCard
            title={live.snapshot.customer?.name ?? "No dealer yet"}
            subtitle={live.snapshot.customer?.code ?? null}
            stamp={stampFor(live.savedAt)}
            snapshot={live.snapshot}
            status="Auto-saved"
            statusTone="violet"
            accent="#7C3AED"
            onOpen={onOpenLive}
          />
        </>
      )}

      {drafts.length > 0 && (
        <>
          <Heading text="Saved" />
          {drafts.map((d) => (
            <OrderCard
              key={d.id}
              // draftDisplayName: his own name if he gave one, else the label
              // every row shows today. Nothing changes for an unnamed draft.
              title={draftDisplayName(d)}
              subtitle={d.snapshot.customer?.code ?? null}
              stamp={stampFor(d.savedAt)}
              snapshot={d.snapshot}
              status="Saved"
              statusTone="quiet"
              onOpen={() => onOpen(d)}
            />
          ))}
        </>
      )}
    </ListShell>
  );
}

/**
 * SENT — five IST days now, so it holds several, and it says which.
 *
 * Grouped by day under a light heading. Inside a group the card shows the CLOCK
 * only: "Yesterday" under a "Yesterday" heading is the same word twice.
 */
export function SentScreen({ orders, onBack, onOpen }: {
  orders: V2SentOrder[];
  onBack: () => void;
  onOpen: (order: V2SentOrder) => void;
}): React.JSX.Element {
  // Newest first. loadSentOrders already sorts, and grouping preserves it.
  const groups: { heading: string; orders: V2SentOrder[] }[] = [];
  for (const o of orders) {
    const heading = dayHeading(o.sentAt);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.orders.push(o);
    else groups.push({ heading, orders: [o] });
  }
  return (
    <ListShell title="Sent" onBack={onBack}>
      {orders.length === 0 ? (
        <Empty text="Nothing sent in the last five days." />
      ) : (
        groups.map((g) => (
          <div key={g.heading}>
            <Heading text={g.heading} />
            {g.orders.map((o) => (
              <OrderCard
                key={o.id}
                title={o.snapshot.customer?.name ?? "No dealer yet"}
                subtitle={o.snapshot.customer?.code ?? null}
                stamp={formatTime(o.sentAt)}
                snapshot={o.snapshot}
                status="Sent"
                statusTone="quiet"
                onOpen={() => onOpen(o)}
              />
            ))}
          </div>
        ))
      )}
    </ListShell>
  );
}
