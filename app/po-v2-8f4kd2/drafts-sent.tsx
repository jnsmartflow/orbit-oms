"use client";

import { CARD_SHADOW, FAINT, INK, MUTED, PAGE, RULE, SURFACE } from "./v2-data";
import { NAV_H, Pill, dispatchLabel } from "./order-sheet";
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

/**
 * 🔴 NO BACK ARROW. The bottom nav is the way back from a LIST — Board is one
 * tap and it is already on screen — so a chevron beside the title was a second
 * control for the same job, in the corner furthest from a thumb. The DETAIL
 * screen keeps its chevron, because from there the nav goes to the board and
 * the chevron goes back to the list, which are two different places.
 */
function ListShell({ title, children }: {
  title: string; children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="min-h-screen w-full" style={{ background: PAGE, paddingBottom: LIST_PAD }}>
      <header
        className="sticky top-0 z-10 px-4 py-3"
        style={{ background: SURFACE, borderBottom: `1px solid ${RULE}` }}
      >
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
 * ONE CARD, TWO ROWS. The whole card is the tap target, so there is no "open"
 * chevron to aim at and no way to miss.
 *
 *   row 1   dealer name, ellipsised · the time, right
 *   row 2   "code · area" · the count and the dispatch tag, right
 *
 * 🔴 THE TIN THUMBNAILS ARE GONE. A third row carried up to four of them, on
 * the reasoning that a salesman recognises an order by its shape. At 30px he
 * does not: most orders are three or four near-identical blue Dulux tubs, and
 * the row cost every card a third of its height to say nothing. The tins are
 * still in the DETAIL at 46px, beside the product name, where they read.
 *
 * `accent` is the left edge an In-progress card carries — see DraftsScreen for
 * why the two draft kinds must not look alike.
 */
function OrderCard({ title, code, area, stamp, snapshot, status, statusTone, accent, onOpen }: {
  title: string;
  code: string | null;
  /** AREA IS REAL — ApiCustomer carries it. Null on the two dealers without one. */
  area: string | null;
  stamp: string;
  snapshot: V2Snapshot;
  status: string;
  statusTone: "quiet" | "urgent" | "violet";
  accent?: string;
  onOpen: () => void;
}): React.JSX.Element {
  const urgent = snapshot.dispatch === "Urgent";
  const n = snapshot.lines.length;
  // 🔴 snapshotOf STORES shipToCode ONLY WHEN IT DIFFERS from the billing
  // dealer, so a non-null value already means "somewhere else". There is no
  // second comparison to make and no way for the two to disagree.
  const elsewhere = snapshot.shipToCode !== null;
  return (
    <div className="px-4 pb-2">
      <div className="overflow-hidden rounded-[14px]"
           style={{ background: SURFACE, boxShadow: CARD_SHADOW,
                    borderLeft: accent ? `3px solid ${accent}` : undefined }}>
        <button type="button" onClick={onOpen} className="block w-full px-3 py-3 text-left">
          {/* ── row 1 ── */}
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold"
                  style={{ color: snapshot.customer ? INK : MUTED }}>
              {title}
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono text-[11.5px]" style={{ color: MUTED }}>
              {stamp}
            </span>
          </span>
          {/* ── row 2 ── */}
          <span className="mt-1 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: MUTED }}>
              {code ? <span className="font-mono">{code}</span> : "No dealer yet"}
              {code && area ? ` · ${area}` : ""}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {elsewhere && <Pill text="Ship to" tone="violet" />}
              <span className="text-[11.5px] font-semibold" style={{ color: MUTED }}>
                {n} {n === 1 ? "product" : "products"}
              </span>
              {urgent
                ? <Pill text="Urgent" tone="urgent" />
                : snapshot.dispatch !== "Normal" && <Pill text={dispatchLabel(snapshot)} tone="quiet" />}
              {statusTone === "violet" && <Pill text={status} tone="violet" />}
            </span>
          </span>
        </button>
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
export function DraftsScreen({ live, drafts, onOpenLive, onOpen }: {
  /** The board's own state, when it has lines. Null when the board is empty. */
  live: { snapshot: V2Snapshot; savedAt: number } | null;
  drafts: V2SavedDraft[];
  onOpenLive: () => void;
  onOpen: (draft: V2SavedDraft) => void;
}): React.JSX.Element {
  return (
    <ListShell title="Drafts">
      {!live && drafts.length === 0 && <Empty text="No drafts yet." />}

      {live && (
        <>
          <Heading text="In progress" />
          <OrderCard
            title={live.snapshot.customer?.name ?? "No dealer yet"}
            code={live.snapshot.customer?.code ?? null}
            area={live.snapshot.customer?.area ?? null}
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
              code={d.snapshot.customer?.code ?? null}
              area={d.snapshot.customer?.area ?? null}
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
export function SentScreen({ orders, onOpen }: {
  orders: V2SentOrder[];
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
    <ListShell title="Sent">
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
                code={o.snapshot.customer?.code ?? null}
                area={o.snapshot.customer?.area ?? null}
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
