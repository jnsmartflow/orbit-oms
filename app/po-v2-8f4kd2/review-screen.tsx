"use client";

import { ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";
import {
  BRAND, DIVIDER, FAINT, INK, MUTED, RULE, VIOLET,
  chipStyle, packRows, tileArtFor, unitsIn,
  type ApiCustomer, type V2CartLine, type V2Marker, type V2Order,
} from "./v2-data";

// Hidden v2 review screen — the last look before Send.
//
// 🔴 CONTAINMENT — imports ./v2-data and node_modules only.
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
// input is what turns "Cross Billing Order" into "Cross Billing Order From
// {depot}" in buildSubject. Nothing here is decoration — step 9 wires each one
// straight into the mailto.

/** Sections are separated by a 9px band, never by a border or a card. */
function Band(): React.JSX.Element {
  return <div className="h-[10px] w-full" style={{ background: DIVIDER }} />;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "06 Sep" — the order's own date, shown so a screenshot is self-dating. */
function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
}

// Dispatch is (dispatch, callTarget) collapsed into one row of four choices,
// because those four are the only states email.ts can distinguish:
//   Normal        -> the Dispatch: line is OMITTED
//   Urgent        -> "Dispatch: Urgent"
//   Call · SO     -> "Dispatch: Call to SO"
//   Call · Dealer -> "Dispatch: Call to Dealer"
const DISPATCH_CHOICES: { label: string; dispatch: V2Order["dispatch"]; callTarget: V2Order["callTarget"] }[] = [
  { label: "Normal",        dispatch: "Normal", callTarget: "SO" },
  { label: "Urgent",        dispatch: "Urgent", callTarget: "SO" },
  { label: "Call · SO",     dispatch: "Call",   callTarget: "SO" },
  { label: "Call · Dealer", dispatch: "Call",   callTarget: "Dealer" },
];

// SINGLE select — buildSubject takes ONE marker, so two remarks cannot both be
// true. "None" is the null marker: no Remark: line, subject prefix "Order".
const MARKER_CHOICES: { label: string; value: V2Marker }[] = [
  { label: "None",   value: null },
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
  const totalUnits = lines.reduce((sum, l) => sum + unitsIn(l.qtys), 0);
  const shipElsewhere = shipTo !== null && shipTo.code !== dealer?.code;
  const canSend = dealer !== null;

  return (
    <main className="min-h-screen w-full bg-white" style={{ paddingBottom: 148 }}>
      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 flex items-center gap-2 bg-white px-2 py-3"
        style={{ borderBottom: `1px solid ${RULE}` }}
      >
        <button
          type="button" aria-label="Back to products" onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} style={{ color: INK }} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-extrabold" style={{ color: INK, letterSpacing: "-0.02em" }}>
          Review order
        </h1>
        {/* ── CLEAR ORDER — the only way to empty the cart ─────────────────
            🔴 QUIET TEXT, AND MUTED RATHER THAN RED. Two things follow from the
            colour system: destructive is an outline trigger, and solid urgent
            belongs inside the confirm — never loose on a screen where a thumb
            can reach it by accident. Red here would also put a second accent
            beside Save draft's violet and make the header argue with itself.
            The weight lands on the confirm's button instead.

            It sits LEFT of Save draft on purpose: the right edge is where a
            right-handed thumb rests, so the harmless action gets that spot. */}
        <button
          type="button" onClick={onClearOrder}
          className="shrink-0 text-[13.5px] font-extrabold" style={{ color: MUTED }}
        >
          Clear order
        </button>
        {/* A generated label, never typed — the salesman is mid-order, not
            mid-filing. */}
        <button
          type="button" onClick={onSaveDraft}
          className="shrink-0 pr-3 text-[13.5px] font-extrabold" style={{ color: VIOLET }}
        >
          Save draft
        </button>
      </header>

      {/* ── DEALER — the one question this screen exists to ask ───────────
          Empty, it is the ONLY violet thing above the Send button, so on a
          screen full of chips and totals the eye lands on the thing that is
          actually missing. */}
      <button
        type="button" onClick={onOpenDealer}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {dealer ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-extrabold"
                    style={{ color: INK, letterSpacing: "-0.02em" }}>
                {dealer.name}
              </span>
              <span className="block truncate text-[12.5px]" style={{ color: MUTED }}>
                {[dealer.code, dealer.area, today()].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 text-[12.5px] font-extrabold" style={{ color: VIOLET }}>
              Change
            </span>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-extrabold"
                    style={{ color: VIOLET, letterSpacing: "-0.02em" }}>
                Choose dealer
              </span>
              <span className="block truncate text-[12.5px]" style={{ color: MUTED }}>
                {today()}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2.5} style={{ color: VIOLET }} />
          </>
        )}
      </button>

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
          const art = tileArtFor(line.tileSap);
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
            <div className="min-w-0 text-right">
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

        <div className="flex items-center justify-between px-4 py-2.5"
             style={{ borderTop: `1px solid ${DIVIDER}` }}>
          <span className="text-[15px] font-bold" style={{ color: INK }}>Total</span>
          <span className="font-mono text-[15px] font-bold" style={{ color: INK }}>
            {totalUnits} units
          </span>
        </div>
      </div>

      <Band />

      {/* ── DISPATCH ─────────────────────────────────────────────────────── */}
      <Section title="Dispatch">
        <div className="flex flex-wrap gap-2">
          {DISPATCH_CHOICES.map((c) => {
            const active = order.dispatch === c.dispatch
              && (c.dispatch !== "Call" || order.callTarget === c.callTarget);
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => onOrderChange({ ...order, dispatch: c.dispatch, callTarget: c.callTarget })}
                className="px-3 py-2 text-[13px] font-semibold"
                style={chipStyle(active)}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Band />

      {/* ── REMARK ───────────────────────────────────────────────────────── */}
      <Section title="Remark">
        <div className="flex flex-wrap gap-2">
          {MARKER_CHOICES.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => onOrderChange({
                ...order,
                marker: c.value,
                // Leaving Cross drops the depot: a stale depot would still
                // reach buildSubject if Cross were re-picked later.
                crossDepot: c.value === "Cross Delivery" ? order.crossDepot : "",
              })}
              className="px-3 py-2 text-[13px] font-semibold"
              style={chipStyle(order.marker === c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Cross carries its source depot into the SUBJECT — with it the
            prefix is "Cross Billing Order From {depot}", without it just
            "Cross Billing Order", and the body's Remark: line trails off as
            "Cross billing from". So the field appears the moment Cross does. */}
        {order.marker === "Cross Delivery" && (
          <input
            type="text"
            value={order.crossDepot}
            onChange={(e) => onOrderChange({ ...order, crossDepot: e.target.value })}
            placeholder="Cross billing from which depot?"
            className="mt-2 w-full rounded-[12px] px-3 py-2.5 text-[16px] outline-none placeholder:text-[#9C99AC]"
            style={{ border: `1.5px solid ${RULE}`, color: INK }}
          />
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
