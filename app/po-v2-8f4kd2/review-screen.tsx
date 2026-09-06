"use client";

import { ChevronLeft, MapPin, X } from "lucide-react";
import {
  DIVIDER, INK, RULE, VIOLET,
  chipStyle, packString, unitsIn,
  type ApiCustomer, type V2CartLine, type V2Marker, type V2Order,
} from "./v2-data";

// Hidden v2 review screen — the last look before Send.
//
// 🔴 CONTAINMENT — imports ./v2-data and node_modules only.
//
// SINGLE BILL. No "Bill 1", no Add bill, no multi. /po's multi-bill machinery
// is not carried over.
//
// 🔴 EVERY CONTROL HERE EXISTS BECAUSE lib/place-order/email.ts READS IT.
// The Dispatch options produce its three literal `Dispatch:` values plus the
// omission; the Remark options are its four markers plus null; the cross-depot
// input is what turns "Cross Billing Order" into "Cross Billing Order From
// {depot}" in buildSubject. Nothing here is decoration — step 9 wires each one
// straight into the mailto.

/** Sections are separated by a 9px band, never by a border or a card. */
function Band(): React.JSX.Element {
  return <div className="h-[9px] w-full" style={{ background: DIVIDER }} />;
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
  onBack, onEdit, onRemoveLine, onOrderChange, onOpenShipTo,
}: {
  dealer: ApiCustomer;
  /** NULL means "same as billing" — the state email.ts omits the Ship To line for. */
  shipTo: ApiCustomer | null;
  lines: V2CartLine[];
  order: V2Order;
  onBack: () => void;
  onEdit: () => void;
  onRemoveLine: (id: string) => void;
  onOrderChange: (next: V2Order) => void;
  onOpenShipTo: () => void;
}): React.JSX.Element {
  const totalUnits = lines.reduce((sum, l) => sum + unitsIn(l.qtys), 0);
  const shipElsewhere = shipTo !== null && shipTo.code !== dealer.code;

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
        <h1 className="text-[17px] font-extrabold" style={{ color: INK, letterSpacing: "-0.02em" }}>
          Review order
        </h1>
      </header>

      {/* ── DEALER ───────────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <p className="truncate text-[17px] font-extrabold" style={{ color: INK, letterSpacing: "-0.02em" }}>
          {dealer.name}
        </p>
        <p className="truncate text-[12.5px] text-neutral-400">
          {[dealer.code, dealer.area, today()].filter(Boolean).join(" · ")}
        </p>
      </div>

      <Band />

      {/* ── ITEMS ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <h2 className="text-[15px] font-extrabold" style={{ color: INK }}>Items</h2>
        <button type="button" onClick={onEdit}
                className="text-[13px] font-extrabold" style={{ color: VIOLET }}>
          Edit
        </button>
      </div>

      <div>
        {lines.map((line) => (
          <div
            key={line.id}
            className="flex items-start gap-3 px-4 py-2.5"
            style={{ borderTop: `1px solid ${DIVIDER}` }}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-semibold" style={{ color: INK }}>
                {line.label}
              </p>
              {line.option && (
                <p className="truncate text-[11.5px] font-extrabold uppercase"
                   style={{ color: VIOLET, letterSpacing: ".06em" }}>
                  {line.option}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[12.5px]" style={{ color: INK }}>{packString(line)}</p>
              <p className="text-[11px] text-neutral-400">{unitsIn(line.qtys)} units</p>
            </div>
            <button
              type="button" aria-label={`Remove ${line.label}`}
              onClick={() => onRemoveLine(line.id)}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"
            >
              <X className="h-4 w-4 text-neutral-300" strokeWidth={2.5} />
            </button>
          </div>
        ))}

        <div className="flex items-center justify-between px-4 py-2.5"
             style={{ borderTop: `1px solid ${DIVIDER}` }}>
          <span className="text-[14.5px] font-bold" style={{ color: INK }}>Total</span>
          <span className="font-mono text-[14.5px] font-bold" style={{ color: INK }}>
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
            className="mt-2 w-full rounded-[12px] px-3 py-2.5 text-[16px] outline-none placeholder:text-neutral-400"
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
          className="w-full resize-none rounded-[12px] px-3 py-2.5 text-[16px] outline-none placeholder:text-neutral-400"
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
                  style={{ color: shipElsewhere ? VIOLET : "#A3A3A3" }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold"
                  style={{ color: shipElsewhere ? VIOLET : INK }}>
              {shipElsewhere ? `Ship to · ${shipTo.name}` : "Ship to · same as billing"}
            </span>
            <span className="block truncate text-[12px] text-neutral-400">
              {shipElsewhere ? (shipTo.area ?? shipTo.code) : (dealer.area ?? dealer.code)}
            </span>
          </span>
          <span className="shrink-0 text-[12.5px] font-extrabold" style={{ color: VIOLET }}>
            Change
          </span>
        </button>

        <div className="px-4 pt-2.5">
          {/* INERT this step — step 9 wires the mailto. */}
          <button
            type="button"
            className="w-full rounded-[13px] py-3 text-[15px] font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            Send order
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
      <h2 className="mb-2 text-[15px] font-extrabold" style={{ color: INK }}>{title}</h2>
      {children}
    </div>
  );
}
