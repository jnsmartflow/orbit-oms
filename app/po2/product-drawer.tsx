"use client";

import { useMemo, useRef, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
// Documented containment exception — the tested matcher /po uses, read-only.
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import V2Sheet, { useKeyboardOpen } from "./v2-sheet";
import {
  BRAND, FAINT, FILL, INK, MUTED, RULE, SEARCH_BG, VIOLET, VIOLET_BG,
  CUTOUT_SHADOW_RAIL,
  baseChipLabel, boardTileArtFor, formatPack, isBaseOption, isCutout, isLightHex, memberImage,
  packsOf, shadeHex, sortBases, sortedPacks, stepForLabel, tileArtFor, unitsIn,
  variantImage,
  type ApiProduct, type V2DrawerMode, type V2Option, type V2Resolved,
  type V2ResolvedMember, type V2ResolvedTile,
} from "./v2-data";

// The v2 product drawer — the bottom sheet a board tile opens.
//
// 🔴 CONTAINMENT — imports only ./v2-data, ./v2-sheet, the documented matcher
// and node_modules. Nothing else from lib/ or app/po/, no localStorage, no
// fetch. Every colour is an inline style.
//
// State is LOCAL and unmounted with the sheet: the page renders this with
// `key={tile.sap}`, so opening a different tile gives a fresh drawer rather
// than leaking the previous product's selections.
//
// EVERY OPTION IS A baseColour. Bases, shades and variants are the same kind
// of thing in the catalog — one `mo_order_form_index_v2` row each, identified
// by its `baseColour` string. They are three lists only because they are
// presented differently. So the selection is ONE value, and the packs shown
// are exactly that row's packs.
//
// ── THE RAIL REPLACED THE CHIP ROW, 2026-09-07 ─────────────────────────────
//
// What went, and why none of it is worth rebuilding:
//
//   "+ More"            an expander that hid options behind a tap. It had
//                       already been rebuilt twice — first as a search
//                       round-trip that dead-ended, then as a local expansion
//                       — and both times the real problem was that the row
//                       could not hold the list.
//   chipLimit()         the top-4 / top-9 cut. A cut only exists because the
//                       row was horizontal and finite. A column is neither.
//   the shade filter    a text search that appeared only INSIDE the expanded
//                       shade row. The search is now permanent and at the top,
//                       which is where a salesman looks for it.
//   shadeRowMode()      the ΔE close-pair rule that decided colour-vs-text for
//                       a WHOLE row. The rail decides per option — a hex gets
//                       a swatch, no hex gets a text tile — so the all-or-
//                       nothing question it answered no longer gets asked. Its
//                       reasoning is recorded in v2-data beside SHADE_HEX.
//
// WHAT SURVIVED, because it was expensive and is still true:
//   · every drawer opens with something selected and its packs on screen;
//   · the pre-selection is VISIBLE — now in the name bar, at full size;
//   · the selection is resolved against the WHOLE pool, never the visible list;
//   · switching options never clears quantities (they are keyed by option);
//   · the tab a drawer OPENS on comes from the 90-day ranking, not from "base".
//
// ── THREE FIXED PLACES, 2026-09-07 ─────────────────────────────────────────
//
// A tile can hold several PRODUCTS. Nothing drills, nothing is behind a back
// arrow:
//
//   STRIP  the products in this tile — only when the rail is busy holding
//          colours, which is the strip-products LAYOUT below
//   RAIL   the selected product's options — or, on a tile whose products have
//          no options at all, the products themselves
//   PANE   that option's packs
//
// 🔴 WHERE THE PRODUCTS GO IS A PROPERTY OF THE TILE, computed once from its
// members and pinned for as long as the drawer is open — see `Layout`. The
// rail-products case is not a special case bolted on: SEVEN of the thirty-six
// tiles are made entirely of products with nothing to choose (Crack Fillers,
// Thinners, FBC Advance's eleven), and for those a horizontal strip over an
// empty rail was two zones spent saying one thing. A column says it once, holds
// eleven without a swipe, and gives every name room to be read.
//
// 🔴 THE TWO-LEVEL RAIL AND ITS "‹" CHEVRON ARE GONE. They shipped for one
// commit and were wrong: a rail that is sometimes products and sometimes
// colours is a rail you have to read before you can use, and the back arrow
// was chrome that existed only to undo a move the design should not have asked
// for. Three fixed places cost one strip of height and nothing else — and the
// strip is paid for by trimming the pack rows, not added on top of them.
//
// 🔴 A ONE-MEMBER TILE SHOWS NO STRIP AT ALL. Nineteen of the thirty-six tiles
// hold one product; `isMerged` is false, the strip does not render, and the
// drawer is the rail and the pane exactly as before. That is the property this
// step is measured on.
//
// The drawer opens on the member the page names — the top seller from a board
// tap, the searched product from a search hit — so adding the thing he came
// for is still ONE TAP whatever the tile holds.
//
// NO HORIZONTAL SCROLL: the rail is a vertical column and the pane is
// `min-w-0`. Neither has an overflow-x. NO SECOND SHEET: a level is a state
// change inside the one sheet, so the ref-counted body-scroll lock and the
// --vvh / --vvo viewport pinning are untouched by any of this.

type Tab = "base" | "shade";

/**
 * 🔴 WHERE THE PRODUCTS LIVE. Decided ONCE PER TILE, never per selection.
 *
 *   single          one product. No strip, no product picker at all — the rail
 *                   is its options, exactly as it always was. Eighteen tiles.
 *   rail-products   several products and NOT ONE of them has an options level.
 *                   The rail has nothing else to hold, so it holds the products
 *                   and the pane holds the packs. Seven tiles — and it is the
 *                   right shape for them: FBC Advance has ELEVEN members, which
 *                   is three sideways swipes in a strip and one flick down in a
 *                   column, with every name readable instead of clipped.
 *   category-products
 *                   the members are grouped under CATEGORY chips. The strip
 *                   holds the categories, the rail holds that category's
 *                   PRODUCTS, the pane holds that product's packs. Both zones
 *                   are spent, so every member must have nothing to choose —
 *                   buildBoard throws otherwise. One tile: Thinner & Sealer,
 *                   twenty-one products that between them have no colour.
 *   strip-products  several products, at least one with an options level.
 *                   Products across the top, that product's options in the
 *                   rail.
 */
type Layout = "single" | "category-products" | "rail-products" | "strip-products";

/**
 * 🔴 THE TWO TILES THAT KEEP A BASE / SHADE TOGGLE. NAMED, NOT COUNTED.
 *
 * Gloss (38 options: 6 bases, 32 shades) and Super Satin (14: 7 and 7) carry
 * colour ranges wide enough that one combined column is a long scroll with
 * nowhere to jump to. Everywhere else the toggle was chrome over a list short
 * enough to read whole — Promise Enamel 10, Stay Bright 7, Pearl Glo 11 — and
 * it cost a tap to discover that the other group held two things.
 *
 * ⚠ IT MUST NOT BE A COUNT, AND THE LIVE DATA IS WHY: Protect Dustproof has
 * FIFTEEN options, one MORE than Super Satin. Any threshold that keeps Super
 * Satin keeps Dustproof, and Dustproof is precisely the tile the toggle is
 * being taken off. There is no number that separates them, because what
 * separates them is not size — it is that one range is browsed and the other is
 * looked up. That is a curation judgement about two specific products, so it is
 * written as two specific names.
 *
 * THE DAY A THIRD TILE WANTS IT: add its sap here and say in the commit which
 * range grew and why. Do NOT "generalise" this back into a rule — that is
 * exactly how Dustproof gets its toggle back by accident.
 *
 * Keyed on the MEMBER's sap, not on the tile key, because a toggle belongs to a
 * product's option list and a tile can hold sixteen products. Both names here
 * are single-member tiles today, so the two happen to coincide; keying on the
 * member is what stays correct if either is ever merged into a bigger tile.
 */
const TOGGLE_MEMBERS: ReadonlySet<string> = new Set(["GLOSS", "SUPER SATIN"]);

/**
 * One product inside the open tile, normalised.
 *
 * 🔴 mode AND pools ARE THE MEMBER'S OWN, never the tile's. buildBoard resolved
 * them per member precisely so nothing downstream has to, and the union is
 * wrong for twelve of the seventeen merged tiles — six of which are made
 * entirely of option-less products that a union would hand a base/shade shell.
 */
type Member = {
  /**
   * 🔴 THE DRAWER'S KEY, NOT ALWAYS THE CATALOG KEY. For a PINNED member it is
   * "WOOD PRIMER|||White" — see V2ResolvedMember.sap. Everything the drawer
   * keys by member keys by THIS: the quantity matrix, the selection, the count
   * badge. Sharing it between two pinned twins would sum White's units into
   * Pink's badge and let an edit of one wipe the other.
   */
  sap:      string;
  /** COALESCE(product, subProduct). What the CART speaks; see seatOf(). */
  joinSap:  string;
  /** The pinned baseColour, or null for an ordinary member. */
  pin:      string | null;
  /** The category chip this member sits under, or null. */
  category: string | null;
  label:    string;
  resolved: V2Resolved;
  mode:     V2DrawerMode;
  pools:    { all: V2Option[]; bases: V2Option[]; shades: V2Option[] };
};

type Rails = {
  hasVariants: boolean;
  /** Frequency order — what the pre-selection reads. */
  ranked: V2Option[];
  /** The base column, in numbered sequence. */
  bases:  V2Option[];
  shades: V2Option[];
  isBaseColumn: boolean;
};

const NO_POOLS = { all: [] as V2Option[], bases: [] as V2Option[], shades: [] as V2Option[] };

/**
 * One member's two option columns. Lifted out of the component unchanged from
 * what it used to compute inline, so a single-member tile gets byte-identical
 * lists and a merged tile gets each member's own.
 */
function buildRails(m: Member): Rails {
  const hasVariants = m.resolved.variants.length > 0;
  const all = m.pools.all;
  const ranked = hasVariants ? withTail(m.resolved.variants, all)
    : !m.resolved.curated ? withTail(m.resolved.bases, all)
    : withTail(m.resolved.bases, m.pools.bases);
  const isBaseColumn = !hasVariants && m.resolved.curated;
  return {
    hasVariants, ranked,
    bases: isBaseColumn ? sortBases(ranked) : ranked,
    shades: hasVariants || !m.resolved.curated
      ? [] : withTail(m.resolved.shades, m.pools.shades),
    isBaseColumn,
  };
}

/**
 * 🔴 §55's AUTO-FOCUS GATE, AND ITS EXACT EXPRESSION.
 *
 * CLAUDE_UI.md:1317 — "Mount / mode-transition auto-focus is **desktop-only**,
 * gated on `window.matchMedia("(min-width: 768px)").matches` … focusing an
 * input on a phone would spring the keyboard over the content." /po carries
 * the same test at three sites (po-page.tsx:999, :1012, :1781). The breakpoint
 * is quoted from the rule rather than chosen here, so the two routes cannot
 * drift into two different ideas of "desktop".
 *
 * ⚠ IT IS READ AT RENDER, NOT CACHED. A tablet rotating across 768px between
 * one drawer and the next should get the answer for the width it is at now,
 * and this is a single matchMedia read on a control that mounts on a tap.
 *
 * The `typeof window` guard is for the server render, where matchMedia does
 * not exist. False is the right SSR answer regardless: nothing should be
 * focused before hydration.
 */
function autoFocusAllowed(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(min-width: 768px)").matches;
}

/** Does this member have an OPTIONS level to drill into at all? */
function hasOptions(m: Member, r: Rails): boolean {
  return m.mode !== "flat" && r.bases.length + r.shades.length > 0;
}

/**
 * "90 BASE" — a base whose short form is a NUMBER and whose full name is that
 * number plus the word BASE, so the glyph in the square already says all of it.
 *
 * ⚠ THE TEST IS ON THE WHOLE NAME, not just on the short form. "95 BASE PLUS"
 * would give the short form "95 BASE PLUS" through baseChipLabel (no trailing
 * " base" to strip), fail this test, and keep its caption — which is right,
 * because PLUS is information the square is not carrying. Nothing in the
 * catalog looks like that today; the test is written so that if one arrives it
 * errs towards saying more rather than less.
 */
function numberedBase(value: string): boolean {
  const v = value.trim().toUpperCase();
  return /^\d+$/.test(baseChipLabel(v)) && v === baseChipLabel(v) + " BASE";
}

/**
 * Rail geometry, in one place because "roomy" is a measured requirement.
 *
 * 🔴 104px OF RAIL, 60px SQUARES, AND THE NAME UNDER THE SQUARE.
 *
 * It was a 60px column of 44px chips with the word crammed INSIDE the box —
 * which is what set a nine-letter base name at 8.5px, clipped, on the tile
 * whose whole job was to identify it. A name has no business inside a picture
 * frame. The square is now only ever a PICTURE (a tin, a colour, or a base's
 * number set large), and the word sits underneath it with the full width of
 * the cell to itself.
 *
 * 60px is the size the product chip already uses in the strip, so a tile in the
 * rail and a tile in the strip are visibly the same object — which is the point
 * of merging them into one component. It is also the smallest square a real
 * 600x600 tin photo reads as deliberate in rather than incidental.
 *
 * 🔴 THE 44px CAME OUT OF THE PACK ROW'S DEAD GAP, NOT OUT OF A TAP TARGET.
 * A pack row is a short label — "100ML" is the widest anywhere on the board —
 * against a right-aligned stepper, and everything between them was air. At
 * 390px the pane is now 285 wide: 253 inside its px-4, less the 118px stepper
 * and the 12px gap, leaves 123px for a label that needs about 45. The +/- stay
 * 36px square — they are tapped by a man on a warehouse floor wearing gloves
 * and they are not a budget.
 */
const RAIL_W    = 104;  // the column, gutters and border included
const RAIL_CELL = 88;   // the tile's cell inside it — square plus name
const RAIL_TILE = 60;   // the square itself, which is a picture and never a word
/**
 * ONE size for every tile label in the drawer, rail and strip alike — owner
 * ruling 2026-09-09. Named rather than inlined so the two call sites cannot
 * drift apart, and so the reasoning has somewhere to point. See TileName.
 *
 * ⚠ IT WAS 9 FOR ONE COMMIT AND THAT WAS WRONG — corrected the same day. 9px
 * was the size that fitted the single widest string in the catalog, so it
 * shrank 198 of 221 labels to accommodate one defective row. A long name is
 * supposed to WRAP into the two-line block, not shrink the grid around it.
 */
const TILE_LABEL_PX = 11;
const TILE_GAP  = 12;   // between tiles — the brief's floor is 10

/**
 * Product-strip geometry.
 *
 * 🔴 THE TILE IS 56px — BIGGER THAN A RAIL SWATCH (44) AND SMALLER THAN A
 * BOARD TILE (~79 at 390px). It has to read as "a product", which a 44px
 * swatch does not, without reading as "the board", which is a different screen.
 *
 * The CELL is wider than the tile so the NAME gets room the square does not
 * need: 72px of text under a 56px picture. That is what lets "Pretreatment
 * Coat" and "Damp Protect Basecoat" wrap to two lines instead of clipping.
 *
 * 🔴 72, NOT 64, AND THE REASON IS THE SCROLL AFFORDANCE. At a 64px cell the
 * arithmetic on a 390px phone lands at FIVE whole tiles and a 6px sliver of the
 * sixth — a sliver nobody reads as "there is more to the right", on the six
 * tiles that actually scroll. At 72 it lands at four whole tiles and 46px of
 * the fifth: an obvious half-tile, which is the whole cue. The extra 8px of
 * name width is a bonus, not the reason.
 */
/**
 * Trailing space under the LAST pack row. Breathing room, and nothing else.
 *
 * 🔴 IT USED TO BE `calc(76px + safe-area)`, AND 76 WAS THE FOOTER'S HEIGHT.
 * The footer is a flex SIBLING and has never overlapped this scroller, so a
 * number equal to its height was a reservation for a collision that cannot
 * happen — measured, the footer comes to 71.5px, which is where 76 came from.
 * A constant that pretends to be another element's height is a constant that
 * goes wrong silently the first time that element changes.
 *
 * 🔴 WHAT THE SPACE IS ACTUALLY FOR, still. v2-sheet's note (2) records that
 * `block: "nearest"` "stops the moment the row's edge touches the container's
 * edge, which is flush against the footer's border. Technically visible; reads
 * as half-hidden." That is a real complaint and it survives the change from
 * "center" to "nearest" — so the room stays, at about half a pack row, which
 * is what it takes for the last row to look finished rather than cut off.
 *
 * ⚠ THE SAFE-AREA TERM IS GONE TOO. The FOOTER carries the home-indicator
 * inset (v2-sheet: `max(env(safe-area-inset-bottom), 12px)`), and it sits
 * below this scroller. Adding it here paid for the same strip twice.
 */
const PACK_TRAILING = 24;

const STRIP_TILE = 56;
const STRIP_CELL = 72;
const STRIP_GAP  = 8;

/**
 * The ranked list, then anything the catalog has that the ranking does not
 * name, so the column holds EVERY option and nothing is unreachable.
 *
 * CURATION's arrays are ordered by 90-day order frequency, so `ranked` is
 * already "most-ordered first" — the top of the column IS the curation, with
 * no heading saying so. The tail is whatever else the payload carries for this
 * product, in the depot's own sortOrder.
 */
function withTail(ranked: V2Option[], pool: V2Option[]): V2Option[] {
  if (pool.length === 0) return ranked;
  const seen = new Set(ranked.map((o) => o.value));
  const tail = pool.filter((o) => !seen.has(o.value));
  return tail.length === 0 ? ranked : ranked.concat(tail);
}

export default function ProductDrawer({
  product,
  tile,
  initialMember = null,
  initialOption = null,
  onClose,
  onAdd,
  existing,
  pools,
  mode = "standard",
}: {
  /**
   * The ONE product to show when no tile is passed — the search-hit path, for
   * a product that is on no board tile. When `tile` IS passed this is the
   * member the page opened on and the tile is the authority.
   */
  product: V2Resolved;
  /**
   * The whole tile, every member resolved on its own rows. Present for every
   * board tap; absent only for a searched non-tile product.
   */
  tile?: V2ResolvedTile;
  /** Which member to open on — the top seller, or the searched product. */
  initialMember?: string | null;
  /** Opened from a search hit: this exact option starts selected. */
  initialOption?: string | null;
  onClose: () => void;
  /** MANY lines: one pick per option carrying a quantity. */
  onAdd: (picks: { option: string | null; row: ApiProduct; qtys: Record<string, number> }[]) => void;
  /**
   * The cart lines this product ALREADY has. The drawer opens seeded from them,
   * and onAdd REPLACES them — so reopening a product to change one base is an
   * edit, not a second helping of the same order.
   */
  /**
   * 🔴 EVERY MEMBER'S LINES, EACH TAGGED WITH THE MEMBER IT BELONGS TO.
   *
   * `member` is not optional decoration: "90 Base" is an option on four
   * different members across two tiles, so a flat {option, qtys} list cannot
   * say which product a saved quantity belongs to, and seeding it under the
   * wrong one would show a salesman someone else's numbers. It is the catalog
   * join key — `product ?? subProduct` off the stored line.
   */
  existing?: { member: string; option: string | null; qtys: Record<string, number> }[];
  /**
   * EVERY option this product has, in catalog order, split base/shade.
   *
   * These used to be the pool behind "+ More". They are now simply the rest of
   * the column: whatever the 90-day ranking does not name is appended after it,
   * so the rail is complete without a second list or a second cut.
   */
  pools?: { all: V2Option[]; bases: V2Option[]; shades: V2Option[] };
  /** From drawerMode() in v2-data — the ONE place the shape is decided. */
  mode?: V2DrawerMode;
}): React.JSX.Element {
  // ── The tile's members ───────────────────────────────────────────────────
  //
  // A searched non-tile product has no tile, so it becomes a tile of one. That
  // is the same collapse Step 1 made in the data: one shape, always a list, and
  // the single case is the degenerate one rather than a second branch.
  const members = useMemo<Member[]>(() => {
    if (tile) {
      return tile.members.map((m: V2ResolvedMember) => ({
        sap: m.sap, joinSap: m.joinSap, pin: m.pin, category: m.category,
        label: m.label, resolved: m, mode: m.mode, pools: m.pools,
      }));
    }
    // A searched non-tile product is never pinned: it is whatever the catalog
    // group resolved to, and its key is its own sap.
    return [{ sap: product.sap, joinSap: product.sap, pin: null, category: null,
              label: product.label, resolved: product,
              mode, pools: pools ?? NO_POOLS }];
  }, [tile, product, pools, mode]);
  const isMerged = members.length > 1;

  /** Every member's option columns, computed once per member. */
  const railsBy = useMemo<Record<string, Rails>>(() => {
    const out: Record<string, Rails> = {};
    for (const m of members) out[m.sap] = buildRails(m);
    return out;
  }, [members]);

  /**
   * 🔴 THE OPEN CATEGORY. It follows the SELECTED PRODUCT rather than being a
   * second source of truth: tapping a chip selects that category's first
   * product, and everything else — the rail, the pane, the badges — reads the
   * product. One state, so the two can never disagree.
   */
  const [memberSap, setMemberSap] = useState<string>(() =>
    // The page names a CATALOG sap (a search hit, or the tile's top seller), so
    // fall back to the first member carrying that join key — which, for a
    // pinned pair, is the one the board would have opened on anyway.
    members.find((m) => m.sap === initialMember)?.sap ??
    members.find((m) => m.joinSap === initialMember)?.sap ??
    members[0].sap);
  const cur = members.find((m) => m.sap === memberSap) ?? members[0];
  /** The category the selected product sits in — the chip that reads active. */
  const activeCategory = cur.category;
  /** The rail's rows in a category tile: that category's products, in order. */
  const inCategory = useMemo<Member[]>(
    () => (activeCategory === null ? members : members.filter((m) => m.category === activeCategory)),
    [members, activeCategory]);
  const rails = railsBy[cur.sap];
  const curHasOptions = hasOptions(cur, rails);

  // Open on the group that actually holds the searched option, so what the
  // salesman searched for is on screen rather than one tap away.
  //
  // 🔴 THE FINAL FALLBACK IS "base", NOT "shade". It used to be
  // `hasBases ? "base" : "shade"`, which handed a product with NEITHER list a
  // phantom shade group — see the footer-gating note below, which is where
  // that once turned into a blocking bug.
  //
  // PER MEMBER, because each member has its own defaultTab off its own 90-day
  // ranking. Switching member and back must not land on the other one's group.
  const openTabFor = (m: Member): Tab => {
    const r = railsBy[m.sap];
    if (m === cur && initialOption && r.shades.some((o) => o.value === initialOption)) return "shade";
    // 🔴 OPEN ON THE GROUP HOLDING THE MOST-ORDERED OPTION, not always Base.
    // Promise Enamel's only base is BRILLIANT WHITE (241 orders) while its top
    // shade CLASSIC WHITE takes 797 — opening on that one-tile Base column
    // would put what he actually wants one tap away, every single time.
    if (m.resolved.defaultTab === "shade" && r.shades.length > 0) return "shade";
    if (r.bases.length > 0)  return "base";
    if (r.shades.length > 0) return "shade";
    return "base";
  };
  const [tabBy, setTabBy] = useState<Record<string, Tab>>(() => {
    const seed: Record<string, Tab> = {};
    for (const m of members) seed[m.sap] = openTabFor(m);
    return seed;
  });
  const tab = tabBy[cur.sap] ?? "base";

  // ONE selection per member, whichever column it came from.
  //
  // 🔴 EVERY DRAWER OPENS WITH SOMETHING SELECTED, AND ITS PACKS ON SCREEN.
  // Shade and variant rows used to open empty on the reasoning that guessing a
  // colour for him is worse than asking — which sounds right and was wrong. It
  // bought a dead screen — no pack sizes, a nag where the quantity belongs, and
  // a grey Add button — and made every one of those products cost two taps for
  // the thing he came to order. The lists are RANKED by 90 days of real orders,
  // so [0] is not a guess: it is the option this product actually sells.
  //
  // The pre-selection is only safe because it is VISIBLE — the NAME BAR spells
  // it out at 15px directly above the packs.
  //
  // 🔴 THE DEFAULT READS `ranked`, NOT `bases`. Since the base column sorts
  // into its numbered sequence, its first TILE is BW on almost every product —
  // and BW is not what most of them sell. Protect Hi-Sheen sells 93 BASE and
  // Max sells 92 BASE, and letting the sort choose the default would have
  // silently changed what those two send for anyone who did not touch the rail.
  // Sequence is for finding; frequency is for selling.
  const defaultOptionFor = (m: Member): string | null => {
    const r = railsBy[m.sap];
    const opening = m.resolved.defaultTab === "shade" && r.shades.length > 0 ? r.shades : r.ranked;
    return opening[0]?.value ?? null;
  };
  const [selectedBy, setSelectedBy] = useState<Record<string, string | null>>(() => {
    const seed: Record<string, string | null> = {};
    for (const m of members) seed[m.sap] = defaultOptionFor(m);
    if (initialOption) {
      const on = members.find((m) => m.sap === initialMember)?.sap ?? members[0].sap;
      seed[on] = initialOption;
    }
    return seed;
  });
  const selected = selectedBy[cur.sap] ?? null;

  /**
   * 🔴 ONE QUANTITY STATE FOR THE WHOLE VISIT:
   *        member -> option -> pack label -> units.
   *
   * There used to be two levels, and before that two separate states. The
   * second level arrived when one tile started holding several products, and it
   * is NESTED rather than a composite string key for one measured reason:
   * "90 Base" is an option on PU Prime Matt, PU Prime Gloss, 2K PU Matt and 2K
   * PU Gloss — four members across two tiles — so a flat `member|option` string
   * is one typo away from two products sharing a bucket. A nest cannot collide.
   *
   * A product with NO options at all keys on "" under its own member, which is
   * the honest shape rather than a second code path.
   */
  /**
   * 🔴 WHERE A STORED CART LINE SITS IN THIS DRAWER.
   *
   * The page speaks the CATALOG's language — existingFor returns
   * { member: "WOOD PRIMER", option: "White" }, because that is what the line
   * stores and what addLines will write back. The drawer speaks its own: that
   * line belongs to the member keyed "WOOD PRIMER|||White", under option "",
   * because a pinned member has no option level.
   *
   * The translation is a pure function of the member list and lives here not
   * in po-v2-page.tsx on purpose: the page has no business knowing that a tile
   * splits one product into two chips. It reads the pinned members FIRST, for
   * the same reason memberLabelIn does — an unpinned lookup would match the
   * twins' shared joinSap and put Pink's quantity in White's column.
   */
  const seatOf = (memberSap: string, option: string | null): { key: string; opt: string } => {
    const pinned = members.find((m) => m.pin !== null && m.joinSap === memberSap && m.pin === option);
    if (pinned) return { key: pinned.sap, opt: "" };
    return { key: memberSap, opt: option ?? "" };
  };

  const [matrix, setMatrix] = useState<Record<string, Record<string, Record<string, number>>>>(() => {
    // SEEDED FROM THE CART, PER MEMBER. Opening a tile already in the order
    // shows what is in it, on the right member and the right option, so Add can
    // replace rather than duplicate — and so he can SEE what he already ordered
    // before changing it. Every member's lines are seeded, not just the one on
    // screen: the drawer replaces the whole tile, so anything it fails to seed
    // is work it would silently throw away.
    const seed: Record<string, Record<string, Record<string, number>>> = {};
    for (const line of existing ?? []) {
      const { key, opt } = seatOf(line.member, line.option);
      const byOpt = seed[key] ?? {};
      byOpt[opt] = { ...(byOpt[opt] ?? {}), ...line.qtys };
      seed[key] = byOpt;
    }
    return seed;
  });

  // ── The rail's own search ────────────────────────────────────────────────
  //
  // 🔴 PERMANENT, NOT BEHIND AN EXPANDER. With no names on the tiles this is
  // the only way to reach one colour among thirty-two without hunting, so it
  // cannot be something he has to find first. It filters WHICHEVER LEVEL is
  // showing — members when he is choosing a product, options when he is
  // choosing a colour.
  //
  // Ranked with the SAME matcher the board's search bar uses — a second
  // matcher is a second set of results for the same word.
  const [query, setQuery] = useState("");
  /**
   * 🔴 THE SEARCH IS AN ICON UNTIL IT IS ASKED FOR. A field that is always
   * open spends a whole row of a phone screen saying "you could type here",
   * every time, on thirty-six tiles most of which have four options. The
   * magnifier costs nothing until it is tapped and then takes the full width.
   *
   * It is a STATE CHANGE INSIDE THE ONE SHEET — no second sheet, nothing
   * mounted or unmounted around V2Sheet — so the ref-counted body-scroll lock
   * and the --vvh / --vvo viewport pinning are not touched by it.
   */
  const [searchOpen, setSearchOpen] = useState(false);

  /**
   * 🔴 THE QUERY IS CLEARED ONLY BY AN EXPLICIT USER ACTION — the X on the
   * search row, or closing the drawer. NEVER by selecting a member, never by
   * switching a tab, never by picking a category.
   *
   * Three handlers used to wipe it — switchTab, selectCategory and
   * selectMember — so typing "teak" and then TAPPING THE RESULT threw the
   * search away at the exact moment it had done its job. The salesman was
   * left looking at an unfiltered rail with no idea what he had typed, and
   * the only way back was to type it again. That is the whole "the search is
   * broken and inconsistent" complaint: it was not the matching that was
   * wrong, it was that the field emptied itself under him.
   *
   * ⚠ A LIVE QUERY CAN LEAVE THE RAIL EMPTY, AND THAT IS CORRECT. On a
   * strip-products tile the PRODUCT STRIP is deliberately unfiltered (see its
   * `members.map` below), so moving to a second product whose ladder holds no
   * match leaves the options column with nothing to list. The "Nothing in
   * this list matches" line says so, and the PANE is unaffected — it resolves
   * from the full pool, never from `shown`. Do not "fix" that by clearing the
   * query again; the two are different questions, as the note on the
   * selection below has said since it was written.
   *
   * ⚠ CLOSING THE DRAWER CLEARS IT TOO, and costs no code: po-v2-page mounts
   * this component conditionally (`{openTile && openMember && …}` at :2232,
   * `{openGroup && groupResolved && …}` at :2346), so the whole component
   * unmounts and this useState is born empty on the next open.
   */
  function closeSearch(): void {
    setSearchOpen(false);
    setQuery("");
  }

  /**
   * 🔴 THE LAYOUT IS A PROPERTY OF THE TILE. It reads `members` and
   * `railsBy` — both memoised on the tile — and nothing else, so it CANNOT
   * change while the drawer is open. That is the whole point: a drawer that
   * reshapes itself when you tap a product moves the next target out from under
   * the thumb, and the man doing it is holding the phone in one hand.
   */
  /**
   * The categories, in FIRST-APPEARANCE order — no second list to keep in step
   * with the members, so a category cannot outlive its last product.
   */
  const categories = useMemo<string[]>(() => {
    const out: string[] = [];
    for (const m of members) if (m.category !== null && !out.includes(m.category)) out.push(m.category);
    return out;
  }, [members]);

  const layout: Layout = !isMerged ? "single"
    : categories.length > 0 ? "category-products"
    : members.every((m) => !hasOptions(m, railsBy[m.sap])) ? "rail-products"
    : "strip-products";
  /** In BOTH of these the rail's rows are PRODUCTS, not options. */
  const railHoldsProducts = layout === "rail-products" || layout === "category-products";

  /**
   * Whether the OPTIONS column renders. This is per member and has to be — no
   * layout rule can give Cement Primer WB a colour to choose, and Exterior
   * Acrylic Primer holds six products of which exactly one has options.
   *
   * 🔴 AND NOTHING A THUMB AIMS AT MOVES WHEN IT CHANGES. The rail is on the
   * LEFT and the pack row's stepper is right-aligned against the sheet edge, so
   * dropping the rail widens the pane leftwards: the +/- buttons stay exactly
   * where they were and only the label — which is not a tap target — slides
   * left. That is what makes a per-member RAIL safe where a per-member LAYOUT
   * would not be.
   */
  const showRail = railHoldsProducts || curHasOptions;

  /**
   * 🔴 TWO NAMED PRODUCTS, NOT A COUNT — see TOGGLE_MEMBERS. Everywhere else
   * the rail now shows ONE combined column: the bases first in their numbered
   * sequence, then the shades in 90-day sales order.
   *
   * 🔴 IT IS A CHIP ROW NOW, NOT A TOGGLE, AND GroupButton IS GONE. The two
   * groups were a stacked segmented control at the top of the RAIL — two 44px
   * halves in an 88px column, one above the other, because side by side they
   * would have been 41px wide. That shape only ever existed to fit the rail,
   * and it made the one control on the sheet that is not a product look like
   * two products. Base and Shade are a FILTER over the list below them, which
   * is exactly what a category chip is, so they are drawn with the same
   * component in the same zone — one control, one appearance, in both places
   * it appears.
   */
  const showGroupChips = !railHoldsProducts && TOGGLE_MEMBERS.has(cur.sap) &&
    rails.bases.length > 0 && rails.shades.length > 0;

  const onShade = tab === "shade" ? rails.shades.length > 0 : rails.bases.length === 0;
  /**
   * 🔴 ONE LIST UNLESS THE PRODUCT IS ONE OF THE NAMED TWO.
   *
   * With a toggle, the group he is on. Without one, BOTH groups concatenated:
   * bases first in the numbered sequence sortBases left them in, then the
   * shades in sales order. The two are never confusable in a combined column,
   * because a base draws its number large inside the square while a shade draws
   * its own colour — the join is visible without a heading over it.
   */
  const column: V2Option[] = showGroupChips
    ? (onShade ? rails.shades : rails.bases)
    : rails.bases.concat(rails.shades);
  /**
   * 🔴 EACH TILE DECIDES FOR ITSELF NOW. A column-wide "kind" cannot survive a
   * list that holds both groups at once, so the base/shade/variant/mixed enum
   * is gone and BigTile asks isBaseOption() — the same rule that split the two
   * groups in the first place. A base is therefore a numbered square wherever
   * it appears and a shade is its own colour wherever it appears, which is the
   * property the enum kept breaking the moment the two lists were shown
   * together.
   */
  /** The family wash a variant's tin sits on, exactly as on the board. */
  const wash = tile ? boardTileArtFor(tile.key).wash : tileArtFor(product.sap).wash;

  /** The options the rail lists, filtered by the search when it is open. */
  const shown = useMemo<V2Option[]>(() => {
    const q = query.trim();
    if (q.length === 0) return column;
    const ranked = rankProductsForQuery(column.map((o) => o.row), q);
    const byId = new Map(column.map((o) => [o.row.id, o]));
    return ranked.map((r) => byId.get(r.id)).filter((o): o is V2Option => !!o);
  }, [query, column]);

  /**
   * 🔴 AND THE SAME FOR THE PRODUCT LEVEL, so the magnifier is not a dead
   * control on the seven tiles whose rail holds products. FBC Advance's rail is
   * eleven of them; typing "putty" should cut it to one, exactly as typing a
   * colour cuts an options column. Same matcher, same shape, same behaviour.
   *
   * A member is matched through the ROW the catalog join gave it — its
   * no-option row where it has one, otherwise the first row of its pool —
   * because that row is what carries the search tokens.
   */
  const shownMembers = useMemo<Member[]>(() => {
    const q = query.trim();
    // 🔴 THE SEARCH CROSSES CATEGORIES. Typing "melamine" on the Thinner chip
    // should find Melamine Sealer under Sealer — a man who knows the product
    // name does not know which chip somebody filed it under, and making him
    // guess is worse than the scroll it saves. The chips stay on screen and the
    // one holding the match reads active as soon as he taps a result.
    const pool = q.length === 0 ? inCategory : members;
    if (q.length === 0) return pool;
    const rowOf = (m: Member): ApiProduct | null =>
      m.resolved.noOptionRow ?? m.pools.all[0]?.row ?? m.resolved.bases[0]?.row ?? null;
    const rows = pool.map(rowOf).filter((r): r is ApiProduct => r !== null);
    const order = new Map(rankProductsForQuery(rows, q).map((r, i) => [r.id, i]));
    const rank = (m: Member): number => {
      const r = rowOf(m);
      return r === null ? -1 : order.get(r.id) ?? -1;
    };
    return pool.filter((m) => rank(m) >= 0).sort((a, b) => rank(a) - rank(b));
  }, [query, members, inCategory]);

  // 🔴 THE SELECTION IS RESOLVED AGAINST THE WHOLE POOL, NOT THE VISIBLE LIST.
  // It used to be looked up in the list on screen, which collapsed back to the
  // curated nine the moment the search closed — so a shade picked out of "+
  // More" (BUS GREEN, say) was no longer findable, selectedRow fell to null,
  // the body kept demanding a shade and Add stayed dead while the header
  // cheerfully showed BUS GREEN. Typing a query still hides most of the column,
  // and what is selected and what is listed remain two different questions.
  const optionPoolFor = (m: Member): V2Option[] => {
    const r = railsBy[m.sap];
    return m.pools.all.length > 0 ? m.pools.all : r.bases.concat(r.shades);
  };
  const selectedOption = selected === null
    ? undefined
    : optionPoolFor(cur).find((o) => o.value === selected);

  const selectedRow: ApiProduct | null =
    cur.resolved.noOptionRow ?? selectedOption?.row ?? null;

  const packLabels = selectedRow
    ? sortedPacks(selectedRow.packs).map((p) => formatPack(p.packCode, p.unit))
    : [];

  /**
   * Switching the group re-applies the rule the drawer opened with: the
   * top-ranked option of the group being switched TO is selected, so a column
   * is never a dead screen either. The QUANTITIES are untouched — they are
   * keyed by option and every option keeps its own.
   */
  function switchTab(next: Tab): void {
    if (next === tab) return;
    // `ranked`, not `bases`, for the reason at defaultOptionFor above.
    const list = next === "base" ? rails.ranked : rails.shades;
    setTabBy((prev) => ({ ...prev, [cur.sap]: next }));
    setSelectedBy((prev) => ({ ...prev, [cur.sap]: list[0]?.value ?? null }));
    // The query SURVIVES a tab switch — see the rule on closeSearch. Base and
    // Shade are two halves of one ladder, and a man who typed "teak" wants it
    // applied to whichever half he is looking at, not thrown away when he
    // checks the other one.
  }

  /**
   * 🔴 SWITCHING OPTIONS NO LONGER CLEARS ANYTHING. It used to wipe the
   * quantities, on the reasoning that packs belong to the ROW and carrying a
   * "20L x 2" to a row that may not sell 20L would be wrong. True — but the fix
   * for that is keying quantities BY OPTION, which is what happens now, not
   * throwing away what he just typed.
   */
  function selectOption(value: string): void {
    if (value === selected) return;
    setSelectedBy((prev) => ({ ...prev, [cur.sap]: value }));
  }

  /**
   * 🔴 SWITCHING PRODUCT CLEARS NOTHING EITHER, AND IT IS THE SAME ARGUMENT
   * ONE LEVEL UP. The quantities are keyed by member as well as by option, so
   * everything he has typed against every product in this tile survives every
   * move he makes inside it, and the drawer returns the lot on Add.
   *
   * The rail and the pane both swap to the new product. Nothing drills and
   * nothing has to be undone.
   */
  /**
   * Tapping a chip selects that category's FIRST product, so the pane is never
   * empty and the next tap is a quantity. It clears nothing: quantities are
   * keyed by member and every member keeps its own, exactly as switching a
   * product or an option does everywhere else in this drawer.
   */
  // Neither of these clears the query — see the rule on closeSearch. Tapping a
  // result is the moment the search PAID OFF; emptying the field there is the
  // one thing guaranteed to feel broken.
  function selectCategory(name: string): void {
    if (name === activeCategory) return;
    const first = members.find((m) => m.category === name);
    if (first) setMemberSap(first.sap);
  }

  function selectMember(sap: string): void {
    if (sap === cur.sap) return;
    // Guarded against the FULL member list, not the filtered one, so a tap on
    // a search result is accepted whether or not the rail is showing it.
    if (!members.some((x) => x.sap === sap)) return;
    setMemberSap(sap);
  }

  /**
   * 🔴 COMPACT — the drawer with the keyboard up and the search open.
   *
   * WHY IT HAS TO EXIST. Every sibling above the rail is shrink-0, so when the
   * keyboard halves the viewport there is nothing left for flex-1 to give and
   * the fixed-height parts OVERFLOW a section that is overflow-hidden but still
   * scrollable by script. That overflow is what let the footer be dragged over
   * the pack rows. Measured on a 320x568 phone with the keyboard up: the sheet
   * is ~290px and the shrink-0 siblings come to ~379px, so the rail and pane
   * were asked to fit in MINUS 89 pixels. Collapsing the two controls below
   * takes the siblings to ~208px and leaves +81, and a section that does not
   * overflow cannot be scrolled at all.
   *
   * WHAT COLLAPSES, AND WHY THOSE TWO. The category chips and the product strip
   * are both ways of CHOOSING WHICH LIST THE RAIL SHOWS — and at this moment
   * the rail is showing search results, so both are answering a question the
   * salesman has stopped asking. The search bar, the rail, the pane and the
   * footer all stay: they are what he is looking at and what he acts with.
   *
   * ⚠ BOTH CONDITIONS, NOT JUST keyboardOpen. The number keypad on a pack row
   * also raises the keyboard, and there the strip is exactly what he needs to
   * move to the next product without dismissing anything. Collapsing on the
   * keyboard alone would take a control away mid-task. `searchOpen` is what
   * says "he is choosing from the rail", which is the state the strip and the
   * chips are redundant in.
   *
   * ⚠ THE HEADER AND GRAB BAR STAY, deliberately. Dropping the header's
   * sub-line would save 17px and the whole header 62px, but the header is the
   * only thing on screen naming the product, and +81 was already enough. The
   * numbers are recorded so the trade is available if a smaller phone ever
   * needs it.
   */
  const keyboardOpen = useKeyboardOpen();
  const compact = keyboardOpen && searchOpen;

  const matrixMode = cur.mode === "flat";
  const options = cur.pools.all;
  // FLAT is one pack for the whole product, so the label is stated once in the
  // header instead of on every row.
  const flatPack = matrixMode ? (packsOf(options.map((o) => o.row))[0] ?? "") : "";

  /** The key the currently-selected option writes under. "" = no options. */
  const optionKey = selected ?? "";
  const qtys = matrix[cur.sap]?.[optionKey] ?? {};

  // One tap moves a WHOLE BOX; the value shown stays in UNITS. So 1L reads
  // 0 -> 6 -> 12, and 20L (a drum, step 1) reads 0 -> 1 -> 2. Floors at 0.
  //
  // 🔴 cur.joinSap, NOT cur.sap — and this is the site the carton overrides
  // were being missed at. `joinSap` is COALESCE(product, subProduct), the
  // SAP-clean stock name `cartonOverride()` keys on; `sap` carries
  // memberKey(sap, option) for a PINNED member ("WOOD PRIMER|||White"), which
  // matches no override and would quietly fall through to the global table.
  // Both callers pass cur.sap as `member`, so reading cur here is consistent.
  // With the key supplied, GVA / Acotone / Machine Tinter 1L step by 1.
  function stepCell(member: string, option: string, pack: string, direction: 1 | -1): void {
    const delta = stepForLabel(pack, cur.joinSap) * direction;
    setMatrix((prev) => {
      const byOpt = { ...(prev[member] ?? {}) };
      const row = { ...(byOpt[option] ?? {}) };
      row[pack] = Math.max(0, (row[pack] ?? 0) + delta);
      byOpt[option] = row;
      return { ...prev, [member]: byOpt };
    });
  }

  /**
   * A TYPED figure, stored as typed. The field has already reduced anything
   * non-numeric to 0 (see QtyField); this is the last non-negative guard and
   * it does NOT round to a box. Owner ruling 2026-09-09 — 9 stays 9.
   */
  function typeCell(member: string, option: string, pack: string, units: number): void {
    setMatrix((prev) => {
      const byOpt = { ...(prev[member] ?? {}) };
      byOpt[option] = { ...(byOpt[option] ?? {}), [pack]: Math.max(0, units) };
      return { ...prev, [member]: byOpt };
    });
  }

  /** Units on ONE option of ONE member, for the badge on its option tile. */
  function unitsOn(member: string, option: string): number {
    return unitsIn(matrix[member]?.[option] ?? {});
  }

  /** Units on a whole CATEGORY — the chip badge. Sums its products. */
  function unitsInCategory(name: string): number {
    let total = 0;
    for (const m of members) if (m.category === name) total += unitsOnMember(m.sap);
    return total;
  }

  /** Units on a WHOLE member, summed across its options — the member badge. */
  function unitsOnMember(member: string): number {
    const byOpt = matrix[member];
    if (!byOpt) return 0;
    let total = 0;
    for (const opt of Object.keys(byOpt)) total += unitsIn(byOpt[opt]);
    return total;
  }

  /**
   * 🔴 EVERY OPTION CARRYING A QUANTITY, AS ITS OWN CART LINE — in every mode.
   *
   * Resolved against the whole pool rather than the visible tiles, so an option
   * set and then scrolled past or filtered out by the rail search still
   * commits. Falls back to the tile's own lists for a product whose pools were
   * not passed, and to noOptionRow for the nine that have no options at all.
   */
  const rowFor = (memberKey: string, key: string): ApiProduct | null => {
    const m = members.find((x) => x.sap === memberKey);
    if (!m) return null;
    if (key === "") return m.resolved.noOptionRow;
    const inPool = m.pools.all.find((o) => o.value === key);
    if (inPool) return inPool.row;
    const all = [...m.resolved.bases, ...m.resolved.shades, ...m.resolved.variants];
    return all.find((o) => o.value === key)?.row ?? null;
  };
  /**
   * 🔴 THE WHOLE TILE, ACROSS EVERY MEMBER — not the member on screen.
   *
   * The page replaces a tile's lines by TILE KEY, so anything this leaves out
   * is deleted. Returning only the current member's picks would wipe the
   * salesman's work on every other product in the tile the moment he touched
   * one of them, and he would not see it happen: the drawer would close, the
   * cart would be one line lighter, and nothing on screen would say why.
   *
   * Each pick carries its OWN member's row, which is what lets the page set
   * label and product/baseColour/subProduct from the row rather than from
   * whatever the drawer happened to be showing.
   */
  const picks = Object.keys(matrix).flatMap((memberKey) =>
    Object.entries(matrix[memberKey] ?? {}).map(([key, packs]) => ({
      // 🔴 A PINNED MEMBER HAS NO OPTION LEVEL BUT ITS LINE STILL HAS A COLOUR.
      // Returning null here would store a Wood Primer line with option null:
      // the review screen would print no colour, and existingFor would hand the
      // next visit two indistinguishable lines for seatOf to place — White and
      // Pink collapsing into one seat. The pin IS the option, so it is what the
      // pick carries. (The wire does not read it either way: addLines takes
      // product / baseColour / subProduct off the ROW.)
      option: key === "" ? (members.find((m) => m.sap === memberKey)?.pin ?? null) : key,
      row: rowFor(memberKey, key),
      qtys: Object.fromEntries(Object.entries(packs).filter(([, q]) => q > 0)),
    })))
    .filter((p): p is { option: string | null; row: ApiProduct; qtys: Record<string, number> } =>
      p.row !== null && Object.keys(p.qtys).length > 0);
  const visitUnits = picks.reduce((sum, p) => sum + unitsIn(p.qtys), 0);

  // ── Footer gating ────────────────────────────────────────────────────────
  //
  // 🔴 THE ONLY THING LEFT TO GATE ON IS A QUANTITY. There used to be two more
  // guards here, `needsVariant` and `needsShade`, which held Add closed until
  // an option was picked, and put a nag on the button instead of a quantity.
  // Both are gone because neither can fire any more: every drawer
  // now opens with the top-ranked option of its opening group selected, and
  // switchTab re-applies that, so `selected` is null only for a product that
  // has no options at all — and that product has a noOptionRow, which resolves
  // selectedRow on its own.
  //
  // (`needsShade` was also once a live BUG worth remembering: it did not test
  // that the product HAS shades, so the nine no-option sellers — Cement SB,
  // Zinc Yellow, Red Oxide, Ext Acrylic, Damp 2in1, Roof Coat, Crack 5mm,
  // Damp Base, Thinner — demanded a shade from a column never rendered for
  // them, and were unorderable. Deleting the guard retires that class of bug
  // rather than fixing it a second time.)
  // 🔴 THE BUTTON TOTALS THE WHOLE VISIT, not the option on screen. Two bases
  // of Stay Bright reads "Add · 18 units", not the 12 of whichever tile happens
  // to be selected — otherwise the total contradicts what is about to be sent.
  const canAdd = picks.length > 0;
  const addLabel = canAdd
    ? `${existing && existing.length > 0 ? "Update" : "Add"} · ${visitUnits} units`
    : "Add to order";

  // Sub-line: in FLAT the pack size, stated once so it is never ambiguous.
  // Everywhere else the family — the OPTION's name is no longer repeated here,
  // because the name bar above the packs now carries it at full size.
  const selectionLine = matrixMode ? flatPack : null;

  const footer = (
    <>
      <button
        type="button" onClick={onClose}
        className="shrink-0 rounded-[13px] px-5 py-3 text-[15px] font-extrabold"
        style={{ border: `1.5px solid ${RULE}`, color: INK }}
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={!canAdd}
        // Every mode sends the same shape: one pick per option with a quantity.
        onClick={() => { if (canAdd) onAdd(picks); }}
        className="min-w-0 flex-1 truncate rounded-[13px] py-3 text-[15px] font-extrabold text-white"
        style={{ background: canAdd ? BRAND : FAINT }}
      >
        {addLabel}
      </button>
    </>
  );

  const packList = (
    <PackList
      labels={packLabels}
      // The SELECTED ROW's own key, the same expression v1 uses at
      // app/po/po-page.tsx:502. Taken from the row rather than from `cur`
      // because a pinned member's `cur.sap` is a composite; the row is the
      // catalog record and cannot be anything but right.
      productKey={selectedRow ? selectedRow.product ?? selectedRow.subProduct : null}
      qtys={qtys}
      onStep={(label, dir) => stepCell(cur.sap, optionKey, label, dir)}
      onType={(label, next) => typeCell(cur.sap, optionKey, label, next)}
    />
  );

  /**
   * 🔴 WHAT THE BODY IS, ASKED ONCE. A FLAT product renders every option with
   * its own stepper; everything else renders the selected option's packs. It is
   * the same answer with or without a rail beside it, which is why Velvetino —
   * flat, and one of four products on a rail-products tile — gets its GOLD and
   * SILVER rows in the pane instead of falling through to a single-option pack
   * list that could not reach them.
   */
  const paneBody = matrixMode ? (
    <FlatBody options={options} pack={flatPack} matrix={matrix[cur.sap] ?? {}}
              onStep={(o, p, d) => stepCell(cur.sap, o, p, d)}
              onType={(o, p, u) => typeCell(cur.sap, o, p, u)} />
  ) : packList;

  return (
    <V2Sheet onClose={onClose} footer={footer} fixedHeight>
        {/* ── HEADER ────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start gap-3 px-4 pt-1.5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
              {tile ? tile.label : product.label}
            </h2>
            {selectionLine ? (
              <p className="truncate text-[11.5px] font-extrabold uppercase"
                 style={{ color: VIOLET, letterSpacing: ".06em" }}>
                {selectionLine}
              </p>
            ) : (
              <p className="truncate text-[11.5px]" style={{ color: MUTED }}>{cur.resolved.family}</p>
            )}
          </div>
          {/* The magnifier sits with Close because they are the two things
              that are always available and never about the product. It only
              appears when there is a rail to search. */}
          {showRail && !searchOpen && (
            <button
              type="button" aria-label="Search this product's colours"
              onClick={() => setSearchOpen(true)}
              className="flex shrink-0 items-center justify-center rounded-full"
              style={{ width: 30, height: 30, background: FILL }}
            >
              <Search className="h-4 w-4" strokeWidth={2.5} style={{ color: MUTED }} />
            </button>
          )}
          <button
            type="button" aria-label="Close" onClick={onClose}
            className="flex shrink-0 items-center justify-center rounded-full"
            style={{ width: 30, height: 30, background: FILL }}
          >
            <X className="h-4 w-4" strokeWidth={2.5} style={{ color: MUTED }} />
          </button>
        </div>

        {/* ── THE PRODUCT STRIP ─────────────────────────────────────────────
            🔴 ONLY IN THE strip-products LAYOUT. A single-product tile renders
            nothing here, and the seven rail-products tiles put their members in
            the rail instead — showing the same list in both places would be
            saying one thing twice on a 390px screen.

            🔴 IT HAS ITS OWN ZONE NOW. It used to float on the same white as
            the title with nothing between them, so the chips read as part of
            the heading rather than as the control that changes the rest of the
            sheet. A ground and a rule above and below — FILL and RULE, both
            already in this file — say "the thing above is a heading, this is a
            picker". No token is invented and nothing in the header moves.

            ⚠ overflow-x IS DELIBERATE AND IS NOT THE BANNED KIND. The standing
            rule is that the PAGE must never drag sideways at 390px, and it does
            not: this is a contained scroller with its own bounds, the way a
            carousel is. Sixteen products cannot wrap and must not be cut. */}
        {/* ── THE CATEGORY CHIPS ─────────────────────────────────────────
            🔴 A ROW OF WORDS, NOT A ROW OF TILES. A category is not a product
            and must not be dressed as one: a 56px square on a family wash would
            say "here is a tin of Sealer", and there is no such tin. It is a
            filter, so it gets a filter's shape — a segmented pill, 44px tall to
            clear CLAUDE_UI §60's tap floor, on the same FILL ground and between
            the same two rules the product strip uses, so the ZONE reads the
            same even though its contents do not.

            The badge counts the whole category, so a man who has put six of
            something under "Other" can see it without opening the chip. */}
        {layout === "category-products" && (
          <PickerZone py={8} gap={8} collapsed={compact}>
            {categories.map((c) => (
              <FilterChip
                key={c}
                label={c}
                selected={c === activeCategory}
                carrying={unitsInCategory(c)}
                onSelect={() => selectCategory(c)}
              />
            ))}
          </PickerZone>
        )}

        {/* ── BASE / SHADE ───────────────────────────────────────────────
            🔴 THE SAME ZONE AND THE SAME CHIP AS THE CATEGORIES ABOVE, on the
            two named products that keep the split. It is a filter over the
            rail, drawn where every other filter over the rail is drawn.

            `carrying` is 0 deliberately: the stacked toggle it replaces
            carried no count either, and a group badge is a behaviour change,
            not a restyle. */}
        {showGroupChips && (
          <PickerZone py={8} gap={8} collapsed={compact}>
            <FilterChip label="Base"  selected={tab === "base"}
                        carrying={0} onSelect={() => switchTab("base")} />
            <FilterChip label="Shade" selected={tab === "shade"}
                        carrying={0} onSelect={() => switchTab("shade")} />
          </PickerZone>
        )}

        {layout === "strip-products" && (
          <PickerZone py={10} gap={STRIP_GAP} collapsed={compact}>
            {members.map((m) => (
                <BigTile
                  key={m.sap}
                  label={m.label}
                  cell={STRIP_CELL} square={STRIP_TILE} lines={2}
                  // 🔴 THE MEMBER'S OWN TIN, never the tile's. A tile-art
                  // fallback here would put one Powerflexx tub on all nine
                  // products in the strip — which is exactly the bug the cart
                  // has been shipping. No photo means the family wash, the
                  // same thing the board shows for art that has not arrived.
                  badge={null} fill={undefined} image={memberImage(m.sap)} wash={wash}
                  selected={m.sap === cur.sap}
                  carrying={unitsOnMember(m.sap)}
                  onSelect={() => selectMember(m.sap)}
                />
              ))}
          </PickerZone>
        )}

        {/* 🔴 THE PANE'S BODY IS THE SAME QUESTION IN BOTH BRANCHES — flat, or
            the selected option's packs — so it is asked once, in `paneBody`,
            and the branch here is only about whether a rail stands beside it.
            It used to be a three-way with the flat arm FIRST, which is what
            once made Velvetino's GOLD and SILVER unreachable. */}
        {!showRail ? (
          // NOTHING TO CHOOSE — no options at all, or a flat product whose
          // options are already every row of the body. The packs get the whole
          // sheet. Not a new code path: it is what falls out of having no
          // options, and it is the same branch whether the product arrived
          // alone or as one member of a tile.
          paneBody
        ) : (
        <>
          {/* ── THE SEARCH, ONLY WHEN ASKED FOR ──────────────────────────
              Full width when it is open, because a field you have deliberately
              opened should be the widest thing on the row.

              🔴 IT DOES NOT FOCUS ITSELF ON A PHONE. This used to carry a bare
              `autoFocus`, and the comment here argued that tapping a magnifier
              is a request to type. On a desk that is true and it still focuses.
              On a phone it is what SPRANG THE KEYBOARD, which halves the
              viewport, which is the entry condition for every symptom of the
              drawer's keyboard defect — the footer riding up over the pack
              rows. §55 settles it: mount auto-focus is desktop-only, and the
              cost on a phone is one extra tap on a field that is already the
              widest thing on the row and impossible to miss.

              ⚠ THE QUANTITY INPUT'S OWN autoFocus (PackRow, near the foot of
              this file) IS NOT THIS AND STAYS. It mounts only after a tap has
              already set `editing`, so it is the tap-to-edit swap, not a mount
              focus; gating it would mean tapping a number and getting no
              keyboard. §55's rule names "mount / mode-transition" focus, which
              is this field, not that one. */}
          {searchOpen && (
            <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3"
                   style={{ background: SEARCH_BG }}>
                <Search className="h-4 w-4 shrink-0" strokeWidth={2.5} style={{ color: FAINT }} />
                <input
                  type="text" inputMode="search" autoComplete="off"
                  autoFocus={autoFocusAllowed()}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={railHoldsProducts ? "Find a product"
                    : rails.hasVariants ? "Find"
                    : showGroupChips ? (tab === "shade" ? "Find a shade" : "Find a base")
                    // ONE combined column, so neither word is the whole truth.
                    : "Find a colour"}
                  aria-label="Filter the rail"
                  // 16px, or Safari zooms the page on focus.
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] outline-none placeholder:text-[#9C99AC]"
                  style={{ color: INK }}
                />
              </div>
              <button
                type="button" aria-label="Close the search" onClick={closeSearch}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: FILL }}
              >
                <X className="h-4 w-4" strokeWidth={2.5} style={{ color: MUTED }} />
              </button>
            </div>
          )}

          {query.trim().length > 0 && (railHoldsProducts ? shownMembers : shown).length === 0 && (
            <p className="shrink-0 px-4 pb-2.5 text-[12.5px]" style={{ color: MUTED }}>
              Nothing in this list matches {query.trim()}
            </p>
          )}

          <div className="flex min-h-0 flex-1">
            {/* ── THE RAIL ──────────────────────────────────────────────────
                ONE column, 104px wide: an 88px cell with an 8px gutter either
                side, holding a 60px square that centres with 14px to spare —
                enough for the selected ring (4px) and for the count badge,
                which now rides INSIDE the square's top-right corner instead of
                hanging off it. Nothing overflows, so there is still no
                overflow-x anywhere in this component. */}
            <div
              className="shrink-0 overflow-y-auto"
              style={{
                width: RAIL_W, borderRight: `1px solid ${RULE}`,
                // 8px of gutter each side, so the column's CONTENT box is
                // exactly RAIL_CELL. Everything inside — the tiles and the
                // toggle's w-full — is then the same 88px wide, and the tile's
                // 4px selected ring has 14px of clearance either way. Tailwind
                // sets border-box, so this is inside the 104, not added to it.
                paddingLeft: (RAIL_W - RAIL_CELL) / 2,
                paddingRight: (RAIL_W - RAIL_CELL) / 2,
                paddingTop: 10,
                paddingBottom: "calc(28px + env(safe-area-inset-bottom))",
              }}
            >
              <div className="flex flex-col items-center" style={{ gap: TILE_GAP }}>
                {/* 🔴 THE BASE / SHADE CONTROL IS NO LONGER IN HERE. It was a
                    stacked segmented toggle at the top of this column — see
                    showGroupChips. It is now a chip row in the picker zone
                    above, drawn with the same FilterChip the category tile
                    uses, so the rail holds nothing but the things it lists. */}
                {railHoldsProducts
                  ? shownMembers.map((m) => (
                      <BigTile
                        key={m.sap}
                        label={m.label}
                        cell={RAIL_CELL} square={RAIL_TILE} lines={3}
                        // Same rule as the strip: this product's own tin or
                        // nothing. Crack Fillers and Roof Coats are the two
                        // places several members legitimately share one photo,
                        // and that sharing lives in v2-data's member slugs —
                        // not in a fallback here that would hide the others.
                        badge={null} fill={undefined} image={memberImage(m.sap)} wash={wash}
                        selected={m.sap === cur.sap}
                        carrying={unitsOnMember(m.sap)}
                        onSelect={() => selectMember(m.sap)}
                      />
                    ))
                  : shown.map((opt) => (
                      <BigTile
                        key={opt.value}
                        label={opt.value}
                        cell={RAIL_CELL} square={RAIL_TILE} lines={3}
                        // 🔴 A SHADE IS ITS OWN PICTURE. A BASE IS NOT — a
                        // tinting base's colour is not the colour of the paint
                        // that comes out of it, which is why BRILLIANT WHITE
                        // standing among 90/92/93/94 stopped being a near-white
                        // square. A base draws its SHORT form large inside the
                        // square (BW, 90, GREEN) with its full name underneath,
                        // so the sequence keeps the shape that makes it
                        // scannable and the option is still spelled out.
                        // Scoped by isBaseOption, so BRILLIANT WHITE keeps its
                        // swatch on the products where it is a finished SHADE.
                        badge={isBaseOption(opt.value) ? baseChipLabel(opt.value) : null}
                        // 🔴 A NUMBERED BASE NEEDS NO CAPTION. The square
                        // already says 90 in 24px; "90 BASE" underneath adds
                        // one word, and that word is true of every tile in the
                        // column. Six of them stacked up read as a paragraph
                        // where the point was a sequence.
                        //
                        // It is scoped to NUMBERS and nothing else, because a
                        // number is the only short form that says the whole
                        // name. BW does not — BRILLIANT WHITE keeps its
                        // caption — and neither does a NAMED base: PASTEL,
                        // GREEN, METAL and BASECOAT all keep theirs, because
                        // "PASTEL" alone reads as a colour and the word BASE
                        // is what says it is not one.
                        hideLabel={numberedBase(opt.value)}
                        fill={isBaseOption(opt.value) ? undefined : shadeHex(opt.value)}
                        image={variantImage(cur.sap, opt.value)}
                        wash={wash}
                        selected={selected === opt.value}
                        carrying={unitsOn(cur.sap, opt.value)}
                        onSelect={() => selectOption(opt.value)}
                      />
                    ))}
              </div>
            </div>

            {/* ── THE PANE ────────────────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* THE NAME BAR SAYS WHAT THE PACKS BELOW IT BELONG TO, and that
                  is the whole rule. It is the check against a wrong tap, at
                  full size, directly above the quantity.

                  🔴 WHICH MEANS IT DEPENDS ON WHAT THE PANE IS SHOWING, AND
                  UNTIL NOW IT DID NOT ASK. It named the selected option
                  whenever there was one — correct for a STANDARD product,
                  where the pane shows exactly that one option's packs, and a
                  lie for a FLAT one, where the pane is FlatBody and renders
                  EVERY option with its own stepper. Naming one of them there
                  picks a winner out of a list the salesman is looking at.

                  The symptom that found it was Velvetino: a Luxury Finish
                  product whose two options are GOLD and SILVER, headed "GOLD"
                  where its own name belongs. It was never about Velvetino.
                  Walking the live catalogue found SIX flat members reading a
                  shade or a base instead of a product name — M900 Gloss and
                  Spray Paint as "BRILLIANT WHITE", Machine Tinter as "YOX",
                  Acotone as "NO1", GVA as "RED OXIDE" and Velvetino as "GOLD".
                  One rule, six screens, so the rule is what changed.

                  ⚠ THE OTHER 37 ARE CORRECT AND MUST STAY THAT WAY. A standard
                  product's pane really does show one option's packs, so naming
                  it is the guarantee, not a bug. Do not "simplify" this to
                  always show cur.label.

                  The hex swatch follows the same test: no single option is
                  selected in flat mode, so there is no colour to show. */}
              <NameBar
                value={!matrixMode && selectedOption ? selectedOption.value : cur.label}
                hex={!matrixMode && selectedOption && !isBaseOption(selectedOption.value)
                  ? shadeHex(selectedOption.value) : undefined}
              />
              {/* No empty state. selectedRow is resolved on the first frame for
                  every one of the 36 tiles — by the pre-selection above, or by
                  noOptionRow for the products that have no options — so the
                  pack rows are on screen before the sheet finishes sliding up. */}
              {paneBody}
            </div>
          </div>
        </>
        )}
    </V2Sheet>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/**
 * THE PICKER ZONE — the band between the header and the rail, wherever
 * something above the rail changes what the rail holds.
 *
 * A ground and a rule above and below say "the thing above is a heading, this
 * is a picker". Three things use it now — the category chips, the Base / Shade
 * chips and the product strip — and they used to be three copies of the same
 * six style properties. Three copies is how one of them ends up a point darker
 * than the other two.
 *
 * ⚠ overflow-x IS DELIBERATE AND IS NOT THE BANNED KIND. The standing rule is
 * that the PAGE must never drag sideways at 390px, and it does not: this is a
 * contained scroller with its own bounds, the way a carousel is. Sixteen
 * products cannot wrap and must not be cut.
 */
function PickerZone({ py, gap, collapsed = false, children }: {
  py: number; gap: number;
  /**
   * 🔴 display:none, NOT AN UNMOUNT, AND THAT IS THE WHOLE POINT.
   *
   * A collapsed zone takes zero height — which is what makes the drawer fit —
   * but stays in the DOM, so coming back is instant and costs no re-render of
   * sixteen tiles. Unmounting would also throw away the strip's horizontal
   * SCROLL POSITION, and a man who had scrolled to the ninth product would be
   * put back at the first every time he opened the keyboard.
   *
   * ⚠ THE SELECTED CHIP IS SAFE EITHER WAY — it derives from `cur`, which is
   * React state and lives above this component. The scroll offset is the part
   * that needs the DOM node kept, and browsers preserve scrollLeft across a
   * display:none far more reliably than across an unmount, though it is not
   * guaranteed by spec. If a phone is ever seen resetting it, the fix is
   * visibility/height rather than a scroll-position ref.
   */
  collapsed?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="shrink-0 overflow-x-auto"
      style={{
        display: collapsed ? "none" : undefined,
        WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
        background: FILL,
        borderTop: `1px solid ${RULE}`,
        borderBottom: `1px solid ${RULE}`,
      }}
    >
      <div className="flex px-4" style={{ gap, paddingTop: py, paddingBottom: py }}>
        {children}
      </div>
    </div>
  );
}

/**
 * ONE FILTER CHIP — a word, a count, and a state. Deliberately NOT a BigTile.
 *
 * A category has no photograph and never will, so giving it the product tile's
 * 60px square would be an empty frame promising art that cannot arrive. It is a
 * filter over the rail, so it is drawn like one: a pill, violet when it is the
 * open one, 44px tall for CLAUDE_UI §60.
 *
 * 🔴 IT IS NOW BOTH FILTERS IN THIS DRAWER, WHICH IS WHY IT IS NO LONGER CALLED
 * CategoryChip. Base / Shade is the same object one level down — a filter over
 * the list in the rail — and it used to be drawn by GroupButton as a stacked
 * segmented toggle, because it lived inside an 88px column. Two components
 * drawing one control is how "selected" comes to mean two different things on
 * one sheet.
 *
 * WHAT SHARING IT COST: the rename, and nothing else. Both call sites already
 * wanted a label, a selected flag and an onSelect, and `carrying` was already
 * optional in behaviour — the badge only renders above zero, and the group
 * chips pass 0, which is exactly what the toggle showed. No prop was added and
 * no branch was taken inside the component.
 */
function FilterChip({ label, selected, carrying, onSelect }: {
  label: string; selected: boolean; carrying: number; onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={carrying > 0 ? `${label}, ${carrying} units` : label}
      onClick={onSelect}
      className="flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px]"
      style={{
        background: selected ? VIOLET : "#FFFFFF",
        color: selected ? "#FFFFFF" : INK,
        fontWeight: selected ? 700 : 500,
        border: selected ? "none" : `1px solid ${RULE}`,
      }}
    >
      {label}
      {carrying > 0 && (
        <span
          className="flex items-center justify-center rounded-full text-[10px] font-extrabold"
          style={{
            minWidth: 18, height: 18, padding: "0 5px",
            background: selected ? "rgba(255,255,255,.25)" : VIOLET,
            color: "#FFFFFF",
          }}
        >
          {carrying}
        </span>
      )}
    </button>
  );
}


// 🔴 GroupButton IS GONE, 2026-09-08. It was one half of the stacked Base /
// Shade toggle at the top of the rail — a segmented control shaped by the 88px
// column it had to fit inside, stacked vertically because side by side its two
// halves would have been 41px wide. Base and Shade are a filter over the list
// below them, which is precisely what a category chip is, so they are now
// FilterChips in the picker zone. One control, one appearance. Nothing else in
// the file drew a toggle, so no toggle survives anywhere.

/**
 * ONE TILE — in the strip or in the rail, for a product, a base or a shade.
 *
 * 🔴 ONE COMPONENT, BECAUSE THEY WERE ALWAYS ONE OBJECT. A square, a name under
 * it, a violet ring when it is chosen and a violet count when it is carrying
 * units. It used to be two components drawing two different things at two
 * different sizes, and the rail's version trapped the word INSIDE the square,
 * at 8.5px, clipped. Merging them is what let the rail's tile grow to the size
 * the strip's already was, and it is what makes "selected" look like one thing
 * everywhere in this drawer.
 *
 * THE SQUARE, in precedence order:
 *   image   a real tin photo — the five Smart Choice variants today, and every
 *           member the day the product photos arrive
 *   fill    a SHADE's own colour, which is the thing it actually is
 *   badge   a BASE's short form (BW, 90, GREEN) set large, because a tinting
 *           base has no colour worth showing and its number IS its identity
 *   wash    the family tint — the board's own treatment for art that has not
 *           arrived, which a salesman has already seen on the board
 *
 * 🔴 THE NAME IS ALWAYS UNDER IT, ALWAYS IN FULL. Even under a badge: the
 * square says "90" and the line beneath says "90 BASE", so the sequence keeps
 * the shape that makes it scannable without the option going unnamed.
 *
 * WHEN THE MEMBER PHOTOS ARRIVE this is a drop-in — pass `image` and nothing
 * about the layout moves, because the square is a fixed size and the name lives
 * in its own cell below rather than inside it.
 */
function BigTile({ label, cell, square, lines, badge, hideLabel = false, fill, image, wash,
                   selected, carrying, onSelect }: {
  label: string; cell: number; square: number; lines: number;
  badge: string | null;
  /** The square already says the whole name — see numberedBase(). */
  hideLabel?: boolean;
  fill?: string; image: string | null; wash: string;
  selected: boolean; carrying: number; onSelect: () => void;
}): React.JSX.Element {
  const light = fill !== undefined && isLightHex(fill);
  // One rule, read back from the resolved path — see isCutout in v2-data.
  const cut = isCutout(image);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={carrying > 0 ? `${label}, ${carrying} units` : label}
      title={label}
      onClick={onSelect}
      className="flex shrink-0 flex-col items-center gap-1"
      style={{ width: cell }}
    >
      <span
        className={`relative flex items-center justify-center${cut ? "" : " overflow-hidden"}`}
        style={{
          width: square, height: square, borderRadius: 14,
          // 🔴 A CUT-OUT GETS NO SQUARE, exactly as on the board. Same single
          // rule (TRANSPARENT_ART -> artPath -> /PO/), read back through
          // isCutout, so the rail and the board cannot disagree about a tile.
          // A member with OPAQUE art keeps its wash and a member with NO art
          // keeps its plain wash or its colour fill — both untouched.
          background: cut ? undefined : (image ? wash : fill ?? (selected ? VIOLET_BG : wash)),
          // A near-white fill gets a faint inner border, or a white square on a
          // white sheet is simply not there. A picture sits on the family wash
          // and needs no edge — the tin draws its own.
          border: !image && light ? "1px solid rgba(0,0,0,.15)" : "none",
          // THE RING, WITH A WHITE GAP. The gap is what makes it read on a dark
          // colour: violet straight against #1D1E1F is an edge nobody sees.
          // It stays on a cut-out: with no square behind it, the ring is the
          // ONLY thing left saying which product is selected.
          boxShadow: selected ? `0 0 0 2px #FFFFFF, 0 0 0 4px ${VIOLET}` : undefined,
        }}
      >
        {image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={image} alt="" width={600} height={600}
            decoding="async" loading="lazy" className="block h-full w-full"
            style={{
              objectFit: "contain",
              // MULTIPLY for an OPAQUE file: it is a white square, so painted
              // normally it would cover the family wash and every tile would
              // be a white box. A CUT-OUT has no white ground to drop out, so
              // multiply would only darken the tin against the sheet.
              mixBlendMode: cut ? undefined : "multiply",
              // Scaled for a 60px cell, not copied from the board's 79px one —
              // see CUTOUT_SHADOW_RAIL.
              filter: cut ? CUTOUT_SHADOW_RAIL : undefined,
            }}
          />
        ) : badge ? (
          <span
            // 🔴 600, NOT 800 — CLAUDE_UI §60. "Weight, not colour, is the
            // heavy dial", and nothing on a card is 700. This glyph is a LABEL
            // ON A PLACEHOLDER, not a heading: at 800 with negative tracking it
            // came out as the loudest thing on the sheet, six black slabs
            // shouting over the product name they were supposed to sit under.
            // The SIZE is right — a 24px "90" is the tile's content and has to
            // read across a column — so the weight is what comes down, and the
            // negative tracking goes with it for the same reason (§60 says
            // remove tracking before touching colour). Colour stays INK: this
            // is the only thing identifying the option inside the square.
            className="font-semibold"
            style={{
              color: INK, lineHeight: 1,
              // Two characters is the common case (BW, 90) and gets the whole
              // square; GREEN and PASTEL step down rather than clip.
              fontSize: badge.length <= 2 ? 24 : badge.length <= 4 ? 19 : badge.length <= 6 ? 14 : 11,
            }}
          >
            {badge}
          </span>
        ) : null}
        {carrying > 0 && (
          <span className="pointer-events-none absolute" style={{ top: 3, right: 3 }}>
            <ChipCount units={carrying} />
          </span>
        )}
      </span>
      {/* aria-label and title above still carry the full name, so hiding the
          caption takes nothing away from anyone who cannot read the glyph. */}
      {!hideLabel && <TileName label={label} lines={lines} selected={selected} />}
    </button>
  );
}

