"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, Minus, Plus, Search, X } from "lucide-react";
// Documented containment exception — the tested matcher /po uses, read-only.
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import V2Sheet from "./v2-sheet";
import {
  BRAND, FAINT, FILL, INK, MUTED, RULE, SEARCH_BG, VIOLET,
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
// ── THE RAIL GREW A SECOND LEVEL, 2026-09-07 ───────────────────────────────
//
// A tile can now hold several PRODUCTS. The rail is therefore two levels and
// you are always on exactly one of them:
//
//   MEMBERS  the products inside this tile
//   OPTIONS  the selected product's bases and shades — the rail as it was
//
// 🔴 A ONE-MEMBER TILE NEVER SEES THE MEMBERS LEVEL. Twenty-five of the
// thirty-six tiles hold one product, and for them `isMerged` is false, `level`
// is pinned to "options" and no chevron renders. They take the identical code
// path they took before this change — same mode, same pre-selection, same one
// tap — and that is the property this whole step is measured on. The members
// level is an ADDITION for eleven tiles, not a new shape for thirty-six.
//
// The drawer opens on the member the page names (initialMember: the top seller
// from a board tap, the searched product from a search hit). If that member has
// options the rail opens on OPTIONS with a "‹ {member}" row above it; if it has
// none there is no second level to drill into, so the rail stays on MEMBERS
// with that one highlighted and the pane shows its packs. Either way the thing
// he came for is one tap away, exactly as it was.
//
// NO HORIZONTAL SCROLL: the rail is a vertical column and the pane is
// `min-w-0`. Neither has an overflow-x. NO SECOND SHEET: a level is a state
// change inside the one sheet, so the ref-counted body-scroll lock and the
// --vvh / --vvo viewport pinning are untouched by any of this.

type Tab = "base" | "shade";
type Level = "members" | "options";

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

  /**
   * 🔴 A ONE-MEMBER TILE IS PINNED TO "options" AND NEVER LEAVES IT. The
   * members level does not exist for it, the chevron does not render, and the
   * whole two-level machine collapses to the rail that shipped at b088d8c7.
   */
  const [level, setLevel] = useState<Level>(() =>
    !isMerged ? "options" : (curHasOptions ? "options" : "members"));
  const onMembers = isMerged && level === "members";

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
  const columnKind: RailKind = onMembers ? "member"
    : rails.hasVariants ? "variant"
    : !cur.resolved.curated ? "mixed"
    : onShade ? "shade" : "base";
  /** The family wash a variant's tin sits on, exactly as on the board. */
  const wash = tile ? boardTileArtFor(tile.key).wash : tileArtFor(product.sap).wash;

  /** The rail's rows: members when on that level, this member's options when not. */
  const rowsForRail = useMemo<{ value: string; label: string; sap: string }[]>(() => {
    if (onMembers) return members.map((m) => ({ value: m.sap, label: m.label, sap: m.sap }));
    return column.map((o) => ({ value: o.value, label: o.value, sap: cur.sap }));
  }, [onMembers, members, column, cur.sap]);

  const shown = useMemo(() => {
    const q = query.trim();
    if (q.length === 0) return rowsForRail;
    if (onMembers) {
      // Members are products, not catalog rows — a plain contains, which is
      // what a two-word product name needs and all the matcher would give here.
      const lower = q.toLowerCase();
      return rowsForRail.filter((r) => r.label.toLowerCase().includes(lower));
    }
    const ranked = rankProductsForQuery(column.map((o) => o.row), q);
    const byId = new Map(column.map((o) => [o.row.id, o]));
    const hit = ranked.map((r) => byId.get(r.id)).filter((o): o is V2Option => !!o);
    return hit.map((o) => ({ value: o.value, label: o.value, sap: cur.sap }));
  }, [query, onMembers, rowsForRail, column, cur.sap]);

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
   * 🔴 SWITCHING MEMBER CLEARS NOTHING EITHER, AND IT IS THE SAME ARGUMENT ONE
   * LEVEL UP. The quantities are keyed by member as well as by option, so
   * everything he has typed against every product in this tile survives every
   * move he makes inside it. The drawer returns the lot on Add.
   *
   * A member WITH options drills into them. A member with none has no second
   * level to drill into, so the rail stays where it is and only the pane
   * changes — which is also why a one-member option-less tile never grew a
   * chevron.
   */
  function selectMember(sap: string): void {
    const m = members.find((x) => x.sap === sap);
    if (!m) return;
    setMemberSap(sap);
    setQuery("");
    setLevel(hasOptions(m, railsBy[sap]) ? "options" : "members");
  }

  function goUpToMembers(): void {
    setLevel("members");
    setQuery("");
  }

  const matrixMode = cur.mode === "flat";
  const options = cur.pools.all;
  // FLAT is one pack for the whole product, so the label is stated once in the
  // header instead of on every row.
  const flatPack = matrixMode ? (packsOf(options.map((o) => o.row))[0] ?? "") : "";
  /** The rail shows SOMETHING whenever there is a member list or an option list. */
  const showRail = isMerged || curHasOptions;
  /**
   * The Base / Shade toggle belongs to the OPTIONS level and to a member that
   * actually has both groups. At the members level there is nothing to toggle —
   * a product is not a base or a shade — so it does not render.
   */
  const showToggle = !onMembers && rails.bases.length > 0 && rails.shades.length > 0;

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
          <button
            type="button" aria-label="Close" onClick={onClose}
            className="flex shrink-0 items-center justify-center rounded-full"
            style={{ width: 30, height: 30, background: FILL }}
          >
            <X className="h-4 w-4" strokeWidth={2.5} style={{ color: MUTED }} />
          </button>
        </div>

        {matrixMode && !isMerged ? (
          <FlatBody options={options} pack={flatPack} matrix={matrix[cur.sap] ?? {}}
                    onStep={(o, p, d) => stepCell(cur.sap, o, p, d)}
                    onType={(o, p, u) => typeCell(cur.sap, o, p, u)} />
        ) : !showRail ? (
          // SINGLE — nine products with exactly one row. No rail, no toggle, no
          // search: there is nothing to choose, so the packs get the whole
          // sheet. This is not a new code path; it is what falls out of having
          // no options.
          packList
        ) : (
        <>
          {/* ── THE STRIP: GROUP TOGGLE + RAIL SEARCH ──────────────────────
              🔴 IT SPANS THE SHEET, NOT THE 60px RAIL. The brief puts both of
              these "at the top of the rail", and the toggle would fit there —
              but a search box 44px wide is a box nobody can read what they
              typed into, and the whole point of this step is room. So the strip
              sits directly above the column, aligned to its top edge, and uses
              the width the sheet already has. It controls the rail and nothing
              else: the toggle picks which group the column holds, the field
              filters that column. */}
          {/* ── "‹ MEMBER" — THE ONLY NEW CHROME, AND ONLY ON A MERGED TILE ──
              It is a back button and an identity line at once. At OPTIONS level
              the name bar below shows the OPTION, so without this row the
              PRODUCT he is buying is nowhere on screen — which on a tile called
              "Primers" holding six different primers is not a detail.

              A one-member tile never renders it. */}
          {isMerged && level === "options" && (
            <button
              type="button"
              onClick={goUpToMembers}
              aria-label={`Back to the products in ${tile?.label ?? ""}`}
              className="flex shrink-0 items-center gap-1.5 px-4 pb-2.5 text-left"
            >
              <ChevronLeft className="h-4 w-4 shrink-0" strokeWidth={3} style={{ color: VIOLET }} />
              <span className="min-w-0 truncate text-[13px] font-extrabold" style={{ color: VIOLET }}>
                {cur.label}
              </span>
            </button>
          )}

          <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
            {showToggle && (
              <div className="flex shrink-0 rounded-[11px] p-[3px]" style={{ background: FILL }}>
                <GroupButton label="Base"  active={tab === "base"}  onClick={() => switchTab("base")} />
                <GroupButton label="Shade" active={tab === "shade"} onClick={() => switchTab("shade")} />
              </div>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3"
                 style={{ background: SEARCH_BG }}>
              <Search className="h-4 w-4 shrink-0" strokeWidth={2.5} style={{ color: FAINT }} />
              <input
                // NO autoFocus. The drawer opens on a quantity, not a keyboard.
                type="text" inputMode="search" autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={onMembers ? "Find a product"
                  : rails.hasVariants ? "Find"
                  : tab === "shade" ? "Find a shade" : "Find a base"}
                aria-label={onMembers ? "Filter the products in this tile"
                  : "Filter the options in the rail"}
                // 16px, or Safari zooms the page on focus.
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] outline-none placeholder:text-[#9C99AC]"
                style={{ color: INK }}
              />
              {query.length > 0 && (
                <button
                  type="button" aria-label="Clear the filter" onClick={() => setQuery("")}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: RULE }}
                >
                  <X className="h-3 w-3" strokeWidth={3} style={{ color: MUTED }} />
                </button>
              )}
            </div>
          </div>

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
                {shown.map((r) => (
                  <RailTile
                    key={r.value}
                    value={r.label}
                    kind={columnKind}
                    image={columnKind === "variant" ? variantImage(cur.sap, r.value) : null}
                    wash={wash}
                    selected={onMembers ? r.value === cur.sap : selected === r.value}
                    carrying={onMembers ? unitsOnMember(r.value) : unitsOn(cur.sap, r.value)}
                    onSelect={() => (onMembers ? selectMember(r.value) : selectOption(r.value))}
                  />
                ))}
              </div>
            </div>

            {/* ── THE PANE ────────────────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* At MEMBERS level the pane belongs to the current member, so the
                  bar names the PRODUCT; at OPTIONS level it names the option,
                  exactly as before. Either way it is the check against a wrong
                  tap, sitting directly above the quantity. */}
              {onMembers
                ? <NameBar value={cur.label} kind="member" />
                : selectedOption && <NameBar value={selectedOption.value} kind={columnKind} />}
              {/* No empty state. selectedRow is resolved on the first frame for
                  every one of the 32 products — by the pre-selection above, or
                  by noOptionRow for the nine that have no options — so the pack
                  rows are on screen before the sheet finishes sliding up. */}
              {/* A FLAT member inside a merged tile keeps flat mode's body —
                  every option with its own stepper — while the rail stays on
                  the members level beside it. */}
              {matrixMode
                ? <FlatBody options={options} pack={flatPack} matrix={matrix[cur.sap] ?? {}}
                            onStep={(o, p, d) => stepCell(cur.sap, o, p, d)}
                            onType={(o, p, u) => typeCell(cur.sap, o, p, u)} />
                : packList}
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
      className="rounded-[9px] px-3 py-1.5 text-[12.5px] font-extrabold"
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
/**
 * 🔴 "member" IS NOT A NEW TREATMENT — it renders exactly what a variant with
 * no image renders, a mono text tile. It exists so a product name can never be
 * mistaken for a colour: swatchFor() returns undefined for it unconditionally,
 * so a member that happens to share a name with a mapped shade cannot suddenly
 * draw a coloured square where a product belongs.
 */
type RailKind = "member" | "base" | "shade" | "variant" | "mixed";

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
        ) : hex ? null : (
          // A member carries a display name already; only a BASE needs
          // shortening ("90 BASE" -> "90", "BRILLIANT WHITE" -> "BW").
          <TileWords label={kind === "member" ? value : baseChipLabel(value)} />
        )}
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
  return kind === "base" || kind === "member" ? undefined : shadeHex(value);
}

