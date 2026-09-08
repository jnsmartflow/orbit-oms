"use client";

import { FAINT, INK, MUTED, RULE, SURFACE, VIOLET } from "./v2-data";
import {
  Chip, IconBolt, IconBox, IconPhone, IconReply, IconTrash, IconTruck,
  NAV_H, SectionLabel, CARD_PAD, LIST_BG, cardFrame, dispatchLabel,
} from "./order-sheet";
import { formatTime, draftDisplayName, type V2SavedDraft, type V2SentOrder, type V2Snapshot } from "./v2-storage";

// The two list screens behind the board's bottom nav. Presentational only —
// every decision (replace or add, delete, rename, reload as a fresh order) is
// the page's, so both screens stay readable.
//
// 🔴 CONTAINMENT — imports ./v2-data, ./v2-storage, ./order-sheet and
// node_modules only.
//
// 🔴 THE TYPE SCALE IS order-sheet.tsx's, AND IT IS STATED THERE IN FULL. Ten
// roles, T1–T10, and every text node below carries its tag in a comment. The
// list screens and the detail screen are one design in two files, so the scale
// has one home and the section label is literally the same component.
//
// 🔴 NO UNIT TOTALS ON A CARD. They said "N units", which adds 1L tins to 20L
// drums and produces a number nobody can act on. The COUNT CHIP is a fact.

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
    <main className="min-h-screen w-full" style={{ background: LIST_BG, paddingBottom: LIST_PAD }}>
      <header
        className="sticky top-0 z-10 px-4 py-3"
        style={{ background: SURFACE, borderBottom: `1px solid ${RULE}` }}
      >
        {/* T1 screen title — 20 / 700 / -.02em */}
        <h1 className="text-[20px] font-bold leading-tight"
            style={{ color: INK, letterSpacing: "-0.02em" }}>
          {title}
        </h1>
      </header>
      {children}
    </main>
  );
}