/**
 * The name under a tile — ONE SIZE, centred, on a fixed two-line block.
 *
 * 🔴 v2 TILE LABEL: CENTRED · ONE SIZE · FIXED 2-LINE BLOCK.
 * Applies to every image-with-label grid in v2. Owner ruling 2026-09-09.
 * The other grid is the BOARD in po-v2-page.tsx; keep the two in step.
 *
 * ── WHAT WAS HERE, AND WHY IT WENT ────────────────────────────────────────
 * A three-step ramp sized the label to its longest WORD: 11px up to eight
 * characters, 10px to eleven, 9px beyond. It is why neither grid ever looked
 * uniform — alignment alone could not fix that while neighbouring tiles set
 * their names at different sizes.
 *
 * 🔴 AND THE RAMP'S TEST WAS WRONG ON ITS OWN TERMS. It counted CHARACTERS and
 * assumed every label was uppercase. Catalog options are, but MEMBER names are
 * ordinary mixed case, and lowercase runs about 20% narrower per character —
 * so "Pretreatment Coat" was shrunk to the bottom step for a width it never
 * had. Do not build a new heuristic on character count.
 *
 * ── ONE SIZE, AND WHY 11 AND NOT 9 ────────────────────────────────────────
 * 9px shipped for exactly one commit (5e3319de) under a rule that read "if the
 * longest label needs 9px, 9px is the size for all". That rule was withdrawn
 * the same day: it shrank 198 of 221 labels to accommodate ONE defective
 * catalog string.
 *
 * 🔴 THE BLOCK IS WHERE A LONG NAME GOES. It is two lines tall precisely so a
 * name has somewhere to wrap into; shrinking the whole grid to keep every name
 * on one line defeats the thing that was built to solve it.
 *
 * Measured at 11px against the cell each label actually reaches (2026-09-09,
 * live catalog, all 221 labels), exactly two want a third line:
 *
 *   ORGANIC MIDDLE YELLOW   GVA, rail 88px — clamp is 3 there, so it renders
 *   Promise Sheen Exterior  Promise Sheen, strip 72px — clamp is 2. BORDERLINE
 *                           at ~117px, and if it does cut it reads "Promise /
 *                           Sheen", which is its SIBLING's name too. Watch it.
 *
 * ⚠ FASTYELLOWGREEN IS A DATA DEFECT, NOT A PRODUCT NAME. Its nine siblings on
 * Universal Stainer are all spaced — FAST YELLOW, FAST GREEN, FAST BLUE, FAST
 * VIOLET, FAST RED, FAST ORANGE — and only row 21700 runs together. As one
 * unbreakable 15-character run it is ~111px against an 88px cell, which is why
 * overflowWrap below is "anywhere". It will break mid-word and look wrong. That
 * is correct and temporary: the fix is a string correction, logged on ROADMAP,
 * and it is SEED-OWNED so a live SQL edit alone would be reverted by the next
 * reseed. Do NOT special-case the string in code.
 *
 * ── WHAT DID NOT CHANGE ───────────────────────────────────────────────────
 * THE WORD NEVER BREAKS — the board's own rule. A name too long for its lines
 * clips rather than hyphenating, which is the lesser wrong at this size, and it
 * cannot cost an order: the NAME BAR above the packs carries the full name the
 * instant the tile is tapped.
 *
 * THREE LINES IN THE RAIL, TWO IN THE STRIP. A vertical column can spend a
 * line; a horizontal row would have to give that height to every tile in it.
 * The third line is what lets "Epoxy Insulator Hardener" read whole. The CLAMP
 * is untouched — only the block's minimum height is new.
 *
 * 🔴 minHeight IS IN em, NOT PIXELS. 2 lines x the 1.2 line-height below =
 * 2.4em, so the block is two lines whatever the font size is. In px it would
 * silently become the wrong height the first time the size changed, which is
 * the exact fault this ruling exists to remove. min-height and not height,
 * because a rail label that legitimately runs to three lines must be allowed
 * to, rather than be cut through the middle of the third.
 */