/**
 * The words inside a text tile, stacked and sized to fit 44px.
 *
 * One word per line and the size taken from the LONGEST word, so "Freedom 2in1
 * Primer" reads as three short lines rather than one clipped one. The size ramp
 * is deliberately coarse — four steps, no measuring — because the authoritative
 * name is in the bar the moment the tile is tapped; this only has to be
 * recognisable, not readable at arm's length.
 */
function TileWords({ label }: { label: string }): React.JSX.Element {
  const words = label.split(/\s+/).filter(Boolean);
  const longest = words.reduce((n, w) => Math.max(n, w.length), 0);
  const size = longest <= 3 ? 13 : longest <= 5 ? 11 : longest <= 7 ? 9.5 : 7.5;
  return (
    <span
      className="flex flex-col items-center justify-center font-mono font-extrabold"
      style={{ color: INK, fontSize: size, lineHeight: 1.15, letterSpacing: "-0.02em" }}
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
 * 12px above and below, not 10: the options left this pane and the room they
 * freed belongs to the rows, not to whitespace at the bottom of the sheet.
 */
function PackRow({ label, step, qty, onStep, onType }: {
  label: string; step: number; qty: number;
  onStep: (direction: 1 | -1) => void;
  onType: (units: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-[16px] font-extrabold leading-tight" style={{ color: INK }}>{label}</p>
        {step > 1 && (
          <p className="font-mono text-[11px] leading-tight" style={{ color: MUTED }}>per {step}</p>
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
