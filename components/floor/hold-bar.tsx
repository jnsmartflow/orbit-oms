"use client";

// Floor Control — the Hold tab's bulk release bar (design §8, mockup
// 01-board.html `holdBar()`). Rises when 1+ held bills are ticked.
//
// "No per-row release button and no per-row slot picker. He releases in bulk —
// tick rows, the bottom bar rises with `release to [date ▾] [window ▾]`, then
// Release. Same shape as Support." (design §8)
//
// The date+window control is components/floor/dispatch-slot-picker.tsx USED
// AS-IS — its one popover already carries both halves the mockup draws as two
// selects, so there is nothing to fork. Release is disabled until a slot is
// chosen; a held bill must never go to the floor without a dispatch promise.
//
// 🔴 THE SAME SHELL AS THE FLOOR TAB'S BAR (2026-09-22): floor-action-bar.tsx —
// same size, same "{N} selected · ✕ Clear", same figures line. Release and the
// slot picker sit in the CTA area, then ··· More with one item, Cancel / Raise
// CI… (off-floor-dialog.tsx, 2026-09-22). Release
// is the one brand button, and disabled is grey, never a faded brand (it was
// `disabled:opacity-40` until this change — CLAUDE_UI §10).
//
// ⚠ ARTICLES AND ROUTES ONLY, NO LITRES OR KG. FloorHoldRow carries no
// `isGift` and no `weightKg`, and a litre total that counted GIFT bills would
// disagree with the Floor tab's (sumLitres excludes them). No number beats a
// number that is wrong in a way nobody can see.

import { useState } from "react";
import { X } from "lucide-react";
import { DispatchSlotPicker, type DispatchWindow, type DispatchSlotValue } from "@/components/floor/dispatch-slot-picker";
import { FloorActionBar, MoreMenu, BarDivider, BAR_PRIMARY, type BarFigure } from "./floor-action-bar";

export function HoldBar({
  count,
  articles,
  routes,
  windows,
  busy,
  onRelease,
  onClear,
  menuOpen,
  onMenuOpenChange,
  onOffFloor,
}: {
  count: number;
  /** Physical pieces across the selection, from countArticles. */
  articles: number;
  /** Distinct routes the selection spans. */
  routes: number;
  windows: DispatchWindow[];
  busy: boolean;
  onRelease: (date: string, windowId: number) => void;
  onClear: () => void;
  /** ··· More — owned by floor-page, the single Esc owner. */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** Open the Cancel / Raise CI form on the ticked held bills. */
  onOffFloor: () => void;
}) {
  const [slot, setSlot] = useState<DispatchSlotValue | null>(null);

  const figures: BarFigure[] = [];
  if (articles > 0) figures.push({ key: "art", value: String(articles), unit: articles === 1 ? "article" : "articles" });
  if (routes > 0) figures.push({ key: "rt", value: String(routes), unit: routes === 1 ? "route" : "routes" });

  return (
    <FloorActionBar count={count} figures={figures} onClear={onClear} clearDisabled={busy}>
      <span className="text-[13px] text-ink-500">release to</span>
      <DispatchSlotPicker value={slot} onChange={setSlot} windows={windows} popoverDir="up" popoverAlign="right" />
      <button
        type="button"
        disabled={!slot || busy}
        onClick={() => slot && onRelease(slot.date, slot.dispatchWindowId)}
        className={BAR_PRIMARY}
      >
        {busy ? "Releasing…" : "Release"}
      </button>
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
            hint: "Opens a form · choose Cancel or Raise CI",
            icon: <X size={15} strokeWidth={2.2} />,
            danger: true,
            onSelect: onOffFloor,
          },
        ]}
      />
    </FloorActionBar>
  );
}