function TileName({ label, lines, selected }: {
  label: string; lines: number; selected: boolean;
}): React.JSX.Element {
  return (
    <span
      className="block w-full text-center"
      style={{
        color: selected ? VIOLET : INK,
        // 🔴 ONE WEIGHT FOR EVERY TILE — the 600/500 selected swap is gone,
        // owner ruling 2026-09-09. Selection is already carried twice over: the
        // violet RING on the square above (BigTile's boxShadow, with a white
        // gap so it reads on a dark colour) and this line turning VIOLET. A
        // third signal on the same state bought nothing and made a selected
        // tile's caption sit at a different width from its neighbours', which
        // is the ragged look the whole ruling was about.
        fontSize: TILE_LABEL_PX, lineHeight: 1.2, fontWeight: 500,
        minHeight: "2.4em",
        display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines,
        overflow: "hidden",
        // 🔴 "anywhere" IS A SAFETY NET, NOT THE WRAP RULE. Words still break at
        // spaces wherever they can; this only lets a single run WIDER THAN THE
        // CELL break mid-word rather than spill out of the tile. Today that is
        // one string, FASTYELLOWGREEN, and it is a data defect (see above).
        // ⚠ The BOARD does NOT carry this — its wrap rules in po-v2-page.tsx
        // are deliberate and its longest word is nine characters, so it has
        // nothing to protect against and a mid-word break there would be a
        // regression, not a net.
        overflowWrap: "anywhere", wordBreak: "normal", hyphens: "none",
      }}
    >
      {label}
    </span>
  );
}