/** Empty state: one grey line, nothing else. No illustration, no call to action. */
function Empty({ text }: { text: string }): React.JSX.Element {
  /* T8 row value — 14 / 500, in FAINT because it describes an absence */
  return <p className="px-4 py-12 text-center text-[14px] font-medium" style={{ color: FAINT }}>{text}</p>;
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

/* ── THE CARD'S GEOMETRY, STATED AS NUMBERS ──────────────────────────────
 *
 * 🔴 112px, AND THE 65px VERSION WAS THE WRONG DIRECTION. Cutting the card to
 * two tight rows made the list SHORTER, not calmer: nine cards of 65px with no
 * air in them read as a printout, and the owner's word for it was FLAT. A card
 * is an object you can pick out with your eye, and an object needs room around
 * its contents, not just fewer of them.
 *
 *   14  padding top
 *   22  the dealer name          T4  17 / 500
 *    4
 *   16  "code · area"            T5  12 mono / MUTED
 *   14
 *   26  the chip row             T6  12 / 600 + 13px icons — and the time
 *   14  padding bottom
 *    2  the 1px border, top and bottom
 *  ───
 *  112
 */
const NAME_LH  = 22;
const META_LH  = 16;
const CHIP_H   = 26;

/**
 * ONE CARD, THREE ROWS. The whole card is the tap target — no "open" chevron
 * to aim at and no way to miss.
 *
 *   row 1   the dealer name, ellipsised          · a delete icon, DRAFTS only
 *   row 2   "code · area", directly beneath it
 *   row 3   the chips                            · the time, far right
 *
 * 🔴 THE COUNT CHIP IS ALWAYS FIRST, AND THAT IS THE ALIGNMENT FIX. Every card
 * carries one, no card carries two, so it holds the same x on every row of the
 * list whatever follows it — and a salesman reading down the list is reading
 * one column of numbers, not hunting for where the count landed this time. It
 * is done with ORDER, not with a fixed-width column: a column would have to be
 * wide enough for the widest chip on any card and would leave a hole on the
 * ones that have none.
 *
 * 🔴 NO TIN THUMBNAILS. A third row once carried up to four of them, on the
 * reasoning that a salesman recognises an order by its shape. At 30px he does
 * not: most orders are three or four near-identical blue Dulux tubs. The tins
 * are in the DETAIL at 46px, where they read.
 *
 * 🔴 NO STATUS PILL EITHER, ANY MORE. "SAVED" under a heading that says Saved,
 * on a screen called Drafts, is the same word three times. What genuinely
 * differs — the live auto-save — is already said twice over by its own heading
 * and its violet edge.
 *
 * `accent` is that left edge; see DraftsScreen for why the two draft kinds must
 * not look alike.
 */
function OrderCard({ title, code, area, stamp, snapshot, accent, onOpen, onDelete }: {
  title: string;
  code: string | null;
  /** AREA IS REAL — ApiCustomer carries it. Null on the two dealers without one. */
  area: string | null;
  stamp: string;
  snapshot: V2Snapshot;
  accent?: string;
  onOpen: () => void;
  /**
   * 🔴 DRAFTS ONLY, AND ONLY WHEN THE PAGE HANDS IT DOWN.
   *
   * Deleting a draft means removeSavedDraft + the confirm sheet + the page's
   * own savedDrafts state, all of which live in po-v2-page.tsx. This file must
   * not reach into storage behind the page's back — that is how a list gets out
   * of step with what is stored, and it would skip the confirm. So the card
   * takes a callback and the icon renders only when there is one: a Sent card
   * never gets it, and neither does the live auto-save, because deleting THAT
   * means clearing the board and that belongs on the board.
   */
  onDelete?: () => void;
}): React.JSX.Element {
  const urgent = snapshot.dispatch === "Urgent";
  const n = snapshot.lines.length;
  // 🔴 snapshotOf STORES shipToCode ONLY WHEN IT DIFFERS from the billing
  // dealer, so a non-null value already means "somewhere else". There is no
  // second comparison to make and no way for the two to disagree.
  const elsewhere = snapshot.shipToCode !== null;
  return (
    <div className="px-4 pb-2">
      {/* A DIV HOLDING BUTTONS, not a button — the delete icon is a second
          target inside the card's own bounds, and a button inside a button is
          invalid HTML that React will not render predictably. Same shape, and
          the same reason, as CustomerRow's star. */}
      <div className="relative"
           style={{ ...cardFrame, borderLeft: accent ? `3px solid ${accent}` : cardFrame.border }}>
        <button type="button" onClick={onOpen}
                className="block w-full text-left"
                style={{ padding: CARD_PAD }}>
          {/* ── row 1 ── the name, and the delete icon's gutter ── */}
          {/* T4 card title — 17 / 500. NOT 700: §60, weight is the heavy dial,
              and size is what carries this line now. */}
          <span className="block truncate text-[17px] font-medium"
                style={{ color: snapshot.customer ? INK : MUTED,
                         lineHeight: `${NAME_LH}px`,
                         paddingRight: onDelete ? 32 : 0 }}>
            {title}
          </span>
          {/* ── row 2 ── code · area, one block under the name ── */}
          {/* T5 card meta — 12 mono / MUTED */}
          <span className="block truncate font-mono text-[12px]"
                style={{ color: MUTED, lineHeight: `${META_LH}px`, marginTop: 4 }}>
            {code ?? "No dealer yet"}{code && area ? ` · ${area}` : ""}
          </span>
          {/* ── row 3 ── the chips, then the time ── */}
          <span className="flex items-center gap-1.5"
                style={{ marginTop: 14, height: CHIP_H }}>
            {/* 🔴 ALWAYS FIRST, ON EVERY CARD. */}
            <Chip icon={<IconBox />} text={String(n)} />
            {urgent && <Chip icon={<IconBolt />} text="Urgent" tone="urgent" />}
            {snapshot.dispatch === "Call" && (
              <Chip icon={<IconPhone />} text={dispatchLabel(snapshot)} />
            )}
            {elsewhere && <Chip icon={<IconTruck />} text="Ship to" tone="violet" />}
            {snapshot.marker && <Chip icon={<IconReply />} text={snapshot.marker} />}
            {/* T5 card meta — 12 mono / MUTED. ml-auto, so it is at the far
                right whether the card carries one chip or four. */}
            <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[12px]"
                  style={{ color: MUTED }}>
              {stamp}
            </span>
          </span>
        </button>

        {/* 44px — §60's floor, and it has to be its own target: a miss here
            opens the draft instead of deleting it, which is the harmless way
            round, but a miss the OTHER way is not. It sits over the card's
            top-right corner, outside the open button. */}
        {onDelete && (
          <button
            type="button" aria-label={`Delete ${title}`} onClick={onDelete}
            className="absolute flex h-11 w-11 items-center justify-center"
            style={{ top: 1, right: 1, color: FAINT }}
          >
            <IconTrash />
          </button>
        )}
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
 * left edge and no delete, because deleting it means clearing the board and
 * that belongs on the board. Saved cards are the only ones that can be renamed
 * or removed.
 */
export function DraftsScreen({ live, drafts, onOpenLive, onOpen, onDelete }: {
  /** The board's own state, when it has lines. Null when the board is empty. */
  live: { snapshot: V2Snapshot; savedAt: number } | null;
  drafts: V2SavedDraft[];
  onOpenLive: () => void;
  onOpen: (draft: V2SavedDraft) => void;
  /**
   * 🔴 THE DELETE ICON ON A SAVED CARD, AND IT IS OPTIONAL ON PURPOSE.
   *
   * The confirm sheet, removeSavedDraft and the savedDrafts state all belong to
   * po-v2-page.tsx. Until it hands this down, the icon does not render — which
   * is the honest failure: a card with no delete, not a delete that skips the
   * confirm or leaves the list out of step with storage.
   */
  onDelete?: (draft: V2SavedDraft) => void;
}): React.JSX.Element {
  return (
    <ListShell title="Drafts">
      {!live && drafts.length === 0 && <Empty text="No drafts yet." />}

      {live && (
        <>
          <SectionLabel text="In progress" />
          <OrderCard
            title={live.snapshot.customer?.name ?? "No dealer yet"}
            code={live.snapshot.customer?.code ?? null}
            area={live.snapshot.customer?.area ?? null}
            stamp={stampFor(live.savedAt)}
            snapshot={live.snapshot}
            accent={VIOLET}
            onOpen={onOpenLive}
          />
        </>
      )}

      {drafts.length > 0 && (
        <>
          <SectionLabel text="Saved" />
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
              onOpen={() => onOpen(d)}
              onDelete={onDelete ? () => onDelete(d) : undefined}
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
 *
 * NO DELETE ICON HERE, and not by omission: a sent order is a record of
 * something that left the phone. It ages out on its own after five IST days.
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
            <SectionLabel text={g.heading} />
            {g.orders.map((o) => (
              <OrderCard
                key={o.id}
                title={o.snapshot.customer?.name ?? "No dealer yet"}
                code={o.snapshot.customer?.code ?? null}
                area={o.snapshot.customer?.area ?? null}
                stamp={formatTime(o.sentAt)}
                snapshot={o.snapshot}
                onOpen={() => onOpen(o)}
              />
            ))}
          </div>
        ))
      )}
    </ListShell>
  );
}
