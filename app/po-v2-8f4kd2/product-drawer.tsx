"use client";

import { useMemo, useRef, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
// Documented containment exception — the tested matcher /po uses, read-only.
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import V2Sheet from "./v2-sheet";
import {
  BRAND, FAINT, FILL, INK, MUTED, RULE, SEARCH_BG, VIOLET, VIOLET_BG,
  baseChipLabel, boardTileArtFor, formatPack, isLightHex, packsOf, shadeHex,
  snapToBox, sortBases, stepForLabel, tileArtFor, unitsIn, variantImage,
  type ApiProduct, type V2DrawerMode, type V2Option, type V2Resolved,
  type V2ResolvedMember, type V2ResolvedTile,
} from "./v2-data";

// Hidden v2 product drawer — the bottom sheet a board tile opens.
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
// A tile can hold several PRODUCTS. They live in a horizontal STRIP under the
// title. Nothing drills, nothing is behind a back arrow:
//
//   STRIP  the products in this tile — only when there is more than one
//   RAIL   the selected product's bases and shades, exactly as it always was
//   PANE   that option's packs
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
 * One product inside the open tile, normalised.
 *
 * 🔴 mode AND pools ARE THE MEMBER'S OWN, never the tile's. buildBoard resolved
 * them per member precisely so nothing downstream has to, and the union is
 * wrong for twelve of the seventeen merged tiles — six of which are made
 * entirely of option-less products that a union would hand a base/shade shell.
 */
type Member = {
  sap:      string;
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

/** Does this member have an OPTIONS level to drill into at all? */
function hasOptions(m: Member, r: Rails): boolean {
  return m.mode !== "flat" && r.bases.length + r.shades.length > 0;
}

/** Rail geometry, in one place because "roomy" is a measured requirement. */
const RAIL_W   = 60;   // the column, gutters included
const TILE     = 44;   // swatch / text tile, square
const TILE_GAP = 12;   // between tiles — the brief's floor is 10

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
        sap: m.sap, label: m.label, resolved: m, mode: m.mode, pools: m.pools,
      }));
    }
    return [{ sap: product.sap, label: product.label, resolved: product,
              mode, pools: pools ?? NO_POOLS }];
  }, [tile, product, pools, mode]);
  const isMerged = members.length > 1;

  /** Every member's option columns, computed once per member. */
  const railsBy = useMemo<Record<string, Rails>>(() => {
    const out: Record<string, Rails> = {};
    for (const m of members) out[m.sap] = buildRails(m);
    return out;
  }, [members]);

  const [memberSap, setMemberSap] = useState<string>(() =>
    members.find((m) => m.sap === initialMember)?.sap ?? members[0].sap);
  const cur = members.find((m) => m.sap === memberSap) ?? members[0];
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
  const [matrix, setMatrix] = useState<Record<string, Record<string, Record<string, number>>>>(() => {
    // SEEDED FROM THE CART, PER MEMBER. Opening a tile already in the order
    // shows what is in it, on the right member and the right option, so Add can
    // replace rather than duplicate — and so he can SEE what he already ordered
    // before changing it. Every member's lines are seeded, not just the one on
    // screen: the drawer replaces the whole tile, so anything it fails to seed
    // is work it would silently throw away.
    const seed: Record<string, Record<string, Record<string, number>>> = {};
    for (const line of existing ?? []) {
      const opt = line.option ?? "";
      const byOpt = seed[line.member] ?? {};
      byOpt[opt] = { ...(byOpt[opt] ?? {}), ...line.qtys };
      seed[line.member] = byOpt;
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
  function closeSearch(): void {
    setSearchOpen(false);
    setQuery("");
  }

  const onShade = tab === "shade" ? rails.shades.length > 0 : rails.bases.length === 0;
  const column: V2Option[] = onShade ? rails.shades : rails.bases;
  /**
   * What the column holds, which is what decides how a tile draws itself:
   *
   *   member   text tiles, always — a product name is never a colour
   *   base     text tiles, always — see RailTile
   *   shade    a hex is a swatch, no hex is a text tile
   *   variant  a file is a picture, no file is a text tile
   *   mixed    a searched non-tile's single undifferentiated list; as shade
   */
  const columnKind: RailKind = rails.hasVariants ? "variant"
    : !cur.resolved.curated ? "mixed"
    : onShade ? "shade" : "base";
  /** The family wash a variant's tin sits on, exactly as on the board. */
  const wash = tile ? boardTileArtFor(tile.key).wash : tileArtFor(product.sap).wash;

  /** The rail is the current product's options, and only ever that. */
  const shown = useMemo<V2Option[]>(() => {
    const q = query.trim();
    if (q.length === 0) return column;
    const ranked = rankProductsForQuery(column.map((o) => o.row), q);
    const byId = new Map(column.map((o) => [o.row.id, o]));
    return ranked.map((r) => byId.get(r.id)).filter((o): o is V2Option => !!o);
  }, [query, column]);

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
    ? selectedRow.packs.map((p) => formatPack(p.packCode, p.unit))
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
    setQuery("");
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
  function selectMember(sap: string): void {
    if (sap === cur.sap) return;
    if (!members.some((x) => x.sap === sap)) return;
    setMemberSap(sap);
    setQuery("");
  }

  const matrixMode = cur.mode === "flat";
  const options = cur.pools.all;
  // FLAT is one pack for the whole product, so the label is stated once in the
  // header instead of on every row.
  const flatPack = matrixMode ? (packsOf(options.map((o) => o.row))[0] ?? "") : "";
  /**
   * The rail exists when the CURRENT PRODUCT has options. A tile of products
   * that have none — Damp Protect, Crack Filler — shows its strip and its
   * packs and no rail at all, which is exactly what a one-row product has
   * always done.
   */
  const showRail = curHasOptions;
  /** Both groups, or no toggle. */
  const showToggle = rails.bases.length > 0 && rails.shades.length > 0;

  /** The key the currently-selected option writes under. "" = no options. */
  const optionKey = selected ?? "";
  const qtys = matrix[cur.sap]?.[optionKey] ?? {};

  // One tap moves a WHOLE BOX; the value shown stays in UNITS. So 1L reads
  // 0 -> 6 -> 12, and 20L (a drum, step 1) reads 0 -> 1 -> 2. Floors at 0.
  function stepCell(member: string, option: string, pack: string, direction: 1 | -1): void {
    const delta = stepForLabel(pack) * direction;
    setMatrix((prev) => {
      const byOpt = { ...(prev[member] ?? {}) };
      const row = { ...(byOpt[option] ?? {}) };
      row[pack] = Math.max(0, (row[pack] ?? 0) + delta);
      byOpt[option] = row;
      return { ...prev, [member]: byOpt };
    });
  }

  /** A TYPED figure, already snapped to a whole box by the field itself. */
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
      option: key === "" ? null : key,
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
      labels={packLabels} qtys={qtys}
      onStep={(label, dir) => stepCell(cur.sap, optionKey, label, dir)}
      onType={(label, next) => typeCell(cur.sap, optionKey, label, next)}
    />
  );

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
            🔴 ONLY WHEN THE TILE HOLDS MORE THAN ONE. A single-product tile
            renders nothing here and is the drawer it always was.

            ⚠ overflow-x IS DELIBERATE AND IS NOT THE BANNED KIND. The standing
            rule is that the PAGE must never drag sideways at 390px, and it
            does not: this is a contained scroller with its own bounds, the way
            a carousel is. Sixteen products cannot wrap and must not be cut. */}
        {isMerged && (
          <div
            className="shrink-0 overflow-x-auto"
            style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
          >
            <div className="flex px-4 pb-3" style={{ gap: STRIP_GAP }}>
              {members.map((m) => (
                <ProductChip
                  key={m.sap}
                  label={m.label}
                  wash={wash}
                  selected={m.sap === cur.sap}
                  carrying={unitsOnMember(m.sap)}
                  onSelect={() => selectMember(m.sap)}
                />
              ))}
            </div>
          </div>
        )}

        {/* 🔴 FLAT IS FLAT WHETHER OR NOT THE TILE IS MERGED. showRail now
            asks the CURRENT PRODUCT, so a flat member (Velvetino in VT
            Specialty, M900 in More Enamels) would otherwise fall through to the
            single-option pack list and its shades would be unreachable — GOLD
            and SILVER with no way to choose between them. The strip sits above
            this either way. */}
        {matrixMode ? (
          <FlatBody options={options} pack={flatPack} matrix={matrix[cur.sap] ?? {}}
                    onStep={(o, p, d) => stepCell(cur.sap, o, p, d)}
                    onType={(o, p, u) => typeCell(cur.sap, o, p, u)} />
        ) : !showRail ? (
          // NO OPTIONS — one row, nothing to choose, so the packs get the whole
          // sheet. This is not a new code path; it is what falls out of having
          // no options, and it is the same branch whether the product arrived
          // alone or as one member of a tile of option-less products.
          packList
        ) : (
        <>
          {/* ── THE SEARCH, ONLY WHEN ASKED FOR ──────────────────────────
              Full width when it is open, because a field you have deliberately
              opened should be the widest thing on the row. autoFocus IS right
              here and is not a contradiction of "the drawer opens on a
              quantity, not a keyboard": that rule is about OPENING the drawer.
              Tapping a magnifier is a request to type. */}
          {searchOpen && (
            <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3"
                   style={{ background: SEARCH_BG }}>
                <Search className="h-4 w-4 shrink-0" strokeWidth={2.5} style={{ color: FAINT }} />
                <input
                  type="text" inputMode="search" autoComplete="off" autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={rails.hasVariants ? "Find"
                    : tab === "shade" ? "Find a shade" : "Find a base"}
                  aria-label="Filter the options in the rail"
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

          {query.trim().length > 0 && shown.length === 0 && (
            <p className="shrink-0 px-4 pb-2.5 text-[12.5px]" style={{ color: MUTED }}>
              Nothing in this list matches {query.trim()}
            </p>
          )}

          <div className="flex min-h-0 flex-1">
            {/* ── THE RAIL ──────────────────────────────────────────────────
                ONE column. 60px wide with an 8px gutter either side, so a 44px
                tile is centred and its selected ring (5.5px) and count badge
                (6px) both clear the edges without an overflow-x. */}
            <div
              className="shrink-0 overflow-y-auto"
              style={{
                width: RAIL_W, borderRight: `1px solid ${RULE}`,
                paddingTop: 10,
                paddingBottom: "calc(28px + env(safe-area-inset-bottom))",
              }}
            >
              <div className="flex flex-col items-center" style={{ gap: TILE_GAP }}>
                {/* 🔴 THE TOGGLE IS BACK AT THE TOP OF THE RAIL, WHERE THE
                    ORIGINAL BRIEF PUT IT. It only ever left because a search
                    FIELD could not live in 60px and the two shared a row. The
                    field is an icon now, so the toggle can go where it belongs
                    — directly above the column it switches, costing the sheet
                    no chrome height at all because it scrolls with the rail. */}
                {showToggle && (
                  <div className="flex w-full flex-col rounded-[10px] p-[3px]"
                       style={{ background: FILL, marginBottom: 2 }}>
                    <GroupButton label="Base"  active={tab === "base"}  onClick={() => switchTab("base")} />
                    <GroupButton label="Shade" active={tab === "shade"} onClick={() => switchTab("shade")} />
                  </div>
                )}
                {shown.map((opt) => (
                  <RailTile
                    key={opt.value}
                    value={opt.value}
                    kind={columnKind}
                    image={columnKind === "variant" ? variantImage(cur.sap, opt.value) : null}
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
              {/* The option, named at full size — the check against a wrong
                  tap, directly above the quantity. Which PRODUCT it belongs to
                  is answered by the strip above, where the selected tile is
                  ringed. */}
              {selectedOption && <NameBar value={selectedOption.value} kind={columnKind} />}
              {/* No empty state. selectedRow is resolved on the first frame for
                  every one of the 32 products — by the pre-selection above, or
                  by noOptionRow for the nine that have no options — so the pack
                  rows are on screen before the sheet finishes sliding up. */}
              {packList}
            </div>
          </div>
        </>
        )}
    </V2Sheet>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/** One half of the group toggle. A segmented control, not two tabs: it swaps
 *  the contents of one column rather than moving between two screens. */
function GroupButton({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className="rounded-[8px] py-1 text-[11px] font-bold"
      style={{
        color: active ? INK : MUTED,
        background: active ? "#FFFFFF" : "transparent",
        boxShadow: active ? "0 1px 2px rgba(27,24,38,.10)" : undefined,
      }}
    >
      {label}
    </button>
  );
}

/**
 * One option in the rail — a 44px square, and nothing else.
 *
 * 🔴 NO NAMES ON A SWATCH, ON ANY PRODUCT. Super Satin included, which is the
 * one that argued hardest for them: five browns as bare squares was the case
 * that produced the swatch+name chip and its ΔE close-pair rule. The rail
 * answers it differently and better — the NAME BAR spells the selection out at
 * 15px the instant it is tapped, so the confirmation is bigger than a caption
 * ever was and it is in the place he is already looking, next to the packs.
 * A caption under every tile would just rebuild the text row this replaces.
 *
 * AN OPTION WITH NO HEX IS A TEXT TILE — same square, mono, the short name.
 * That is the whole rule; it is decided per option, not per row. A wrong colour
 * is worse than no colour, so an unmapped name never gets a guessed square.
 *
 * 🔴 A BASE IS NEVER A SWATCH, EVEN WHEN A COLOUR EXISTS FOR IT. BRILLIANT
 * WHITE has a hex (#FAF8F2) and used to render as a near-white square in the
 * middle of 90, 92, 93 and 94. It is a tinting base standing in a column of
 * numbered tinting bases, and it belongs with them as the word BW — a base's
 * own colour is not the colour of the paint that comes out of it, so the square
 * was saying nothing and costing the sequence its shape. Scoped to the BASE
 * column: if BRILLIANT WHITE ever appears as a SHADE, it keeps its swatch,
 * which is why this asks the column and not the name.
 *
 * 🔴 A VARIANT WITH A FILE IS A PICTURE. Five Smart Choice buckets are five
 * different products, and their tins are different colours — red, cream, navy,
 * blue-silver — so at 44px the tin separates them where a word this small
 * struggles. A variant with no file keeps its text tile, and a mixed column is
 * fine: telling them apart is the point and both forms do that. Bases and
 * shades never get a picture, because there the tin is the SAME tin.
 *
 * `title` / `aria-label` carry the full name for anyone who cannot use colour.
 */
type RailKind = "base" | "shade" | "variant" | "mixed";

/**
 * ONE PRODUCT IN THE STRIP — a 56px square with its name under it.
 *
 * 🔴 THE TREATMENT IS THE BOARD'S OWN ART-LESS TILE, NOT A NEW ONE: the family
 * wash, radius 14, no border, the violet count badge in the same corner. Every
 * member's slug is unset today, so every chip is the empty tinted square the
 * board shows for a product whose art has not arrived — which is a treatment
 * this app already has and a salesman has already seen.
 *
 * WHEN THE FILES ARRIVE this must be a drop-in: an <img> inside the same
 * square, objectFit contain, mixBlendMode multiply, and NOTHING about the
 * layout moves. That is why the square is a fixed 56 and the name sits in its
 * own 64px cell below rather than beside it.
 */
function ProductChip({ label, wash, selected, carrying, onSelect }: {
  label: string; wash: string; selected: boolean; carrying: number; onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="flex shrink-0 flex-col items-center gap-1 text-left"
      style={{ width: STRIP_CELL }}
    >
      <span
        className="relative block overflow-hidden"
        style={{
          width: STRIP_TILE, height: STRIP_TILE, borderRadius: 14,
          background: selected ? VIOLET_BG : wash,
          // The same ring the rail uses, so "selected" means one thing in this
          // drawer wherever it appears.
          boxShadow: selected ? `0 0 0 2px #FFFFFF, 0 0 0 4px ${VIOLET}` : undefined,
        }}
      >
        {carrying > 0 && (
          <span
            className="absolute flex items-center justify-center rounded-full text-[10px] font-extrabold text-white"
            style={{ top: 3, right: 3, minWidth: 17, height: 17, padding: "0 5px", background: VIOLET }}
          >
            {carrying}
          </span>
        )}
      </span>
      {/* Two lines, and the word never breaks mid-way — the board's own rule.
          A name too long for two lines clips rather than hyphenating, which is
          the lesser of the two wrongs at this size. */}
      <span
        className="block w-full text-center"
        style={{
          color: selected ? VIOLET : INK,
          fontSize: 10.5, lineHeight: 1.2, fontWeight: selected ? 700 : 500,
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
          overflow: "hidden", overflowWrap: "normal", wordBreak: "normal", hyphens: "none",
        }}
      >
        {label}
      </span>
    </button>
  );
}

function RailTile({ value, kind, image, wash, selected, carrying, onSelect }: {
  value: string; kind: RailKind; image: string | null; wash: string;
  selected: boolean; carrying: number; onSelect: () => void;
}): React.JSX.Element {
  const hex = swatchFor(value, kind);
  return (
    // A bare swatch has no room for a badge INSIDE it without covering the
    // colour, which is the one thing it exists to show. The count rides the
    // top-right corner instead, on the wrapper.
    <span className="relative block shrink-0" style={{ width: TILE, height: TILE }}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={carrying > 0 ? `${value}, ${carrying} units` : value}
        title={value}
        onClick={onSelect}
        className="flex h-full w-full items-center justify-center overflow-hidden"
        style={{
          borderRadius: 10,
          background: image ? wash : hex ?? FILL,
          // A near-white fill gets a faint inner border, or a white tile on a
          // white sheet is simply not there. A picture sits on the family wash
          // and needs no edge — the tin draws its own.
          border: image ? "none"
            : hex ? (isLightHex(hex) ? "1px solid rgba(0,0,0,.15)" : "none")
            : `1px solid ${RULE}`,
          // A VIOLET RING WITH A WHITE GAP. The gap is what makes it read on a
          // dark colour: a violet ring straight against #1D1E1F is a violet
          // edge nobody sees.
          boxShadow: selected ? `0 0 0 3px #FFFFFF, 0 0 0 5.5px ${VIOLET}` : undefined,
        }}
      >
        {image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={image}
            alt={value}
            width={600}
            height={600}
            decoding="async"
            loading="lazy"
            className="block h-full w-full"
            // MULTIPLY, exactly as on the board: every file is an opaque white
            // square, so painted normally it would cover the family wash and
            // every tile would be a white box.
            style={{ objectFit: "contain", mixBlendMode: "multiply" }}
          />
        ) : hex ? null : <TileWords label={baseChipLabel(value)} />}
      </button>
      {carrying > 0 && (
        <span className="pointer-events-none absolute" style={{ top: -6, right: -6 }}>
          <ChipCount units={carrying} />
        </span>
      )}
    </span>
  );
}

/**
 * 🔴 THE ONE PLACE "DOES THIS OPTION GET A SWATCH?" IS ANSWERED, so the rail
 * tile and the name bar can never disagree about it — a BW tile above a white
 * square in the name bar would be the drawer contradicting itself on screen.
 */
function swatchFor(value: string, kind: RailKind): string | undefined {
  return kind === "base" ? undefined : shadeHex(value);
}

/**
 * The words inside a text tile, stacked and sized to fit 44px.
 *
 * One word per line and the size taken from the LONGEST word, so "Freedom 2in1
 * Primer" reads as three short lines rather than one clipped one. The size ramp
 * is deliberately coarse — four steps, no measuring — because the authoritative
 * name is in the bar the moment the tile is tapped; this only has to be
 * recognisable, not readable at arm's length.
 *
 * 🔴 THE APP'S OWN SANS, NOT A MONOSPACE. It was mono, which reads as a
 * terminal rather than as a product, and it is the only place in v2 that used
 * one for a NAME. Sans is also narrower per character, so every step of the
 * ramp went UP and fewer names clip than did before.
 */
function TileWords({ label }: { label: string }): React.JSX.Element {
  const words = label.split(/\s+/).filter(Boolean);
  const longest = words.reduce((n, w) => Math.max(n, w.length), 0);
  const size = longest <= 3 ? 13 : longest <= 5 ? 11.5 : longest <= 7 ? 10 : 8.5;
  return (
    <span
      className="flex flex-col items-center justify-center font-bold"
      style={{ color: INK, fontSize: size, lineHeight: 1.15, letterSpacing: "-0.01em" }}
    >
      {words.map((w, i) => <span key={`${w}-${i}`}>{w}</span>)}
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
 * the pane the room this whole step was about. The swatch is shown on the same
 * terms the tile draws it (swatchFor), so the two always agree.
 */
function NameBar({ value, kind }: { value: string; kind: RailKind }): React.JSX.Element {
  const hex = swatchFor(value, kind);
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
function PackList({ labels, qtys, onStep, onType }: {
  labels: string[];
  qtys: Record<string, number>;
  onStep: (label: string, direction: 1 | -1) => void;
  onType: (label: string, units: number) => void;
}): React.JSX.Element {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-4 py-1"
      style={{ paddingBottom: "calc(76px + env(safe-area-inset-bottom))" }}
    >
      {labels.map((label) => (
        <PackRow
          key={label}
          label={label}
          step={stepForLabel(label)}
          qty={qtys[label] ?? 0}
          onStep={(dir) => onStep(label, dir)}
          onType={(next) => onType(label, next)}
        />
      ))}
    </div>
  );
}

/**
 * One pack row. The "per N" sub-label comes from the copied depot step table,
 * and is HIDDEN when the step is 1 — a drum has no box, so "per 1" would be
 * noise dressed as information.
 *
 * 🔴 A LIST, NOT FOUR BANNERS. This row used to be 16px/800 over a mono
 * caption with 12px of padding above and below — 62px each, so four packs
 * filled a phone. Worse, the label outweighed the PRODUCT NAME above it
 * (15px/700), which is backwards: the name is the hero and the pack is a row
 * in a list. 15px/600 over a 10.5px caption at 6px padding reads as a list and
 * gives the strip its height back.
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
    <div className="flex items-center justify-between gap-3 py-1.5">
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
        <QtyField qty={qty} step={step} label={label} onCommit={onType} />
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
 * ON BLUR the value SNAPS to a whole box and the field shows the snapped
 * number — type 5 on a six-per pack and it reads 6 before he looks away.
 * Empty, or anything that is not a number, reverts to what was there: a line
 * must never be left at NaN.
 */
function QtyField({ qty, step, label, onCommit }: {
  qty: number; step: number; label: string; onCommit: (units: number) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Blur fires after Enter's own blur() call too; this stops the commit running
  // twice and re-snapping an already-snapped number.
  const committed = useRef(false);

  function commit(): void {
    if (committed.current) return;
    committed.current = true;
    const clean = draft.trim();
    setEditing(false);
    // Nothing typed, or nothing numeric: keep what was there. Never NaN.
    if (clean === "" || !/^\d+$/.test(clean)) return;
    const snapped = snapToBox(Number(clean), step);
    if (snapped !== qty) onCommit(snapped);
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
      style={{ paddingBottom: "calc(76px + env(safe-area-inset-bottom))" }}
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
                step={stepForLabel(pack)}
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
      <QtyField qty={qty} step={step} label={label} onCommit={onType} />
      <button
        type="button" aria-label={`Add one box of ${label}`} onClick={() => onStep(1)}
        className={`flex ${btn} items-center justify-center rounded-full`}
      >
        <Plus className={icon} strokeWidth={3} style={{ color: INK }} />
      </button>
    </div>
  );
}