/**
 * 🔴 THE NAME LIVES HERE NOW. It is the check against a wrong tap: the rail is
 * squares, so this line is the only thing that says what is about to be
 * ordered, and it sits directly above the quantity he is about to set.
 *
 * NEVER TRUNCATED. "ORGANIC MIDDLE YELLOW" wraps to two lines rather than
 * becoming "ORGANIC MIDDLE YEL…", for the same reason the review screen never
 * clips a product name in favour of its picture.
 *
 * 🔴 NO PICTURE HERE, EVER — not even for a variant that has one. The tin is
 * already in the rail, two centimetres to the left and still on screen; a
 * second copy of it beside the name is the same information twice and it costs
 * the pane the room this whole step was about.
 *
 * The swatch is passed IN, on exactly the terms the tile drew it — a base gets
 * none, a shade gets shadeHex — so the rail and the bar can never disagree
 * about whether a thing has a colour. A "BW" tile above a white square here
 * would be the drawer contradicting itself on screen.
 */
function NameBar({ value, hex }: { value: string; hex?: string }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2.5 px-4 py-3"
         style={{ borderBottom: `1px solid ${RULE}` }}>
      {hex && (
        <span className="shrink-0" style={{
          width: 22, height: 22, borderRadius: 6, background: hex,
          border: isLightHex(hex) ? "1px solid rgba(0,0,0,.15)" : "none",
        }} />
      )}
      <span className="min-w-0 flex-1 text-[15px] font-bold leading-tight" style={{ color: VIOLET }}>
        {value}
      </span>
    </div>
  );
}

