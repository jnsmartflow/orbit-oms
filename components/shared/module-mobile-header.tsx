"use client";

import { Search, LayoutGrid } from "lucide-react";

// Direction-A slim module header. Extracted verbatim from
// components/picking/picking-board-mobile.tsx (2026-07-29), then RESTYLED
// 2026-09-09 — the restyle its own comment asked for, in its own commit,
// against all seven consumers at once.
//
// 🔴 IT IS A PALE MASTHEAD, NOT A FILLED BAND. The band used to be solid
// brand-600, which made it the largest and brightest block of violet in the
// product, on the smallest screens, for a header that carries no decision.
// The ground is now #F5F3FF and the TITLE carries the colour. The pattern and
// its reasoning come from app/po2/, which is the reference.
//
// 🔴 THE AVATAR IS WHITE, NOT ink-50. Everywhere else in the app an identity
// avatar is an ink-50 disc (CLAUDE_UI.md §10.1), but ink-50 is #F4F3F8 and this
// ground is #F5F3FF — seven units apart in blue and nothing else. On this one
// surface that is a fill that is not a fill: 1.01:1, a disc defined only by its
// hairline. White reads as an object sitting ON the wash, which is the same
// reason v2's search bar is white on the same ground.
//
// 🔴 CHANGING THE GROUND HERE CHANGES THE STATUS BAR. A pale header under iOS's
// `black-translucent` puts white clock glyphs on near-white. Every route that
// renders this component therefore needs `statusBarStyle: "default"` and a
// matching `themeColor` — /picking, /ci and /mrn carry those overrides for this
// reason. A new consumer needs one too.
//
// Deliberately does NOT call useMobileShell() itself — the caller passes the
// handlers in, so a future module can wire the avatar/grid to something
// other than the shared You/Menu sheets. Nothing picking-specific is
// imported here.
//
// Layout: avatar (left) · title (center) · grid + optional search (right),
// per docs/mockups/picking/mobile-shell-v1.html. The root is a
// `flex-shrink-0` element intended as a sibling of a `flex-1` scroll area
// inside a `fixed inset-0 flex flex-col` screen root — it does not position
// itself, so the consumer keeps ownership of the surrounding frame.

interface ModuleMobileHeaderProps {
  title:          string;
  /**
   * OPTIONAL second line under the title (2026-08-07, for the picker's
   * Combined tab: "3 orders · 128 L · 14 products").
   *
   * ⚠ ADDITIVE AND DEFAULT-OFF, on purpose. When it is undefined the header
   * renders the bare `<h1>` exactly as it always has — same element, same
   * classes, same flex position — so every existing consumer stays
   * byte-identical (`showSearch`'s precedent). Only the subtitle CASE wraps
   * title+subtitle in a column. This is a new capability, NOT a restyle of the
   * existing one; do not fold the two branches together to "tidy" it.
   */
  subtitle?:      string;
  avatarInitials: string;
  /** Avatar tap — Picking opens the shared You sheet (useMobileShell().openYou). */
  onAvatarClick:  () => void;
  /** Grid tap — Picking opens the shared Menu sheet (useMobileShell().openMenu). */
  onMenuClick:    () => void;
  /**
   * Render the search icon at all. When false the icon is omitted and NO gap
   * is left behind: it is the second child of a `gap-0.5` flex row, and a
   * one-child flex row has no gap to render, so the header stays balanced
   * with no placeholder and no width change on the grid button.
   */
  showSearch?:    boolean;
  /**
   * Whether the consumer's search input is currently open. Accepted so a
   * caller can hand the header its real state, but deliberately drives NO
   * styling today: the inline original this was extracted from rendered an
   * identical search button in both states, and this extraction is
   * pixel-for-pixel. An active-state treatment is a design decision for a
   * later commit — wire it here (one className) when that is decided, not
   * as a side effect of a refactor.
   */
  searchActive?:  boolean;
  onSearchToggle?: () => void;
}

export function ModuleMobileHeader({
  title,
  subtitle,
  avatarInitials,
  onAvatarClick,
  onMenuClick,
  showSearch = true,
  onSearchToggle,
}: ModuleMobileHeaderProps): React.JSX.Element {
  return (
    <div
      className="flex-shrink-0 bg-[#F5F3FF] border-b border-ink-100 flex items-center justify-between gap-2.5 px-3.5"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 11px)", paddingBottom: "10px" }}
    >
      <button
        type="button"
        onClick={onAvatarClick}
        aria-label="Open account menu"
        className="w-10 h-10 min-w-[44px] min-h-[44px] rounded-full bg-white border border-ink-100 active:bg-ink-50 flex items-center justify-center text-ink-600 text-[13px] font-bold shrink-0"
      >
        {avatarInitials}
      </button>
      {subtitle === undefined ? (
        <h1 className="text-[19px] font-extrabold text-brand-600 tracking-tight">{title}</h1>
      ) : (
        <div className="flex min-w-0 flex-col items-center">
          <h1 className="text-[19px] font-extrabold text-brand-600 tracking-tight">{title}</h1>
          <p className="max-w-full truncate text-[11.5px] font-medium text-ink-500 tabular-nums">
            {subtitle}
          </p>
        </div>
      )}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open all pages menu"
          className="w-11 h-11 rounded-[10px] flex items-center justify-center text-ink-600 active:bg-ink-100"
        >
          <LayoutGrid size={21} />
        </button>
        {showSearch && (
          <button
            type="button"
            onClick={onSearchToggle}
            aria-label="Search"
            className="w-11 h-11 rounded-[10px] flex items-center justify-center text-ink-600 active:bg-ink-100"
          >
            <Search size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
