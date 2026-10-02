"use client";

// Tint Manager — the bottom bar (2026-10-01, tabs build step 6 — plan §A, owner
// decision 3, mockup .rbar).
//
//   {N} selected [✕ Clear]                      [🕑 Slot] [primary] │ [··· More]
//   1,320 L   21 articles   3 routes
//
// Built ON FLOOR'S SHELL — components/floor/floor-action-bar.tsx FloorActionBar
// + MoreMenu + BAR_PRIMARY / BAR_SECONDARY — not a copy of it. Like Floor's, it
// is positioned by its parent: `absolute inset-x-0 bottom-0` resolves against
// the TABLE pane (tint-manager-content.tsx gives that pane `relative`), so the
// bar opens along the table side and never runs under the rail.
//
// What is selected decides the primary (exactly ONE brand button, CLAUDE_UI §10):
//   rail  → "Assign ▾"     (operators + "Base — No Tint"; the page runs the
//                           customer-missing interceptor first, CLAUDE_TINT §1.5)
//   table → "Re-assign ▾"  (disabled, with the reason, when any selected job is
//                           running or paused — the server 400s those, §1.6)
//   hold  → "Release"      (= unhold, owner decision 9 — the page posts it;
//                           tint_hold)
//   base  → 🕑 Slot        (Base tab 4B, owner §I-2 — the slot picker IS the
//                           primary; no separate Slot button, no Assign)
// The four selections never mix — the page keeps them disjoint.
//
// BASE BILLS (non-tint SMU 74/77 — lib/tint/manager-bill.ts BASE_ACTIONS): More
// offers only Hold · Shop delivery · Raise CI. Hand, Cancel / Stop & cancel and
// Remove OBD are hidden whenever a Base bill is in the selection (the Base tab,
// or a held Base bill on the Hold tab — facts.anyBase); the routes refuse them
// anyway. A Hold the server refuses (a picker has the bill) comes back per bill
// in the page's done / failed toast, in the server's own words.
//
// ··· More items are each HIDDEN without their tick (TintManagerAccessProvider;
// the routes re-check).
//
// Ship-to (owner, 2026-10-01): the bar carries "Shop delivery" (tint_shop_delivery
// — every selected bill to its own bill-to dealer, on rail / table / hold
// selections alike). "Change ship-to" is NOT on the bar any more: a single-bill
// redirect lives only in the detail panel (tint_ship_to). The page owns every write and both menus' open state —
// it is the single Esc owner, so nothing here listens for keys.