/**
 * The selected option's packs.
 *
 * 🔴 TRAILING SPACE, SO THE LAST ROW CAN CLEAR THE FOOTER. The footer is a flex
 * SIBLING and never overlaps this — but with no room after the final pack row,
 * scrollIntoView({block:"center"}) has nowhere to scroll TO and degenerates
 * into "scroll to the end", leaving the 20L row of a seven-pack product flush
 * against the footer's border. This is the room that lets it centre. See
 * useKeepFocusVisible in v2-sheet.
 */
function PackList({ labels, productKey, qtys, onStep, onType }: {
  labels: string[];
  /**
   * 🔴 COALESCE(product, subProduct) OF THE SELECTED ROW — the only new prop
   * the carton overrides needed. A pack label alone cannot answer "how many in
   * a box" because the depot sells three products loose at a size it sells
   * everything else by the six; that is a fact about the PRODUCT. Null when no
   * row is selected, which falls back to the global table.
   */
  productKey: string | null;
  qtys: Record<string, number>;
  onStep: (label: string, direction: 1 | -1) => void;
  onType: (label: string, units: number) => void;
}): React.JSX.Element {
  return (
    <div
      // gap-2.5 is the separation the rows used to try to get from their own
      // padding. See the PackRow note: space BETWEEN, not a taller row.
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-1"
      style={{ paddingBottom: PACK_TRAILING }}
    >
      {labels.map((label) => (
        <PackRow
          key={label}
          label={label}
          step={stepForLabel(label, productKey)}
          qty={qtys[label] ?? 0}
          onStep={(dir) => onStep(label, dir)}
          onType={(next) => onType(label, next)}
        />
      ))}
    </div>
  );
}

