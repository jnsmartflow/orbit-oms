"use client";

import type { CiBoardRow } from "@/lib/ci/types";

// Billing's left rail — frames 1-4 of docs/mockups/ci/billing.html.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE RAIL, TWO HEADINGS. THERE ARE NO PENDING/CLOSED TABS.
// ═══════════════════════════════════════════════════════════════════════════
//
// Both sections live in the SAME scrolling list, the way Mail Orders keeps
// pending and done together. Closing a CI moves its card from the top section
// down into the bottom one IN FRONT OF THE OPERATOR — that visible movement is
// the confirmation that the close landed, and it is the whole reason the tabs
// were dropped. A second tab would make the card vanish instead, which reads as
// "did that work?".
//
// 🔴 RAIL CARDS CARRY THE CI NUMBER AND THE CUSTOMER NAME. No litres, no value,
// no line count — in either section. The rail is for FINDING the CI; everything
// ABOUT it lives in the pane. (The time rides along because all four mockup
// frames draw it and it is how he tells two of a dealer's CIs apart — it is a
// timestamp, not a fact about the return.)
//
// ⚠ THE FULL/PART TAG IS THE ONE EXCEPTION, AND IT IS SPEC'd (2026-09-01).
// design §"Full bill is said three times": the teal tag beside the customer
// name in the pane, THE SAME TAG ON THE RAIL CARD, and "WHOLE BILL · all N
// lines" in the table header. It was missing here from step 5 onward, which
// left it said only twice.
//
// It does not violate the rule above: that rule excludes FACTS ABOUT THE RETURN
// — how much came back and what it is worth — because those are the pane's job
// and a rail crowded with them stops being scannable. Whole-bill vs part is not
// a quantity, it is what KIND of return this is, and it is the one where a
// wrong assumption costs most.
//
// ⚠ SOFT teal here, where the mockup's `.tag.full` is SOLID teal. Solid was
// drawn for the PANE, where exactly one is on screen. On the rail a column of
// solid-teal tags would compete with the selected card's teal, and selection
// has to stay the loudest thing on this list (UI §1 / §10). The pane's own
// ReturnTypeTag already uses the soft pair, so the two now match.
//
// 🔴 CLOSED CARDS ARE TOLD APART BY WEIGHT, NOT BY EXTRA DATA — grey ground,
// lighter name, under their own heading. No "Done" pill, no closed-at caption:
// the heading above them already says it once.
//
// ⚠ THE PENDING HEADING DISAPPEARS WHEN THERE IS NOTHING PENDING (mockup frame
// 4) rather than rendering an empty section, and the closed list stays exactly
// where it was. An "All caught up" line takes its place — that is a real state
// worth naming, not an empty container.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 A RAIL OF CARDS, NOT A BORDERED LIST (2026-09-01, step 7d).
// ═══════════════════════════════════════════════════════════════════════════
//
// This shipped as full-bleed rows divided by `border-b`, which is a LIST — and
// a list says its items are a sequence you read down. A rail of cards says they
// are separate objects you pick ONE of, which is what this rail is for. Every
// other desk rail in the app is cards: MRN's (components/mrn/rail-card.tsx),
// Floor's, Mail Orders'. The geometry is MRN's verbatim — `px-[11px]` on the
// scroll container, `mb-2` between cards, `rounded-[10px]` with a 1px border —
// so the two desks feel like one product rather than two.
//
// ⚠ NO RAIL HEAD. The mockup draws one ("Today · 17 CIs") and it is deliberately
// not built: the pending and closed COUNTS now live in the header's Row-1 stats
// (components/ci/billing-board.tsx), which is the app's count idiom. A rail head
// repeating them would be the third place the same two numbers appear.
//
// ⚠ THE SECTION HEADINGS ARE NO LONGER `sticky`. Inside a `px-[11px]` scroll
// container a sticky child has to be un-padded with negative margins to span the
// full width, and the mockup draws `.secHead` as a plain label + count + rule.
// Two headings over a rail this size do not need to follow the scroll.

