"use client";

// Floor Control — the Hold tab's bulk release bar (design §8, mockup
// 01-board.html `holdBar()`). Rises when 1+ held bills are ticked.
//
// "No per-row release button and no per-row slot picker. He releases in bulk —
// tick rows, the bottom bar rises with `release to [date ▾] [window ▾]`, then
// Release. Same shape as Support." (design §8)
//
// The date+window control is components/floor/dispatch-slot-picker.tsx with
// `trigger="bar"` (2026-10-30, mockup docs/mockups/floor-hold/hold-dealer-groups.html):
// a 44px "Set slot" button the height of Release, and the clear × as its own
// 44px button beside it. The popover is the picker's, unchanged — commit on
// tap, no confirm, honest highlight, auto-flip, portalled. Every other caller
// keeps the default 22px pill. Release is disabled until a slot is chosen — a
// held bill must never go to the floor without a dispatch promise — and says
// so: "Set a slot first" under it. The one exception is `slotOptional` (every
// tick a held invoice of a partly-held split OBD): enabled, no hint.
//
// 🔴 THE SAME SHELL AS THE FLOOR TAB'S BAR (2026-09-22): floor-action-bar.tsx —
// same size, same "{N} selected · ✕ Clear", same figures line. Set slot and
// Release sit in the CTA area, then ··· More with one item, Cancel / Raise
// CI… (off-floor-dialog.tsx, 2026-09-22). Release is the one brand button, and
// disabled is grey, never a faded brand (CLAUDE_UI §10) — the slot trigger too.
//
// FIGURES: articles · routes · L · kg (2026-10-30). The caller computes L and kg
// with the Floor bar's own helpers — sumLitres / sumWeightKg / formatWeightKg
// (status-pill.tsx): a GIFT is 0 L / 0 kg, a bill with no weight makes the kg a
// lower bound ("67+ kg"), and no recorded weight at all prints no kg. (Until
// 2026-10-30 this said FloorHoldRow carried no isGift / weightKg; both have been
// on it since 2026-10-02.)

import { useState } from "react";
import { X } from "lucide-react";
import { DispatchSlotPicker, type DispatchWindow, type DispatchSlotValue } from "@/components/floor/dispatch-slot-picker";
import { FloorActionBar, MoreMenu, BarDivider, BAR_PRIMARY, type BarFigure } from "./floor-action-bar";

export function HoldBar({
  count,
  articles,
  routes,
  litres,
  weight,
  weightIsPartial,
  windows,
  busy,
  onRelease,
  onClear,
  menuOpen,
  onMenuOpenChange,
  onOffFloor,
  slotOptional = false,
  offFloorBlock = null,
}: {
  count: number;
  /** Physical pieces across the selection, from countArticles. */
  articles: number;
  /** Distinct routes the selection spans. */
  routes: number;
  /** Already formatted through formatLitres (sumLitres — gift = 0). */
  litres: string;
  /** Already formatted through formatWeightKg; NULL when no ticked bill has a
   *  recorded weight — then no kg is printed (zero is not a weight). */
  weight: string | null;
  /** At least one ticked bill has no weight → the kg is a lower bound ("+"). */
  weightIsPartial: boolean;
  windows: DispatchWindow[];
  busy: boolean;
  /** date / windowId null only when `slotOptional` and no slot was picked. */
  onRelease: (date: string | null, windowId: number | null) => void;
  onClear: () => void;
  /** ··· More — owned by floor-page, the single Esc owner. */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** Open the Cancel / Raise CI form on the ticked held bills. */
  onOffFloor: () => void;
  /**
   * 6.1 — every tick is a PART of a split OBD's held invoices: Release takes
   * them off hold (per invoice, lib/order-invoices/hold.ts) and needs no slot —
   * the OBD keeps its own. A slot picked anyway is ignored for them.
   */
  slotOptional?: boolean;
  /** Greys Cancel / Raise CI with this reason. ⚠ NO CALLER PASSES IT (checked
   *  2026-10-24 — hold-tab.tsx, the only mount): since 6.3 Raise CI acts per
   *  ticked held invoice, so the 6.1 "partly ticked → grey" rule is gone. Kept,
   *  unused; defaults to null. */
  offFloorBlock?: string | null;
}) {
  const [slot, setSlot] = useState<DispatchSlotValue | null>(null);
  const needsSlot = !slot && !slotOptional;

  const figures: BarFigure[] = [];
  if (articles > 0) figures.push({ key: "art", value: String(articles), unit: articles === 1 ? "article" : "articles" });
  if (routes > 0) figures.push({ key: "rt", value: String(routes), unit: routes === 1 ? "route" : "routes" });
  figures.push({ key: "l", value: litres, unit: "L" });
  if (weight !== null) {
    figures.push({
      key: "kg",
      value: `${weight}${weightIsPartial ? "+" : ""}`,
      unit: "kg",
      title: weightIsPartial ? "Some selected bills have no weight recorded — this total is a lower bound" : undefined,
    });
  }

  return (
    <FloorActionBar count={count} figures={figures} onClear={onClear} clearDisabled={busy}>
      <DispatchSlotPicker
        value={slot}
        onChange={setSlot}
        windows={windows}
        popoverDir="up"
        popoverAlign="right"
        trigger="bar"
        disabled={busy}
      />
      {/* The hint hangs under Release (absolute) so the row never shifts when it goes. */}
      <span className="relative inline-flex">
        <button
          type="button"
          disabled={needsSlot || busy}
          onClick={() => (slot ? onRelease(slot.date, slot.dispatchWindowId) : slotOptional && onRelease(null, null))}
          className={BAR_PRIMARY}
        >
          {busy ? "Releasing…" : "Release"}
        </button>
        {needsSlot && (
          <span className="pointer-events-none absolute left-0 right-0 top-full mt-0.5 whitespace-nowrap text-center text-[11px] text-ink-400">
            Set a slot first
          </span>
        )}
      </span>
      <BarDivider />
      {/* One item on this bar (2026-09-22): a held bill has no Hold to offer. */}
      <MoreMenu
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        disabled={busy}
        items={[
          {
            key: "off-floor",
            label: "Cancel / Raise CI…",
            hint: offFloorBlock ?? "Opens a form · choose Cancel or Raise CI",
            icon: <X size={15} strokeWidth={2.2} />,
            danger: true,
            disabled: offFloorBlock !== null,
            onSelect: onOffFloor,
          },
        ]}
      />
    </FloorActionBar>
  );
}