/**
 * One pack row. The "per N" sub-label is HIDDEN when the step is 1 — a drum
 * has no box, so "per 1" would be noise dressed as information. Loose-sold
 * products now lose it correctly too: GVA 1L is step 1 and says nothing, where
 * it used to claim "per 6".
 *
 * 🔴 THE HINT AND THE BUTTONS READ ONE NUMBER. `step` arrives as a single prop
 * and both the caption above and the +/- below it use that prop — there is no
 * second lookup to drift from. The value the caller computes and the value the
 * caller applies also agree by construction: `PackList` derives it from the
 * SELECTED ROW's key and `stepCell` from `cur.joinSap`, and the selected row
 * is one of `cur`'s own rows, so the two expressions are the same string. Keep
 * it that way — a row that says "per 6" and moves by 4 is worse than either.
 *
 * 🔴 A LIST, NOT FOUR BANNERS. This row used to be 16px/800 over a mono
 * caption with 12px of padding above and below — 62px each, so four packs
 * filled a phone. Worse, the label outweighed the PRODUCT NAME above it
 * (15px/700), which is backwards: the name is the hero and the pack is a row
 * in a list. 15px/600 over a 10.5px caption reads as a list and gives the
 * strip its height back.
 *
 * 🔴 THE AIR IS BETWEEN THE ROWS, NOT INSIDE THEM. py-1.5 took the gap between
 * two steppers down to 12px and the list closed up into a block. The fix is
 * NOT to reinflate the padding — that grows every row and costs a row off the
 * bottom of the screen for nothing. The row's own padding comes DOWN to 4px
 * and the separation moves to a 10px gap on the list, so each row is a tighter
 * object with more space around it: 18px between steppers, against 12 before
 * and 24 in the version that read as banners. Same 56px pitch either way, and
 * this way the thing that grew is the whitespace rather than the row.
 *
 * The +/- targets stay 36px. Trimming those to buy space would take a real tap
 * target off a man wearing gloves on a warehouse floor to save eight pixels.
 */
