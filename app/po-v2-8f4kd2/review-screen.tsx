"use client";

import { useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";
import {
  BRAND, CROSS_DEPOTS, DIVIDER, DOT_CALL, DOT_NORMAL, DOT_URGENT,
  FAINT, INK, MUTED, RULE, SCREEN_TITLE, SURFACE, VIOLET,
  chipStyle, memberImage, packRows, tileArtFor,
  type ApiCustomer, type V2CartLine, type V2CallTarget, type V2Dispatch,
  type V2Marker, type V2Order,
} from "./v2-data";
import V2Sheet from "./v2-sheet";

// Hidden v2 review screen — the last look before Send.
//
// 🔴 CONTAINMENT — imports ./v2-data, ./v2-sheet and node_modules only.
// (v2-sheet arrived here with the Call and Cross pickers. It is the ONE
// bottom-sheet shell in v2 and is used unchanged — see its own note.)
//
// SINGLE BILL. No "Bill 1", no Add bill, no multi. /po's multi-bill machinery
// is not carried over.
//
// 🔴 THIS SCREEN ASKS FOR THE DEALER, and it is the only screen that does. The
// board used to demand one before a single product could be tapped, which had
// it exactly backwards: a salesman standing in a shop wants to start adding,
// not answer a question. The dealer is a field on the way OUT.
//
// 🔴 EVERY CONTROL HERE EXISTS BECAUSE lib/place-order/email.ts READS IT.
// The Dispatch options produce its three literal `Dispatch:` values plus the
// omission; the Remark options are its four markers plus null; the cross-depot
// PICKER is what turns "Cross Billing Order" into "Cross Billing Order From
// {depot}" in buildSubject. Nothing here is decoration — step 9 wires each one
// straight into the mailto.

/** Sections are separated by a 9px band, never by a border or a card. */
function Band(): React.JSX.Element {
  return <div className="h-[10px] w-full" style={{ background: DIVIDER }} />;
}

/* Dispatch is THREE chips over TWO stored fields, and the Call chip owns both.
 *
 * 🔴 IT USED TO BE FOUR FLAT CHIPS — Normal, Urgent, Call · SO, Call · Dealer —
 * which put the routing question on the row whether or not anybody was calling.
 * Three is what /po has always shown (po-page.tsx:2932-2961) and what a
 * salesman answers: is this normal, is it urgent, or does somebody need
 * phoning. WHO to phone is a second question and it now gets a second screen.
 *
 * 🔴 NOTHING ABOUT WHAT IS STORED CHANGED. These are still the only four
 * (dispatch, callTarget) pairs email.ts can distinguish, and the picker still
 * writes exactly those literals:
 *   Normal + SO      -> the Dispatch: line is OMITTED
 *   Urgent + SO      -> "Dispatch: Urgent"
 *   Call   + SO      -> "Dispatch: Call to SO"
 *   Call   + Dealer  -> "Dispatch: Call to Dealer"
 * No union gained a member, no draft needs migrating, and v2-email.ts was not
 * opened. Normal and Urgent keep writing callTarget "SO" because that is what
 * the four-chip row wrote — V2CallTarget has no null and this is not the step
 * to give it one.
 */
const DISPATCH_CHOICES: { value: V2Dispatch; dot: string }[] = [
  { value: "Normal", dot: DOT_NORMAL },
  { value: "Urgent", dot: DOT_URGENT },
  { value: "Call",   dot: DOT_CALL },
];

/* SINGLE select — buildSubject takes ONE marker, so two remarks cannot both be
 * true.
 *
 * 🔴 THE "None" CHIP IS GONE AND NULL IS STILL REACHABLE. A fifth chip whose
 * entire job was to un-pick the other four is a control explaining a gesture
 * every phone user already has: tapping the selected thing again. All four now
 * toggle, which is what /po does (po-page.tsx:2978, `chooseMarker(on ? null :
 * m.value)`), and it is what made a single row possible — five chips do not fit
 * one line on a 320px phone and four do.
 *
 * ⚠ NO EMOJI, unchanged. /po's labels carry them (🚛 🔄 ↩️ 📦, po-page.tsx
 * :287-292); v2 has never rendered an icon or an emoji on these chips and this
 * step did not add one. Four bare words fit the row with margin to spare; four
 * words each preceded by a colour emoji do not.
 */
const MARKER_CHOICES: { label: string; value: NonNullable<V2Marker> }[] = [
  { label: "Truck",  value: "Truck" },
  { label: "Cross",  value: "Cross Delivery" },
  { label: "Bounce", value: "Bounce" },
  { label: "DTS",    value: "DTS" },
];

export default function ReviewScreen({
  dealer, shipTo, lines, order,
  onBack, onEdit, onRemoveLine, onOrderChange, onOpenDealer, onOpenShipTo, onSend,
  onSaveDraft, onClearOrder,
}: {
  /** NULL until he picks one — which he may leave until the last moment. */
  dealer: ApiCustomer | null;
  /** NULL means "same as billing" — the state email.ts omits the Ship To line for. */
  shipTo: ApiCustomer | null;
  lines: V2CartLine[];
  order: V2Order;
  onBack: () => void;
  onEdit: () => void;
  onRemoveLine: (id: string) => void;
  onOrderChange: (next: V2Order) => void;
  onOpenDealer: () => void;
  /** Opens the confirm. Clearing itself happens on the page, once. */
  onClearOrder: () => void;
  onOpenShipTo: () => void;
  /** Fires only with a dealer set. With none it opens the dealer sheet. */
  onSend: () => void;
  onSaveDraft: () => void;
}): React.JSX.Element {
  const shipElsewhere = shipTo !== null && shipTo.code !== dealer?.code;
  const canSend = dealer !== null;
  /** Save and Clear both need something to act on. See their note in the header. */
  const hasLines = lines.length > 0;

  /* 🔴 THE PICKERS COMMIT ON THE PICK AND ON NOTHING ELSE.
   *
   * Opening either sheet writes NO state. Only choosing a target or a depot
   * calls onOrderChange, and dismissing — scrim, or the sheet's own Cancel —
   * just sets this back to null. That is what makes a half-set Dispatch
   * impossible: there is no path that stores "Call" without also storing the
   * target in the same call, and none that stores "Cross Delivery" without its
   * depot. /po reached the same rule the same way (po-page.tsx:1580-1618) and
   * its comment says so in as many words. */
  const [sheet, setSheet] = useState<null | "call" | "cross">(null);

  const crossSet = order.marker === "Cross Delivery";

  return (
    <>
    <main className="min-h-screen w-full bg-white" style={{ paddingBottom: 192 }}>
      {/* ── HEADER ───────────────────────────────────────────────────────
          🔴 THE DEALER NAME IS THE TITLE *AND* THE CHANGE CONTROL. It used to
          be "Review order" with the dealer repeated in a block underneath and a
          "Change dealer" word beside two others — three ways of saying the same
          thing on one screen. Tapping the name is what a salesman tries first;
          the chevron is what tells him it will work, because an affordance
          nobody can see is one nobody discovers.

          THE DATE IS GONE. It was the order's own date on a screen he is
          looking at today.

          WHAT IS LEFT is the whole header: a back arrow, the name, its chevron,
          the code and area, and — at the right-hand end — the two things you do
          to an order INSTEAD of sending it. See the note on those buttons. */}
      <header
        className="sticky top-0 z-10 px-2 pt-3 pb-3"
        style={{ background: SURFACE, borderBottom: `1px solid ${RULE}` }}
      >
        {/* items-center, NOT items-start. The two 44px buttons now sit centred
            against the name block rather than hanging off its first line, and
            because the name is ONE line the block is a fixed 70px whatever the
            dealer is called. It used to be 60px with a short name and 76px with
            a wrapped one, so the whole page shifted down when a long dealer was
            picked — the items list moved under his thumb mid-review. */}
        <div className="flex items-center gap-1">
          <button
            type="button" aria-label="Back to products" onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} style={{ color: INK }} />
          </button>

          <button
            type="button" onClick={onOpenDealer}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <span className="min-w-0 flex-1">
              {/* 🔴 ONE LINE, THEN AN ELLIPSIS — it used to clamp to TWO.
                  Two lines were affordable when the header held nothing else;
                  with a bookmark and an X beside it the name has 146px at
                  320px, and a name allowed to wrap in 146px is what pushes the
                  icons off the screen edge. Truncating is the failure that
                  keeps every control reachable. The full name is one tap away
                  on the dealer screen, and the code below never truncates in
                  practice. */}
              <span
                className="block truncate"
                style={{ ...SCREEN_TITLE, color: dealer ? INK : VIOLET }}
              >
                {dealer ? dealer.name : "Choose dealer"}
              </span>
              {dealer && (
                <span className="mt-0.5 block truncate font-mono text-[12.5px]" style={{ color: MUTED }}>
                  {dealer.code}{dealer.area ? ` · ${dealer.area}` : ""}
                </span>
              )}
            </span>
            {/* ⚠ A GLYPH, NOT A TARGET, AND DELIBERATELY SO. It is INSIDE this
                button, so it fires the same onOpenDealer the name does — there
                is one action here wearing two faces. Promoting it to its own
                44px box would cost the name 26px of its 146 at 320px to add a
                second way to do a tap that already works everywhere across the
                name. §60 is met by the button around it, which is 46px tall and
                the width of the whole name. */}
            <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2.5}
                          style={{ color: dealer ? FAINT : VIOLET }} />
          </button>

          {/* ── SAVE AND CLEAR ───────────────────────────────────────────
              🔴 SIBLINGS OF THE DEALER BUTTON, NEVER INSIDE IT. A button
              inside a button is invalid HTML that React will not render
              predictably — the same shape, and the same reason, as
              CustomerRow's star and the drafts card's delete.

              🔴 WHAT THEY COST IS WIDTH, NOT HEIGHT. The name block is 46px
              tall at the screen-title size, so a 44px target sits inside the
              height that is already there and the row needs no second line.
              The 88px they take horizontally is why the name is min-w-0 and
              truncates: it has 146px at 320px and 216px at the 390px design
              width, and both numbers assume the ">" stays a glyph.

              🔴 DISABLED, NOT HIDDEN. Hiding them until the first line
              lands made the header reflow under his thumb at the exact
              moment he was reaching for something else. An order with no
              lines has nothing to file and nothing to clear, and a greyed
              control says that without moving.

              ⚠ `disabled` HERE, DELIBERATELY, AND NOT ON SEND. Send is
              never disabled because its one reason is recoverable and the
              button can say so. These two have no reason to give: the item
              list directly above is empty and that IS the explanation.

              ICON-ONLY, SO EACH CARRIES ITS WORDS IN aria-label. 18px glyph
              inside a 44px box — §60's floor is 44-48px and a glyph is not
              a target. */}
          <button
            type="button"
            aria-label="Save draft"
            onClick={onSaveDraft}
            disabled={!hasLines}
            className="flex shrink-0 items-center justify-center"
            style={{ width: 44, height: 44 }}
          >
            <Bookmark className="h-[18px] w-[18px]" strokeWidth={2.5}
                      style={{ color: hasLines ? MUTED : FAINT }} />
          </button>
          <button
            type="button"
            aria-label="Clear order"
            onClick={onClearOrder}
            disabled={!hasLines}
            className="flex shrink-0 items-center justify-center"
            style={{ width: 44, height: 44 }}
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2.5}
               style={{ color: hasLines ? MUTED : FAINT }} />
          </button>
        </div>

      </header>

      <Band />

      {/* ── ITEMS ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <h2 className="text-[16px] font-bold" style={{ color: INK }}>Items</h2>
        <button type="button" onClick={onEdit}
                className="text-[13px] font-extrabold" style={{ color: VIOLET }}>
          Edit
        </button>
      </div>

      <div>
        {lines.map((line) => {
          // 🔴 THE LINE'S OWN PRODUCT, THEN ITS TILE, THEN NOTHING.
          //
          // This asked tileArtFor and stopped there, so every line of a merged
          // tile carried its LEADER's tin: a Lustre line and an M900 Gloss line
          // both drew pu-enamel.webp, and nine Powerflexx products drew one
          // tub. The member sap is the catalog join key — the same
          // COALESCE(product, subProduct) the email reads — so it is on the
          // line already and needs no lookup.
          //
          // The TILE remains the fallback, deliberately: a product with no
          // photo of its own is better represented by its family's tub than by
          // an empty square, and that is what the cart already showed. The
          // wash always comes from the tile, because the wash IS the family.
          const tileArt = tileArtFor(line.tileSap);
          const art = {
            src: memberImage(line.product ?? line.subProduct) ?? tileArt.src,
            wash: tileArt.wash,
          };
          return (
          <div
            key={line.id}
            className="flex items-start gap-3 px-4"
            style={{ borderTop: `1px solid ${DIVIDER}`, paddingTop: 14, paddingBottom: 14 }}
          >
            {/* The tin, on its family wash — the same square the board uses, at
                46px. An image-less product gets the plain wash, exactly as its
                tile does, rather than a placeholder glyph. */}
            <span
              className="relative block shrink-0 overflow-hidden"
              style={{ width: 46, height: 46, borderRadius: 11, background: art.wash }}
            >
              {art.src && (
                <img
                  src={art.src} alt="" aria-hidden
                  width={600} height={600}
                  decoding="async" loading="lazy"
                  className="block h-full w-full"
                  // MULTIPLY for the same reason as the board: every file is an
                  // opaque white square, so painting it normally would cover
                  // the wash and leave 46px of white.
                  style={{ objectFit: "contain", mixBlendMode: "multiply" }}
                />
              )}
            </span>

            <div className="min-w-0 flex-1">
              {/* 🔴 THE NAME IS NEVER TRUNCATED, AND THE IMAGE NEVER WINS.
                  At 46px the tins are very nearly indistinguishable — four
                  Weathershield tubs, four Promise tubs, all the same shape in
                  the same blue. The photo helps him FIND the line in a list;
                  only the name tells him WHICH PRODUCT it is. So "Protect
                  Dustproof" wraps to a second line rather than becoming
                  "Protect Dust…", and if a longer name ever arrives it wraps
                  again. No truncate, no line-clamp, deliberately. */}
              <p className="text-[15px] font-semibold leading-snug" style={{ color: INK }}>
                {line.label}
              </p>
              {line.option && (
                <p className="mt-0.5 truncate text-[11.5px] font-extrabold uppercase"
                   style={{ color: VIOLET, letterSpacing: ".06em" }}>
                  {line.option}
                </p>
              )}
            </div>
            {/* 🔴 THE SIDEWAYS-SCROLL CULPRIT WAS THIS COLUMN. It carried
                `shrink-0` and its child was ONE comma-joined pack string, so a
                seven-pack line ("100ML ×24, 200ML ×12, 500ML ×12, 1L ×6, …")
                set an intrinsic width of ~400px that the column was forbidden
                to shrink below. The row then overflowed <main>, and with
                nothing clipping it the whole page dragged sideways.
                `min-w-0` lets it shrink again; stacking the packs (below) means
                the widest child is now one short row, so it never needs to. */}
            {/* 🔴 A FIXED 96px COLUMN, so a one-pack line and a four-pack line
                start at the same x and the figures read straight down the page.
                It used to be min-w-0 and shrink to its content, which put every
                line's numbers at a different left edge. shrink-0 because a
                fixed width that is allowed to shrink is not a fixed width. */}
            <div className="shrink-0 text-right" style={{ width: 96 }}>
              {/* Pack figures unchanged. The per-line "N units" subtotal that
                  used to sit under them is GONE: it was a number nobody acts
                  on — he orders packs, the depot picks packs, and the only
                  total that matters is the order's, which is still below. */}
              {packRows(line).map(({ label, qty }) => (
                <p key={label}
                   className="whitespace-nowrap font-mono text-[13px] tabular-nums"
                   style={{ color: INK, marginTop: 3 }}>
                  {label} ×{qty}
                </p>
              ))}
            </div>
            <button
              type="button" aria-label={`Remove ${line.label}`}
              onClick={() => onRemoveLine(line.id)}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"
            >
              <X className="h-4 w-4" strokeWidth={2.5} style={{ color: FAINT }} />
            </button>
          </div>
          );
        })}

        {/* 🔴 THE "Total N units" ROW IS GONE, 2026-09-08, AND WITH IT THE LAST
            UNIT TOTAL IN THE APP. Summing quantities across pack sizes adds 1L
            tins to 20L drums: six 1L and two 20L is "eight units" of nothing,
            and a figure a salesman cannot act on is worse than none at all. The
            per-line subtitle went for the same reason, and the drafts and sent
            screens never had one. The packs carry the quantities; the count of
            LINES is the only count. */}
      </div>

      <Band />

      {/* ── DISPATCH ─────────────────────────────────────────────────────── */}
      <Section title="Dispatch">
        {/* 🔴 THE SAME MECHANISM AS THE REMARK ROW BELOW — `flex gap-2` with
            `min-w-0 flex-1 truncate` on each chip — so the two rows cannot
            drift into two different layouts. Equal columns cannot overflow at
            any width, which is what retired the flex-wrap this row used to
            carry: wrapping was only ever there to survive a content-width
            "Call · Dealer" at 320px, and a column that truncates survives it
            without the row changing height. At 320px each column is ~90px and
            the label has ~59px of it, which seats "Call · SO" and ellipsises
            "Call · Dealer". The dot never shrinks. */}
        <div className="flex gap-2">
          {DISPATCH_CHOICES.map((c) => {
            const isCall = c.value === "Call";
            const active = order.dispatch === c.value;
            // The Call chip SAYS WHO, once one is set, so the row can be read
            // without opening anything. Same expression /po uses at :2944.
            const label = isCall && active ? `Call · ${order.callTarget}` : c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => (isCall
                  ? setSheet("call")
                  // Leaving Call resets the target to "SO" — the value the old
                  // four-chip row wrote for Normal and Urgent, kept so nothing
                  // stored moves. email.ts reads callTarget only when dispatch
                  // is "Call", so it is inert either way.
                  : onOrderChange({ ...order, dispatch: c.value, callTarget: "SO" }))}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-2 text-[13px] font-semibold"
                style={chipStyle(active)}
              >
                {/* 7px, aria-hidden, and never the only thing saying this —
                    the chip's own word carries the meaning and the dot only
                    makes the row scannable. shrink-0 so a squeezed column
                    ellipsises the WORD and never flattens the dot. */}
                <span className="block shrink-0 rounded-full" aria-hidden
                      style={{ width: 7, height: 7, background: c.dot }} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Band />

      {/* ── REMARK ───────────────────────────────────────────────────────── */}
      <Section title="Remark">
        {/* ONE ROW, NO WRAP, NO SCROLLER. Four equal columns rather than four
            content-width chips: at 320px the four words plus their padding come
            to about 275 of the 288px available, which fits but with nothing
            left over for a font that measures a little wider than expected.
            Equal columns cannot overflow at any width, and they give the four
            the same tap target — which content-width chips did not, "DTS" being
            barely half the width of "Bounce". */}
        <div className="flex gap-2">
          {MARKER_CHOICES.map((c) => {
            const on = order.marker === c.value;
            const isCross = c.value === "Cross Delivery";
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  // CROSS, UNSET: ask for the depot first and commit nothing.
                  if (isCross && !on) { setSheet("cross"); return; }
                  // 🔴 EVERYTHING ELSE CLEARS THE DEPOT, including tapping
                  // Cross to turn it OFF. A depot left behind on a non-Cross
                  // order is invisible — nothing renders it — until somebody
                  // picks Cross again months later and the subject silently
                  // carries a depot he never chose for this order.
                  onOrderChange({ ...order, marker: on ? null : c.value, crossDepot: "" });
                }}
                className="min-w-0 flex-1 truncate px-2 py-2 text-[13px] font-semibold"
                style={chipStyle(on)}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Cross carries its source depot into the SUBJECT — with it the prefix
            is "Cross Billing Order From {depot}", without it just "Cross
            Billing Order", and the body's Remark: line trails off as "Cross
            billing from". So the depot is never optional once Cross is on, and
            this line is how he sees which one he picked and changes it.

            🔴 IT PRINTS WHATEVER IS STORED. A draft saved before the picker
            existed holds a hand-TYPED depot, which may be a fifth name or a
            misspelling. It renders here as it was typed and emails as it was
            typed. Nothing on this screen checks a stored depot against
            CROSS_DEPOTS, and nothing ever should — see that const's own note. */}
        {crossSet && order.crossDepot.trim() && (
          <p className="mt-2 text-[12.5px]" style={{ color: MUTED }}>
            Cross billing from {order.crossDepot.trim()}
            {" · "}
            <button type="button" onClick={() => setSheet("cross")}
                    className="font-extrabold" style={{ color: VIOLET }}>
              change
            </button>
          </p>
        )}
      </Section>

      <Band />

      {/* ── NOTES ────────────────────────────────────────────────────────── */}
      <Section title="Notes">
        <textarea
          value={order.notes}
          onChange={(e) => onOrderChange({ ...order, notes: e.target.value })}
          placeholder="Notes · optional"
          rows={3}
          className="w-full resize-none rounded-[12px] px-3 py-2.5 text-[16px] outline-none placeholder:text-[#9C99AC]"
          style={{ border: `1.5px solid ${RULE}`, color: INK }}
        />
      </Section>

      {/* ── FOOTER — ship-to above Send, both always visible ──────────────── */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 bg-white"
        style={{ borderTop: `1px solid ${RULE}`, paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
      >
        {/* Ship-to is a WORD, not a pencil. Sending an order to the wrong
            address is expensive, so the control that changes it says what it
            does, and the row shouts when it is not the billing dealer. */}
        <button
          type="button" onClick={onOpenShipTo}
          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
          style={{ borderBottom: `1px solid ${DIVIDER}` }}
        >
          <MapPin className="h-4 w-4 shrink-0" strokeWidth={2.5}
                  style={{ color: shipElsewhere ? VIOLET : FAINT }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold"
                  style={{ color: shipElsewhere ? VIOLET : INK }}>
              {shipElsewhere ? `Ship to · ${shipTo.name}` : "Ship to · same as billing"}
            </span>
            <span className="block truncate text-[12px]" style={{ color: MUTED }}>
              {shipElsewhere ? (shipTo.area ?? shipTo.code) : (dealer?.area ?? dealer?.code ?? "—")}
            </span>
          </span>
          <span className="shrink-0 text-[12.5px] font-extrabold" style={{ color: VIOLET }}>
            Change
          </span>
        </button>

        {/* ⚠ SAVE AND CLEAR ARE NOT HERE ANY MORE — they are in the header,
            as icons, and their note lives with them. The footer holds the
            ship-to row and ONE button. Do not put a second word beside Send:
            the footer is the send bar, and every extra target on it is a
            target a thumb can hit while reaching for the one that matters. */}
        <div className="px-4 pt-2.5">
          {/* 🔴 NOT `disabled`. A dead button tells a salesman nothing about why
              it is dead, and this one has exactly one reason. Tapping it with no
              dealer OPENS THE DEALER SHEET and then comes back here — it never
              sends on his behalf. An order that leaves on its own is the single
              mistake this screen exists to prevent, so picking a dealer returns
              him to a finished order with a live button and he presses it
              himself, looking at what goes out. */}
          <button
            type="button"
            onClick={onSend}
            aria-disabled={!canSend}
            className="w-full rounded-[13px] py-3 text-[15px] font-extrabold text-white"
            style={{ background: canSend ? BRAND : FAINT }}
          >
            {canSend ? "Send order" : "Choose dealer to send"}
          </button>
        </div>
      </div>
    </main>

    {/* ── THE CALL PICKER ─────────────────────────────────────────────────
        Who gets phoned. Dismissing leaves Dispatch exactly where it was, so
        "Call" with nobody to call cannot be stored. */}
    {sheet === "call" && (
      <V2Sheet onClose={() => setSheet(null)}>
        <PickerSheet
          title="Call to?"
          options={CALL_TARGETS}
          selected={order.dispatch === "Call" ? order.callTarget : null}
          onPick={(t) => {
            onOrderChange({ ...order, dispatch: "Call", callTarget: t });
            setSheet(null);
          }}
        />
      </V2Sheet>
    )}

    {/* ── THE CROSS-DEPOT PICKER ──────────────────────────────────────────
        Where the goods are billed FROM. Dismissing leaves the Remark exactly
        where it was, so Cross without a depot cannot be stored.

        `selected` compares the STORED string to the four offered. A depot
        typed before this picker existed matches none of them, so none is
        lit — and that is right: nothing has been picked from THIS list. The
        stored value is untouched and still shows in the line above. */}
    {sheet === "cross" && (
      <V2Sheet onClose={() => setSheet(null)}>
        <PickerSheet
          title="Cross billing from?"
          options={CROSS_DEPOTS}
          selected={crossSet ? order.crossDepot.trim() : null}
          onPick={(d) => {
            onOrderChange({ ...order, marker: "Cross Delivery", crossDepot: d });
            setSheet(null);
          }}
        />
      </V2Sheet>
    )}
    </>
  );
}

/** The two targets, beside CROSS_DEPOTS so both pickers read the same. */
const CALL_TARGETS: readonly V2CallTarget[] = ["SO", "Dealer"] as const;

/**
 * One list of choices in a sheet, used by both pickers.
 *
 * Two rows, not a grid: /po lays these out `grid grid-cols-2` at 48px, which
 * puts "Ahmedabad" and "Dahisar" side by side in half a phone. A sheet has the
 * whole width and no reason to halve it, and a stacked list is the shape every
 * other v2 sheet already uses.
 *
 * 🔴 NO CANCEL BUTTON, AND THAT IS THE POINT. V2Sheet's scrim closes it and
 * the grab bar says it is draggable; a footer would make dismissing look like
 * a third choice beside SO and Dealer, when dismissing is the ABSENCE of a
 * choice. The commit rule lives in the onPick handler, once, at each call site.
 */
function PickerSheet<T extends string>({ title, options, selected, onPick }: {
  title: string;
  options: readonly T[];
  selected: string | null;
  onPick: (value: T) => void;
}): React.JSX.Element {
  return (
    <div className="px-4 pt-1.5 pb-3">
      <h2 className="mb-3 text-[18px] font-bold" style={{ color: INK, letterSpacing: "-0.025em" }}>
        {title}
      </h2>
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            // 48px — above §60's 44px floor, and these are the only targets on
            // the sheet, so there is room to be generous.
            className="w-full px-4 text-left text-[15px] font-semibold"
            style={{ ...chipStyle(selected === o), height: 48 }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: {
  title: string; children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="px-4 pt-3 pb-3">
      <h2 className="mb-2 text-[16px] font-bold" style={{ color: INK }}>{title}</h2>
      {children}
    </div>
  );
}
