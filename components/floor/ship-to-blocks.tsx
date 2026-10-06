"use client";

// Floor Control — DIVISION BANDS + SHIP-TO BLOCKS inside an open route card
// (2026-10-06, owner; design: docs/mockups/floor-trips/floor-division-blocks-final.html).
//
// The grouping is lib/floor/division-blocks.ts (pure). This file only draws it:
//   DivisionBand      a full-width strip per division — 4px coloured bar,
//                     light ground, code chip (none for Other), UPPERCASE name,
//                     and "{bills} bills · {L} L · {kg} kg" on the right. NO stop
//                     count (a ship-to in two divisions is in both bands) and NO
//                     tick (owner).
//   ShipToBlockHeader the trip panel's STOP HEADER, without the stop number —
//                     classes copied from trip-desk.tsx's stop header (the
//                     "Harekrishna Colour Zone · Sarthana · 2 bills · 8 L" line),
//                     never imported from it: that one reads a trip drop's
//                     snapshot, this one reads board rows.
//
// 🔴 TOTALS COME FROM THE FLOOR'S OWN HELPERS — sumLitres / kgText, the ones the
// route heading uses — so a band, a block and the heading cannot disagree.
// GIFT counts as a bill with 0 L / 0 kg (the helpers do that); Hand and
// upcoming bills never reach a band (they keep their own list).
//
// ⚠ NO KEY LISTENER HERE — floor-page.tsx owns the floor's only one (FLOOR §4.6).

import { Building2 } from "lucide-react";
import { formatLitres, sumLitres } from "./status-pill";
import { kgText } from "./route-cards";
import { deskKeyOf, isAllDeskSelected, type FloorDeskKey } from "@/lib/floor/selection";
import type { DivisionBand as DivisionBandModel, DivisionKey, ShipToBlock } from "@/lib/floor/division-blocks";
import type { FloorBoardRow } from "@/lib/floor/types";

/**
 * The band palette — copied from the approved mockup's CSS (.div.d70 / .d77 /
 * .d74 / .dother). 77 and 74 are the app's SMU colours (Retail Offtake cyan,
 * Decorative Projects indigo — CLAUDE_UI §56, card-atoms SmuBadge); 70 and
 * Other are the mockup's neutral greys.
 */
const BAND_COLOURS: Record<DivisionKey, { fg: string; bg: string }> = {
  "70": { fg: "#55556a", bg: "#f4f4f7" },
  "77": { fg: "#0891b2", bg: "#ecfeff" },
  "74": { fg: "#4f46e5", bg: "#eef2ff" },
  other: { fg: "#9a9aae", bg: "#fafafa" },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "3 bills · 640 L · 820 kg" — the band's and the block's figures.
 *
 * ⚠ A ZERO IS LEFT OUT, NEVER PRINTED (owner, 2026-10-06): no "0 L", no
 * "— kg". A block of GIFT bills only (their L / kg are placeholders the helpers
 * count as 0) reads "1 bill · gift" instead.
 */
function figures(rows: FloorBoardRow[]): string {
  const parts = [plural(rows.length, "bill", "bills")];
  const litres = formatLitres(sumLitres(rows));
  if (litres !== "0") parts.push(`${litres} L`);
  const kg = kgText(rows);
  if (kg !== "—" && kg !== "0") parts.push(`${kg} kg`);
  if (rows.length > 0 && rows.every((r) => r.isGift)) parts.push("gift");
  return parts.join(" · ");
}

export function DivisionBand({ band, first }: { band: DivisionBandModel; first: boolean }) {
  const c = BAND_COLOURS[band.key];
  return (
    <div
      // 12px above every band but the first (which sits right under the
      // column header); slimmer than the route heading it belongs to.
      className={`flex items-center gap-2.5 border-b border-[#e7e7ee] px-[18px] py-2 ${
        first ? "" : "mt-3 border-t"
      }`}
      // The 4px bar as an inset shadow, never a border-left (it would shift the
      // text against the blocks below).
      style={{ background: c.bg, boxShadow: `inset 4px 0 0 ${c.fg}` }}
    >
      {band.key !== "other" && (
        <span
          className="rounded-[5px] px-[7px] py-px text-[11px] font-bold tabular-nums text-white"
          style={{ background: c.fg }}
        >
          {band.key}
        </span>
      )}
      <span className="text-[11.5px] font-bold uppercase tracking-[0.07em]" style={{ color: c.fg }}>
        {band.name}
      </span>
      <span className="ml-auto whitespace-nowrap text-[12px] tabular-nums text-[#96969f]">{figures(band.rows)}</span>
    </div>
  );
}

export function ShipToBlockHeader({
  block,
  selection,
  onToggleAll,
}: {
  block: ShipToBlock;
  /** Undefined in History (read-only) — no tick is drawn then. */
  selection?: ReadonlySet<FloorDeskKey>;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
}) {
  const tickable = selection !== undefined && onToggleAll !== undefined;
  const allOn = tickable ? isAllDeskSelected(selection, block.rows) : false;
  // Some, not all — the dash (owner, 2026-10-06). The same desk key the rows
  // tick by (deskKeyOf), read through selection.ts, never re-derived.
  const someOn = tickable && !allOn && block.rows.some((r) => selection.has(deskKeyOf(r)));
  return (
    // The trip stop header's classes (trip-desk.tsx), minus the stop number;
    // 8px more air above it than the stop header has (pt-5, owner 2026-10-06).
    // NAME ONLY since 2026-10-06 (owner): no area / bills / L / kg here — the
    // band above carries the figures; "billed to" stays when it applies.
    //
    // ⚠ THE TICK SITS AT 14px — the OBD column's left padding (px-3.5), where
    // the route's tick sits in the column header row (floor-table.tsx,
    // `shipToBlock`). The block rows have no tick column of their own: a row
    // is ticked by clicking it.
    <div className="flex flex-wrap items-baseline gap-[9px] border-b border-[#e7e7ee] pb-[7px] pl-3.5 pr-[18px] pt-5">
      {tickable && (
        <input
          type="checkbox"
          aria-label={`Select every bill for ${block.name}`}
          className="h-[13px] w-[13px] shrink-0 cursor-pointer self-center accent-brand-600"
          checked={allOn}
          ref={(el) => {
            if (el) el.indeterminate = someOn;
          }}
          onChange={() => onToggleAll(block.rows)}
        />
      )}
      <span className="text-[16px] font-semibold text-[#1a1a22]">{block.name}</span>
      {block.isKeyCustomer && (
        <span className="text-[13px]" style={{ color: "#f59e0b" }} title="Key customer">
          ★
        </span>
      )}
      {block.isSite && (
        <span title="Site" className="self-center">
          <Building2 size={13} style={{ color: "#475569" }} />
        </span>
      )}
      {block.isRedirect && (
        // Violet, as the mockup's .redir and the table's own redirect line.
        <span className="self-center rounded-[5px] bg-[#f3edff] px-[7px] py-[2px] text-[10.5px] font-bold text-[#6d28d9]">
          → ship-to changed
        </span>
      )}
      {block.headerBilledTo !== null && (
        <span className="text-[12.5px] text-[#96969f]">
          billed to <b className="font-semibold text-[#55556a]">{block.headerBilledTo}</b>
        </span>
      )}
    </div>
  );
}