function PackRow({ label, step, qty, onStep, onType }: {
  label: string; step: number; qty: number;
  onStep: (direction: 1 | -1) => void;
  onType: (units: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-tight" style={{ color: INK }}>{label}</p>
        {step > 1 && (
          <p className="text-[10.5px] leading-tight" style={{ color: FAINT }}>per {step}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${RULE}` }}>
        <button
          type="button" aria-label={`Remove one box of ${label}`}
          disabled={qty === 0} onClick={() => onStep(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-30"
        >
          <Minus className="h-4 w-4" strokeWidth={3} style={{ color: INK }} />
        </button>
        <QtyField qty={qty} label={label} onCommit={onType} />
        <button
          type="button" aria-label={`Add one box of ${label}`} onClick={() => onStep(1)}
          className="flex h-9 w-9 items-center justify-center rounded-full"
        >
          <Plus className="h-4 w-4" strokeWidth={3} style={{ color: INK }} />
        </button>
      </div>
    </div>
  );
}

/**
 * The figure between − and +, which is also an INPUT. Tap it and type.
 *
 * Forty lines built two at a time is forty taps of +; a man ordering ten of
 * something should be able to say ten. Tapping the number swaps it for a field,
 * and the field is the same size and in the same place, so nothing moves.
 *
 * 🔴 inputMode="numeric" + pattern="[0-9]*" ON A type="text" FIELD. Not
 * a numeric input TYPE: on mobile that brings spinners nobody can hit, a locale
 * decimal separator this app has no use for, and a keypad that still offers
 * "e" and "-". The two attributes above are what actually gets iOS to show the
 * plain digit pad, and text keeps the value a string we control.
 *
 * 16px, because Safari zooms the whole page on focus for anything smaller and
 * the salesman then has to pinch back out mid-order.
 *
 * 🔴 A TYPED FIGURE IS STORED AS TYPED. NO SNAPPING — owner ruling 2026-09-09.
 *
 * This field used to round the number to a whole box on blur, so 9 on a
 * six-per pack became 12. The reasoning was that the depot cannot pick part of
 * a carton; the depot's answer is that it can, and being unable to ask for
 * nine was the worse problem. v1 has always worked this way
 * (`app/po/po-page.tsx:1723`, setPackRaw) and v2 now matches it exactly:
 *
 *   any non-negative integer is legal — 9 stays 9
 *   0 clears the line
 *   empty, or anything non-numeric, commits 0 — NOT the previous value
 *
 * That last line is the one that changed twice over. v1 does
 * `parseInt(raw, 10)` and falls back to 0 when the result is not a finite
 * non-negative number, so clearing the field in v1 clears the cell. v2 used to
 * restore the old figure instead, which meant a man who deleted a quantity and
 * looked away got it back. Matching v1 is what makes "0 clears the line" true
 * by the same route on both pages.
 *
 * STEP NO LONGER REACHES THIS FUNCTION AT ALL — it drives +/- and the "per N"
 * sub-label, nothing else. A quantity that is not a whole box simply shows no
 * box hint, exactly as on v1.
 */
function QtyField({ qty, label, onCommit }: {
  qty: number; label: string; onCommit: (units: number) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Blur fires after Enter's own blur() call too; this stops the commit
  // running twice.
  const committed = useRef(false);

  function commit(): void {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    // v1's setPackRaw, byte for byte: parse, and anything that is not a finite
    // non-negative integer is 0. Never NaN, and never the old value.
    const parsed = parseInt(draft.trim(), 10);
    const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    if (next !== qty) onCommit(next);
  }

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Quantity for ${label}, ${qty} units. Tap to type.`}
        onClick={() => { setDraft(qty === 0 ? "" : String(qty)); committed.current = false; setEditing(true); }}
        className="w-11 text-center font-mono text-[16px] font-extrabold tabular-nums"
        style={{ color: qty === 0 ? FAINT : INK }}
      >
        {qty}
      </button>
    );
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      autoFocus
      aria-label={`Quantity for ${label}, in units`}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className="w-11 bg-transparent text-center font-mono text-[16px] font-extrabold tabular-nums outline-none"
      style={{ color: INK }}
    />
  );
}

/**
 * The units an option is holding. Small, violet, and only ever present when the
 * number is real — a "0" badge on every tile would be noise on thirty-two.
 *
 * 🔴 IT IS NOT DECORATION — it is the only proof that quantities survive a tile
 * tap. Set BLACK, tap 90 BASE, and BLACK's badge is still showing its units:
 * without it a salesman has no way to know the first option is still in the
 * visit, and he will not trust it enough to use it. Violet, because it is a
 * count of HIS work.
 */
function ChipCount({ units }: { units: number }): React.JSX.Element {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
      style={{ minWidth: 17, height: 17, padding: "0 5px", background: VIOLET }}
    >
      {units}
    </span>
  );
}