import { Clock, Hand, Pause, Play, Trash2, Undo2, X, Store, FileX2, Zap } from "lucide-react";
import {
  BarDivider,
  BAR_PRIMARY,
  BAR_SECONDARY,
  FloorActionBar,
  MoreMenu,
  type BarFigure,
  type MoreMenuItem,
} from "@/components/floor/floor-action-bar";
import { SlotPickerButton } from "@/components/floor/slot-picker-button";
import type { DispatchSlotValue, DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import { useTintManagerAccess } from "./tint-manager-access-provider";
import { WHITE_SHOTS, type WhiteShotDose } from "@/lib/tint/white-shots";

export type BarMode = "rail" | "table" | "hold" | "base" | "ti";

export interface BarSelectionFacts {
  /** Every selected table job is Assigned (Re-assign / Send back allowed). */
  allAssigned: boolean;
  /**
   * Some selected bill is HELD BY AN OPERATOR — assigned, tinting or paused.
   * Cancel refuses all three server-side (offFloorRefusal: "use Stop & cancel"),
   * so the bar offers Stop & cancel instead. Wider than the mockup's
   * running-or-paused test, on purpose: an assigned-not-started bill is in the
   * tint room too, and only Stop & cancel accepts it.
   */
  operatorHolds: boolean;
  allHeld:     boolean;
  allHand:     boolean;
  /** Some selected bill is a BASE bill (non-tint SMU 74/77) — tint-only items hide. */
  anyBase:     boolean;
  /** Every selected bill is urgent (the ⚡ the board shows) — the item reads "Clear urgent". */
  allUrgent:   boolean;
}

export function BoardBottomBar({
  mode,
  count,
  litres,
  articles,
  routes,
  facts,
  busy,
  windows,
  slotValue,
  onSlot,
  onPrimary,
  menuOpen,
  onMenuOpenChange,
  onClear,
  onSendBack,
  onHold,
  onReleaseHold,
  onHand,
  onUrgent,
  onShopDelivery,
  onCancel,
  onStopCancel,
  onRaiseCi,
  onRemove,
}: {
  mode:      BarMode;
  count:     number;
  /** Already formatted (formatLitres). */
  litres:    string;
  articles:  number;
  routes:    number;
  facts:     BarSelectionFacts;
  busy:      boolean;
  windows:   DispatchWindow[];
  /** The selection's common slot, or null (mixed / none) — the picker opens unhighlighted. */
  slotValue: DispatchSlotValue | null;
  onSlot:    (v: DispatchSlotValue) => void;
  /** Assign ▾ / Re-assign ▾ / Release — the anchor is for the portalled operator menu. */
  onPrimary: (anchor: HTMLElement) => void;
  menuOpen:  boolean;
  onMenuOpenChange: (open: boolean) => void;
  onClear:   () => void;
  onSendBack:    () => void;
  onHold:        () => void;
  onReleaseHold: () => void;
  onHand:        (set: boolean) => void;
  /** ⚡ Urgent (true) / Clear urgent (false) — Floor's mark-urgent, tint_urgent. */
  onUrgent:      (set: boolean) => void;
  /** Opens the Shop delivery confirm for the whole selection. */
  onShopDelivery: () => void;
  onCancel:      () => void;
  onStopCancel:  () => void;
  onRaiseCi:     () => void;
  onRemove:      () => void;
}) {
  const access = useTintManagerAccess();
  const one = count === 1;

  const figures: BarFigure[] = [{ key: "l", value: litres, unit: "L" }];
  if (articles > 0) figures.push({ key: "art", value: String(articles), unit: articles === 1 ? "article" : "articles" });
  if (routes > 0) figures.push({ key: "rt", value: String(routes), unit: routes === 1 ? "route" : "routes" });

  // ── The primary — one brand button, the state's real job ──────────────────
  const reassignBlocked = mode === "table" && !facts.allAssigned;
  const primary =
    mode === "base" ? (
      // 🕑 Slot — the Base selection's real job (owner §I-2). The one brand button;
      // grey and inert without tint_slot (UI §10 — never a faded brand).
      <SlotPickerButton
        value={slotValue}
        onPick={onSlot}
        windows={windows}
        disabled={busy || !access.canSlot || windows.length === 0}
        popoverDir="up"
        popoverAlign="right"
        className={BAR_PRIMARY}
      >
        <Clock size={15} strokeWidth={2.2} />
        Due
      </SlotPickerButton>
    ) : mode === "rail" ? (
      <button type="button" disabled={busy || !access.canEdit} onClick={(e) => onPrimary(e.currentTarget)} className={BAR_PRIMARY}>
        Assign ▾
      </button>
    ) : mode === "table" ? (
      <button
        type="button"
        disabled={busy || !access.canEdit || reassignBlocked}
        title={reassignBlocked ? "Only Assigned jobs — a running or paused job belongs to its operator" : undefined}
        onClick={(e) => onPrimary(e.currentTarget)}
        className={BAR_PRIMARY}
      >
        Re-assign ▾
      </button>
    ) : (
      <button
        type="button"
        disabled={busy || !access.canHold}
        title="Clear the hold — a waiting bill goes back to the rail, a mid-tint bill keeps tinting"
        onClick={(e) => onPrimary(e.currentTarget)}
        className={BAR_PRIMARY}
      >
        Release
      </button>
    );

  // ── ··· More — each item hidden without its tick ──────────────────────────
  const items: MoreMenuItem[] = [];
  if (mode === "table" && access.canEdit) {
    items.push({
      key: "send-back",
      label: "Send back to pending",
      hint: facts.allAssigned ? "Back to the rail · the operator loses the job" : "Assigned jobs only",
      icon: <Undo2 size={15} strokeWidth={2.2} />,
      disabled: !facts.allAssigned,
      onSelect: onSendBack,
    });
  }
  // On the Hold tab Release IS the primary — no second copy in More.
  if (access.canHold && mode !== "hold") {
    items.push(
      facts.allHeld
        ? {
            key: "release-hold",
            label: "Release hold",
            hint: "Waiting bills back to the rail · mid-tint bills carry on",
            icon: <Play size={15} strokeWidth={2.2} />,
            dividerBefore: items.length > 0,
            onSelect: onReleaseHold,
          }
        : {
            key: "hold",
            label: "Hold",
            hint: mode === "rail" ? "Moves to the Hold tab"
              : mode === "base" ? "Moves to the Hold tab · refused once a picker has it"
              : "Keeps tinting · won't go to picking until released",
            icon: <Pause size={15} strokeWidth={2.2} />,
            dividerBefore: items.length > 0,
            onSelect: onHold,
          },
    );
  }
  if (access.canHand && !facts.anyBase) {
    items.push({
      key: "hand",
      label: facts.allHand ? "Clear Hand" : "Hand",
      hint: "Dealer collects from the depot",
      icon: <Hand size={15} strokeWidth={2.2} />,
      onSelect: () => onHand(!facts.allHand),
    });
  }
  // ⚡ URGENT (2026-10-02, owner) — rail, Tint-table and Base selections, on its
  // own tick tint_urgent. Floor's mark-urgent via the TM actions route: an
  // explicit set / clear (priorityLevel 1 ↔ 3), never a per-bill toggle.
  if (access.canUrgent && mode !== "hold") {
    items.push({
      key: "urgent",
      label: facts.allUrgent ? "Clear urgent" : "⚡ Urgent",
      hint: facts.allUrgent ? "Back to normal priority" : "Top of the floor's queue",
      icon: <Zap size={15} strokeWidth={2.2} />,
      onSelect: () => onUrgent(!facts.allUrgent),
    });
  }
  if (access.canShopDelivery) {
    items.push({
      key: "shop-delivery",
      label: "Shop delivery",
      hint: "Ship to the dealer's shop",
      icon: <Store size={15} strokeWidth={2.2} />,
      onSelect: onShopDelivery,
    });
  }
  if (access.canCancel && !facts.anyBase) {
    items.push(
      facts.operatorHolds
        ? {
            key: "stop-cancel",
            label: "Stop & cancel",
            hint: one ? "Ends the operator's job first" : "One bill at a time",
            icon: <X size={15} strokeWidth={2.2} />,
            danger: true,
            dividerBefore: true,
            disabled: !one,
            onSelect: onStopCancel,
          }
        : {
            key: "cancel",
            label: "Cancel bill",
            hint: "Goes to the CI tab · can be restored",
            icon: <X size={15} strokeWidth={2.2} />,
            danger: true,
            dividerBefore: true,
            onSelect: onCancel,
          },
    );
  }
  if (access.canCi) {
    items.push({
      key: "ci",
      label: "Raise CI (cancels)",
      hint: "Full-bill return to billing",
      icon: <FileX2 size={15} strokeWidth={2.2} />,
      danger: true,
      dividerBefore: !access.canCancel || facts.anyBase,
      onSelect: onRaiseCi,
    });
  }
  if (access.canCancel && mode === "rail" && !facts.anyBase) {
    items.push({
      key: "remove",
      label: "Remove OBD",
      hint: one ? "Wrong order · voids the challan" : "One bill at a time",
      icon: <Trash2 size={15} strokeWidth={2.2} />,
      disabled: !one,
      onSelect: onRemove,
    });
  }

  return (
    <FloorActionBar count={count} figures={figures} onClear={onClear} clearDisabled={busy}>
      {access.canSlot && mode !== "base" ? (
        <SlotPickerButton
          value={slotValue}
          onPick={onSlot}
          windows={windows}
          disabled={busy || windows.length === 0}
          popoverDir="up"
          popoverAlign="right"
          className={BAR_SECONDARY}
        >
          <Clock size={15} strokeWidth={2.2} />
          Due
        </SlotPickerButton>
      ) : null}
      {primary}
      {items.length > 0 && (
        <>
          <BarDivider />
          <MoreMenu open={menuOpen} onOpenChange={onMenuOpenChange} items={items} disabled={busy} />
        </>
      )}
    </FloorActionBar>
  );
}

// ── The TI tab's bar (2026-10-02, bulk TI — docs/prompts/drafts/
// code-discovery-2026-10-02-bulk-tinter-issue.md §G step 3, §I; locked mockup
// docs/mockups/tint-manager/tint-manager-ti-bulk-mockup.html "bar") ──────────
//
//   {N} selected [✕ Clear]   {X} lines owed · 20 L ×3 · 1 L
//                            WHITE SHOT [WHT 5] [WHT 20] [WHT 25] [+ New shade] │ [↶ Undo Base]
//
// A separate component on the same Floor shell (FloorActionBar), not a fifth
// branch through BoardBottomBar: this mode shares none of the other modes' items
// — no Due, no Hold, no More. The three WHT buttons are hidden without
// tint_ti_bulk (canTiBulk); each opens the page's confirm (board-ti-bulk-
// dialog.tsx) — nothing is written from here. The doses come from
// lib/tint/white-shots.ts, never retyped. "+ New shade" opens today's per-line
// TI panel on the first selected bill. "↶ Undo Base" is the existing undo, run
// per selected bill by the page (owner 2026-10-02).
//
// Follows the locked mockup: the shots are bordered white buttons, the new-shade
// one dashed — no filled brand button in this mode (the confirm carries it).

export function BoardTiBottomBar({
  count,
  linesOwed,
  packs,
  busy,
  onClear,
  onShot,
  onNewShade,
  onUndoBase,
}: {
  count:      number;
  linesOwed:  number;
  /** "20 L ×3 · 1 L" — board-ti-tab.tsx packList over the owed lines. */
  packs:      string;
  busy:       boolean;
  onClear:    () => void;
  onShot:     (dose: WhiteShotDose) => void;
  onNewShade: () => void;
  onUndoBase: () => void;
}) {
  const access = useTintManagerAccess();
  const figures: BarFigure[] = [{ key: "lines", value: String(linesOwed), unit: linesOwed === 1 ? "line owed" : "lines owed" }];
  return (
    <FloorActionBar count={count} figures={figures} extra={packs ? <span className="whitespace-nowrap">{packs}</span> : undefined} onClear={onClear} clearDisabled={busy}>
      {access.canTiBulk && (
        <>
          <span className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-ink-400">White shot</span>
          {WHITE_SHOTS.map((s) => (
            <button
              key={s.dose}
              type="button"
              disabled={busy || linesOwed === 0}
              onClick={() => onShot(s.dose)}
              title={`WHT ${s.dose} · ${s.samplingNo} on every owed line`}
              className="inline-flex h-[44px] min-w-[96px] flex-col items-center justify-center rounded-xl border border-ink-200 bg-white px-4 text-ink-900 hover:border-brand-600 hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <span className="text-[15px] font-bold leading-tight">WHT {s.dose}</span>
              <span className="text-[10px] text-ink-400">white shot</span>
            </button>
          ))}
        </>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onNewShade}
        className="inline-flex h-[44px] min-w-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-white px-4 font-semibold text-ink-700 hover:border-ink-400 disabled:cursor-not-allowed disabled:text-gray-400"
      >
        <span className="text-[13px] leading-tight">+ New shade</span>
        <span className="text-[10px] font-medium text-ink-400">by hand, line by line</span>
      </button>
      <BarDivider />
      <button type="button" disabled={busy} onClick={onUndoBase} className={BAR_SECONDARY} title="Back to the Needs-assignment rail — refused once a TI is recorded or a picker has it">
        <Undo2 size={15} strokeWidth={2.2} />
        Undo Base
      </button>
    </FloorActionBar>
  );
}