export function CiRail({
  pending,
  closed,
  selectedId,
  onSelect,
  loading,
  dateLabel,
  searching,
}: {
  pending: CiBoardRow[];
  closed: CiBoardRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
  /** The day the stepper is on, e.g. "31 Aug" — names what the CLOSED half is
   *  scoped to, so the empty state cannot imply the pending half is too. */
  dateLabel: string;
  /** True when a search term is narrowing the rail, so an empty result is
   *  reported as a search miss rather than as an empty backlog. */
  searching: boolean;
}): React.JSX.Element {
  const empty = pending.length === 0 && closed.length === 0;

  return (
    /* 🔴 WHITE. The rail is the white surface and the PANE is the grey one —
       the grounds were the wrong way round until 2026-09-01. MRN, the CI mockup
       and Floor all put the ground behind the WORKING surface so the cards on
       the rail read as objects lifted off it; inverted, the pane's white content
       cards had nothing to lift off and the rail's rows had nothing to sit on.

       ⚠ NO WIDTH HERE. This is a GRID ITEM now — the 344px track is declared
       once in components/ci/billing-board.tsx. A width on the item as well would
       be a second place to change it, and the two would drift. */
    <div className="flex min-h-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-[11px] py-2.5">
      {loading && empty && (
        <p className="text-[12.5px] text-gray-400 text-center py-10">Loading…</p>
      )}

      {/* ⚠ THIS COPY USED TO READ "No CIs for this day." — WRONG, AND
          DANGEROUSLY SO. It described a rail that is entirely date-scoped, and
          this one is not: pending is the WHOLE BACKLOG and only closed takes the
          date (lib/ci/queries.ts buildCiBillingWhere). A billing operator
          reading "for this day" over an empty rail would reasonably conclude
          older pending work was hidden behind the stepper and go looking for it
          — or, worse, assume there was none. The billing Picking tab shipped
          exactly that misreading as a real bug.

          Three DIFFERENT facts, said separately, because they call for
          different actions:
            • a search that matched nothing  → change the search
            • no pending anywhere            → the backlog is genuinely clear
            • nothing closed on THIS day     → step the date */}
      {!loading && empty && (
        <div className="text-center py-10 px-4">
          {searching ? (
            <p className="text-[12.5px] text-gray-400">No CI matches that search.</p>
          ) : (
            <>
              <p className="text-[12.5px] font-semibold text-gray-600">Nothing pending</p>
              <p className="text-[11.5px] text-gray-400 mt-1 leading-snug">
                The backlog is clear, and nothing was closed on {dateLabel}.
              </p>
            </>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <>
          <RailHeading label="Pending" count={pending.length} first />
          {pending.map((row) => (
            <CiRailCard
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}

      {/* ⚠ NOT an empty "Pending" section — the heading is simply absent, and
          this says the true thing instead. Only shown when there IS closed work,
          so it reads as "you finished it" rather than "there is nothing here".
          ⚠ Suppressed while searching: "all caught up" would be a lie about the
          backlog when it is really a statement about the filter. */}
      {!searching && pending.length === 0 && closed.length > 0 && (
        <div className="px-4 py-5 text-center">
          <div className="text-[15px] text-[#0A7C4A]">✓</div>
          <div className="text-[12.5px] font-semibold text-gray-700 mt-1">All caught up</div>
          <div className="text-[11.5px] text-gray-400 mt-0.5 leading-snug">
            {/* No date here on purpose — pending is not date-scoped, so this is
                a statement about the whole backlog. */}
            Nothing is waiting on you.
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <>
          <RailHeading label="Closed" count={closed.length} />
          {closed.map((row) => (
            <CiRailCard
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
      </div>
    </div>
  );
}

/** Mockup `.secHead` — label, count, then a rule filling the rest of the width.
 *  The rule is what makes two sections read as two sections without a tab. */
function RailHeading({
  label,
  count,
  first = false,
}: {
  label: string;
  count: number;
  /** Trims the top padding on the first heading so the rail does not open with
   *  a band of dead space above the first card. */
  first?: boolean;
}): React.JSX.Element {
  return (
    <div className={"flex items-center gap-2 px-1 pb-2 " + (first ? "pt-0.5" : "pt-2.5")}>
      <span className="text-[10.5px] font-bold uppercase tracking-[0.11em] text-[#B7BFC5]">
        {label}
      </span>
      <span className="text-[10.5px] font-bold tabular-nums text-[#B7BFC5]">{count}</span>
      <span className="h-px flex-1 bg-[#EFF2F3]" />
    </div>
  );
}

function CiRailCard({
  row,
  selected,
  onSelect,
}: {
  row: CiBoardRow;
  selected: boolean;
  onSelect: (id: number) => void;
}): React.JSX.Element {
  const done = row.status === "closed";
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      className={
        // MRN's card geometry verbatim (components/mrn/rail-card.tsx): mb-2
        // between cards, rounded-[10px], a 1px border, px-[11px] py-2.5.
        "mb-2 w-full rounded-[10px] border px-[11px] py-2.5 text-left transition-colors " +
        // Selection is the strongest state and wins over the closed treatment —
        // a selected closed card must still read as the one being looked at.
        // 🔴 THE ONE TEAL ELEMENT ON THE RAIL (UI §1 / §10), same as MRN's.
        (selected
          ? "border-teal-600 bg-teal-50"
          : done
            ? // Mockup `.rcard.done`: the pack ground, a fainter border. Weight
              // and ground, never extra data, are what separate a closed card —
              // the heading above them already says "Closed" once.
              "border-[#EFF2F3] bg-[#F7F9FA] hover:bg-[#F1F4F5]"
            : "border-[#e6e9ec] bg-white hover:bg-gray-50")
      }
    >
      <div className="flex items-center gap-2">
        {/* `.rNo` — 12.5px/750 in ink-2. The number is what he quotes, not what
            he scans the rail for, so it is the quieter of the two lines. */}
        <span
          className={
            "min-w-0 truncate font-mono text-[12.5px] font-bold " +
            (selected ? "text-teal-700" : done ? "text-[#8a929c]" : "text-[#5C666E]")
          }
        >
          {row.ciNumber}
        </span>
        {/* ⚠ AUTO CIs ONLY, AND NOTHING CHANGES ON A MANUAL ONE — no tag, no
            reserved space, no gap. This is a sibling in a `gap-2` flex row, and
            a row with one fewer child has one fewer gap, so a manual card's DOM
            and metrics are byte-identical to before this existed.

            NEUTRAL, and it reuses the module's existing PART tone (#E7EBEC on
            #5C666E) — it is INFORMATION, not a warning, and the CI screens get
            no new colour for it. The word is what carries the meaning, as
            everywhere else in this module. */}
        {row.source === "auto_finding" && (
          <span
            className="shrink-0 rounded-full bg-[#E7EBEC] px-[6px] py-[2px] text-[9.5px] font-bold uppercase tracking-[0.05em] text-[#5C666E]"
            title="Raised automatically from a picking finding"
          >
            Auto
          </span>
        )}
        {/* Mention 2 of 3 (see the header). `shrink-0` so a long CI number
            truncates rather than squeezing the tag out of existence. */}
        <span
          className={
            "ml-auto shrink-0 rounded-full px-[6px] py-[2px] text-[9.5px] font-bold uppercase tracking-[0.05em] " +
            (row.returnType === "full"
              ? "bg-[#E7F4F2] text-teal-700"
              : "bg-[#E7EBEC] text-[#5C666E]")
          }
        >
          {row.returnType === "full" ? "Full bill" : "Part"}
        </span>
        <span className="shrink-0 text-[11.5px] tabular-nums text-[#B7BFC5]">
          {formatIstTime(done ? row.closedAt : row.submittedAt)}
        </span>
      </div>
      {/* `.rName` — the loudest thing on the card at 15.5px/700, dropping to
          14.5px and ink-2 once closed. */}
      <div
        className={
          "mt-[5px] truncate " +
          (done
            ? "text-[14.5px] font-semibold text-[#5C666E]"
            : "text-[15.5px] font-bold tracking-[-0.01em] text-gray-900")
        }
      >
        {row.customerName}
      </div>
    </button>
  );
}

/** "12:20" in IST. Blank input → em-dash; never a fabricated clock. */
function formatIstTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}