// ── FLAT MODE ──────────────────────────────────────────────────────────────
/**
 * 2+ options, ONE pack. Every option on screen at once with its own stepper —
 * no option-selection step, no pack step, one screen. UNCHANGED by the rail:
 * choosing and setting are the same act here, and a rail would add taps.
 *
 * Applies to the three flat TILES — Acotone (14 rows), Machine Tinter (9) and
 * GVA (12), 1L each — and to M900 (20L, 12 rows), which lost its tile on
 * 2026-09-07 and now reaches this same body through SEARCH. Fourteen rows
 * overflow the sheet and scroll VERTICALLY inside it, which is expected: only
 * horizontal scroll is banned.
 *
 * Flat mode is NOT a second state shape. It writes into the same option -> pack
 * matrix every other mode does; it is simply the mode that renders every
 * option's row at once instead of one column plus one option's packs.
 *
 * The swatch here is PER ROW — a name with a hex gets one and a name without
 * gets none, which is the same rule the rail tiles now follow. That is why
 * Acotone shows fourteen clean text rows (no code decodes) while Machine Tinter
 * shows two swatches among nine (WHITE and BLACK decode, the seven colorant
 * codes do not). See the SHADE_HEX note in v2-data for why the codes stay
 * unmapped.
 *
 * The pack size is not repeated per row — it is stated once in the header,
 * because repeating "1L" fourteen times is noise, not information.
 */
function FlatBody({ options, pack, matrix, onStep, onType }: {
  options: V2Option[];
  pack: string;
  matrix: Record<string, Record<string, number>>;
  onStep: (option: string, pack: string, direction: 1 | -1) => void;
  onType: (option: string, pack: string, units: number) => void;
}): React.JSX.Element {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      style={{ paddingBottom: PACK_TRAILING }}
    >
      <div className="px-4 py-1">
        {options.map((opt) => {
          const qty = matrix[opt.value]?.[pack] ?? 0;
          const hex = shadeHex(opt.value);
          return (
            <div key={opt.value} className="flex items-center justify-between gap-3 py-2.5"
                 style={{ borderTop: `1px solid ${RULE}` }}>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {hex && (
                  <span className="shrink-0" style={{
                    width: 22, height: 22, borderRadius: 6, background: hex,
                    border: isLightHex(hex) ? "1px solid rgba(0,0,0,.15)" : "none",
                  }} />
                )}
                <span className="min-w-0 truncate text-[14px] font-semibold" style={{ color: INK }}>
                  {opt.value}
                </span>
              </div>
              <Stepper
                qty={qty}
                step={stepForLabel(pack, opt.row.product ?? opt.row.subProduct)}
                onStep={(d) => onStep(opt.value, pack, d)}
                onType={(units) => onType(opt.value, pack, units)}
                label={`${opt.value} ${pack}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The full-row stepper, used by FLAT mode. Same typed field as PackRow. */
function Stepper({ qty, step, onStep, onType, label }: {
  qty: number; step: number;
  onStep: (direction: 1 | -1) => void;
  onType: (units: number) => void;
  label: string;
}): React.JSX.Element {
  const btn = "h-11 w-11";
  const icon = "h-4 w-4";
  return (
    <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${RULE}` }}>
      <button
        type="button" aria-label={`Remove one box of ${label}`}
        disabled={qty === 0} onClick={() => onStep(-1)}
        className={`flex ${btn} items-center justify-center rounded-full disabled:opacity-30`}
      >
        <Minus className={icon} strokeWidth={3} style={{ color: INK }} />
      </button>
      <QtyField qty={qty} label={label} onCommit={onType} />
      <button
        type="button" aria-label={`Add one box of ${label}`} onClick={() => onStep(1)}
        className={`flex ${btn} items-center justify-center rounded-full`}
      >
        <Plus className={icon} strokeWidth={3} style={{ color: INK }} />
      </button>
    </div>
  );
}
