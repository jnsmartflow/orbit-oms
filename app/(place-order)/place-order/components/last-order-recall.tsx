"use client";

import { useEffect, useState } from "react";
import { formatPack, packStep, packToLitres } from "@/lib/place-order/pack";

// Last-order recall card. Fetches /api/place-order/last-order/[code] on
// customer change and renders a comma-separated summary of the recent
// order's matched lines, with a Repeat-order button that bulk-applies
// boxified entries via the page-level handler.
//
// Boxes/units conversion uses lib/place-order/pack.ts → packStep(label)
// (units per box). When isCarton=true, cartonCount is already in boxes
// from the parser — use it directly.
//
// Empty / error states preserve the card placement so the page layout
// doesn't shift on customer-change (decision J Stage 2).

export type RecallLine = {
  productName:    string | null;
  baseColour:     string | null;
  packCode:       string | null;
  quantity:       number;        // UNITS, parser-emitted
  isCarton:       boolean;
  cartonCount:    number | null; // BOXES when isCarton=true
  skuCode:        string | null;
  skuDescription: string | null;
  matchStatus:    string;
};

export type RepeatOrderEntry = {
  productName: string;
  baseColour:  string | null;
  packCode:    string;
  boxes:       number;
};

type ApiLastOrder = {
  moOrderId:  number;
  receivedAt: string;
  soNumber:   string | null;
  lines:      RecallLine[];
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "loaded"; lastOrder: ApiLastOrder };

export interface LastOrderRecallProps {
  customerCode:  string | null;
  customerName:  string | null;
  onRepeatOrder: (entries: RepeatOrderEntry[]) => void;
}

const SUMMARY_MAX_LINES = 6;

function unitsToBoxes(line: RecallLine, packLabel: string): number {
  if (line.isCarton && line.cartonCount != null) return line.cartonCount;
  const step = packStep(packLabel);
  if (step <= 0) return line.quantity;
  return Math.round(line.quantity / step);
}

function dayLabel(receivedAt: string): string {
  const days = Math.floor((Date.now() - new Date(receivedAt).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function isMatchable(l: RecallLine): l is RecallLine & { productName: string; packCode: string } {
  return l.matchStatus === "matched" && l.productName !== null && l.packCode !== null;
}

function buildEntries(lines: RecallLine[]): RepeatOrderEntry[] {
  return lines
    .filter(isMatchable)
    .map((l) => {
      const packLabel = formatPack(l.packCode);
      const boxes     = unitsToBoxes(l, packLabel);
      return {
        productName: l.productName,
        baseColour:  l.baseColour,
        packCode:    l.packCode,
        boxes,
      };
    })
    .filter((e) => e.boxes > 0);
}

function buildSummary(lines: RecallLine[]): string {
  const flat = lines
    .filter(isMatchable)
    .map((l) => {
      const packLabel = formatPack(l.packCode);
      const boxes     = unitsToBoxes(l, packLabel);
      const baseDisp  = l.baseColour ?? "Plain";
      return {
        productName: l.productName,
        itemText:    `${baseDisp} ${packLabel} ×${boxes}`,
        boxes,
      };
    })
    .filter((e) => e.boxes > 0);

  const shown     = flat.slice(0, SUMMARY_MAX_LINES);
  const truncated = flat.length > SUMMARY_MAX_LINES;

  // Re-group consecutive same-productName runs to get
  //   "PROMISE ENML · BW 1L ×5, BW 500ml ×2 · GLOSS · BW 4L ×3"
  // (mockup format). Same product appearing as a separate later run is
  // listed again rather than merged — preserves the original order.
  const grouped: { productName: string; items: string[] }[] = [];
  for (const e of shown) {
    const last = grouped[grouped.length - 1];
    if (last && last.productName === e.productName) {
      last.items.push(e.itemText);
    } else {
      grouped.push({ productName: e.productName, items: [e.itemText] });
    }
  }

  const segments = grouped.map((g) => `${g.productName} · ${g.items.join(", ")}`);
  let text = segments.join(" · ");
  if (truncated) text += " · …";
  return text;
}

function formatLitres(l: number): string {
  if (Math.abs(l - Math.round(l)) < 0.05) return String(Math.round(l));
  return l.toFixed(1);
}

function buildRightLabel(lastOrder: ApiLastOrder): string {
  const matched     = lastOrder.lines.filter((l) => l.matchStatus === "matched" && l.packCode !== null);
  const lineCount   = matched.length;
  const totalLitres = matched.reduce(
    (acc, l) => acc + l.quantity * packToLitres(l.packCode as string),
    0,
  );
  const day = dayLabel(lastOrder.receivedAt);
  if (lineCount === 0) return day;
  return `${day} · ${lineCount} ${lineCount === 1 ? "line" : "lines"} · ${formatLitres(totalLitres)} L`;
}

export default function LastOrderRecall({
  customerCode, customerName, onRepeatOrder,
}: LastOrderRecallProps): React.JSX.Element | null {
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  useEffect(() => {
    if (!customerCode) {
      setState({ kind: "idle" });
      return;
    }

    setState({ kind: "loading" });
    const ac = new AbortController();
    fetch(
      `/api/place-order/last-order/${encodeURIComponent(customerCode)}`,
      { signal: ac.signal },
    )
      .then((r) => r.json())
      .then((data: { lastOrder: ApiLastOrder | null }) => {
        if (ac.signal.aborted) return;
        if (data?.lastOrder == null) setState({ kind: "empty" });
        else                         setState({ kind: "loaded", lastOrder: data.lastOrder });
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn("[LastOrderRecall] fetch failed", err);
        setState({ kind: "error" });
      });

    return () => ac.abort();
  }, [customerCode]);

  if (!customerCode || state.kind === "idle") return null;

  const labelLeft  = customerName ? `Last order from ${customerName}` : "Last order";
  const labelRight = state.kind === "loaded" ? buildRightLabel(state.lastOrder) : "—";

  // `state` is taken as a parameter so TS narrows correctly inside each
  // case branch — closure-captured discriminated unions don't narrow in
  // strict mode after intermediate `if` checks elsewhere in the parent.
  function renderBody(s: LoadState): React.JSX.Element | null {
    switch (s.kind) {
      case "idle":
        return null;
      case "loading":
        return (
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 animate-pulse">
            <div className="flex-1 h-3 bg-gray-100 rounded" />
            <div className="w-[80px] h-7 bg-gray-100 rounded" />
          </div>
        );
      case "empty":
        return (
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-[11px] text-gray-400 italic">
            No recent orders for this customer
          </div>
        );
      case "error":
        return (
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-[11px] text-gray-400 italic">
            Couldn’t load last order
          </div>
        );
      case "loaded": {
        const entries = buildEntries(s.lastOrder.lines);
        const summary = buildSummary(s.lastOrder.lines);
        if (entries.length === 0) {
          return (
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-[11px] text-gray-400 italic">
              No matched lines in last order
            </div>
          );
        }
        return (
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
            <div className="flex-1 text-[11px] text-gray-600 leading-relaxed">{summary}</div>
            <button
              type="button"
              onClick={() => onRepeatOrder(entries)}
              className="px-3 py-1.5 text-[11.5px] font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 whitespace-nowrap"
            >
              Repeat order
            </button>
          </div>
        );
      }
    }
  }

  return (
    <div className="mb-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center justify-between">
        <span>{labelLeft}</span>
        <span className="text-gray-300">{labelRight}</span>
      </div>
      {renderBody(state)}
    </div>
  );
}
