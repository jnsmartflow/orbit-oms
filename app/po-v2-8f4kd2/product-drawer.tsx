"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
// Documented containment exception — the tested matcher /po uses, read-only.
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import V2Sheet from "./v2-sheet";
import {
  INK, RULE, SEARCH_BG, VIOLET, VIOLET_BG,
  baseChipLabel, chipStyle, formatPack, isLightHex, packsOf, shadeHex, shadeRowMode,
  stepForLabel, unitsIn,
  type ApiProduct, type V2DrawerMode, type V2Option, type V2Resolved,
} from "./v2-data";

// Hidden v2 product drawer — the bottom sheet a board tile opens.
//
// 🔴 CONTAINMENT — imports only ./v2-data and node_modules. Nothing from lib/
// or app/po/, no localStorage, no fetch. Every colour is an inline style.
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
// NO HORIZONTAL SCROLL: every chip row is `flex-wrap`, never a scroller.

type Tab = "base" | "shade";

export default function ProductDrawer({
  product,
  initialOption = null,
  onClose,
  onAdd,
  pools,
  mode = "standard",
}: {
  product: V2Resolved;
  /** Opened from a search hit: this exact option starts selected. */
  initialOption?: string | null;
  onClose: () => void;
  /** MANY lines: flat and grid let one visit set quantities on several
   *  options, and each option is its own cart line. Standard sends one. */
  onAdd: (picks: { option: string | null; row: ApiProduct; qtys: Record<string, number> }[]) => void;
  /**
   * EVERY option this product has, in catalog order. "+ More" swaps the chip
   * row to this list.
   *
   * 🔴 "+ More" USED TO RE-RUN THE SEARCH, PRE-FILLED WITH THE PRODUCT NAME.
   * That became a DEAD END the moment search started returning one row per
   * product: the single result was this product, tapping it reopened this
   * drawer with the same capped chips, and options 9+ were unreachable. It is
   * now a local expansion — no round trip, no loop.
   */
  pools?: { all: V2Option[]; bases: V2Option[]; shades: V2Option[] };
  /** From drawerMode() in v2-data — the ONE place the shape is decided. */
  mode?: V2DrawerMode;
}): React.JSX.Element {
  const hasBases    = product.bases.length > 0;
  const hasShades   = product.shades.length > 0;
  const hasVariants = product.variants.length > 0;
  // A tab appears only if its list is non-empty; neither list -> no tabs.
  const showTabs = hasBases || hasShades;

  // Open on the tab that actually holds the searched option, so the chip the
  // salesman searched for is on screen rather than one tab away.
  //
  // 🔴 THE FINAL FALLBACK IS "base", NOT "shade". It used to be
  // `hasBases ? "base" : "shade"`, which handed a product with NEITHER list a
  // phantom shade tab — see the needsShade note in the footer gating below,
  // which is where that turned into a blocking bug.
  const [tab, setTab] = useState<Tab>(() => {
    if (initialOption && product.shades.some((o) => o.value === initialOption)) return "shade";
    // 🔴 OPEN ON THE TAB HOLDING THE MOST-ORDERED OPTION, not always Base.
    // Promise Enamel's only base is BRILLIANT WHITE (241 orders) while its top
    // shade CLASSIC WHITE takes 797 — opening on that one-chip Base tab would
    // put what he actually wants one tap away, every single time.
    // defaultTab is generated from the same 90-day ranking as the chip lists.
    if (product.defaultTab === "shade" && hasShades) return "shade";
    if (hasBases)  return "base";
    if (hasShades) return "shade";
    return "base";
  });
  // ONE selection, whichever list it came from. Top base pre-selected; shade
  // and variant never are, so a shade-only or variant product opens with no
  // pack rows until the salesman commits to one — correct, because the packs
  // belong to the ROW and there is no row yet.
  // A tab holding exactly ONE option selects it on arrival — a chip that is
  // the only possible answer should not also cost a tap. That is what makes
  // Promise Enamel's and GVA's single-chip Base tab free rather than a chore.
  const soleOf = (list: V2Option[]): string | null =>
    list.length === 1 ? list[0].value : null;
  const [selected, setSelected] = useState<string | null>(() => {
    if (initialOption) return initialOption;
    if (hasVariants) return soleOf(product.variants);
    const opening = product.defaultTab === "shade" && hasShades ? product.shades : product.bases;
    return soleOf(opening) ?? (opening === product.bases ? (product.bases[0]?.value ?? null) : null);
  });
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState(false);
  // FLAT and GRID keep their own state: option -> pack label -> units. The
  // standard path above is untouched by it, and a drawer is in exactly one
  // mode for its whole life, so the two never coexist.
  const [matrix, setMatrix] = useState<Record<string, Record<string, number>>>({});
  // B2: the Shade tab expands into a text FILTER, not more chips.
  const [shadeQuery, setShadeQuery] = useState("");

  // True when the chip row currently shows BASES — the only list whose labels
  // are shortened. "BRILLIANT WHITE" is also a SHADE on GVA and Promise
  // Enamel, and abbreviating it there would rename a colour.
  const showingBases = !hasVariants && tab === "base";
  // Colour swatches only on the SHADE row, and only when every shade on it has
  // one — never a half-colour, half-code row. Bases and variants are always
  // text: "90" and "Int Primer" are not colours.
  const showingShades = !hasVariants && tab === "shade";
  const colourRow = showingShades && !expanded
    && shadeRowMode(product.shades.map((o) => o.value)) === "colour";

  // Which options are on show right now, and which row that resolves to.
  const curatedList: V2Option[] = hasVariants
    ? product.variants
    : tab === "base" ? product.bases : product.shades;
  // 🔴 THE EXPANSION IS FILTERED BY TAB. It used to swap in every option the
  // product had, so expanding Gloss on the BASE tab showed BLACK, MINT GREEN
  // and WILD PURPLE among the bases. Each tab now expands into its own pool.
  const expansionPool: V2Option[] = tab === "base"
    ? (pools?.bases ?? [])
    : (pools?.shades ?? []);
  // B2: expanding the SHADE tab opens a text FILTER, not more chips. A
  // Gloss shade list is 29 long and chips make that a wall; a name is what the
  // salesman actually has in his head. Ranked with the SAME matcher the main
  // search bar uses (rankProductsForQuery) rather than a second rule.
  const shadeSearchOpen = expanded && tab === "shade" && !hasVariants;
  const shadeMatches = useMemo<V2Option[]>(() => {
    const q = shadeQuery.trim();
    if (!shadeSearchOpen) return [];
    if (q.length === 0) return expansionPool;
    const ranked = rankProductsForQuery(expansionPool.map((o) => o.row), q);
    const byId = new Map(expansionPool.map((o) => [o.row.id, o]));
    return ranked.map((r) => byId.get(r.id)).filter((o): o is V2Option => !!o);
  }, [shadeSearchOpen, shadeQuery, expansionPool]);

  const shownList: V2Option[] = expanded ? expansionPool : curatedList;
  // "+ More" earns its place only when there is genuinely more to show.
  const hasMore = !hasVariants && !expanded && expansionPool.length > curatedList.length;

  // 🔴 THE SELECTION IS RESOLVED AGAINST THE WHOLE POOL, NOT THE VISIBLE LIST.
  // It used to be looked up in the list on screen, which collapses back to the
  // curated nine the moment the search closes — so a shade picked out of "+
  // More" (BUS GREEN, say) was no longer findable, selectedRow fell to null,
  // the body kept saying "Pick a shade" and Add stayed dead while the header
  // cheerfully showed BUS GREEN. What is selected and what is listed are two
  // different questions.
  const optionPool: V2Option[] = pools?.all ?? shownList;
  const selectedOption = selected === null
    ? undefined
    : optionPool.find((o) => o.value === selected) ?? shownList.find((o) => o.value === selected);

  // ...and a selection that is not in the visible list is PINNED to the front
  // of it, so the chip row can never show nothing selected while the header
  // says otherwise.
  const activeList: V2Option[] = selectedOption && !shownList.some((o) => o.value === selected)
    ? [selectedOption, ...shownList]
    : shownList;

  const selectedRow: ApiProduct | null =
    product.noOptionRow ?? selectedOption?.row ?? null;

  const packLabels = selectedRow
    ? selectedRow.packs.map((p) => formatPack(p.packCode, p.unit))
    : [];

  // Switching tabs clears the selection and every quantity. Coming back to
  // Base re-applies the top-base pre-select, keeping that rule true whenever
  // the base row is on screen.
  function switchTab(next: Tab): void {
    if (next === tab) return;
    const list = next === "base" ? product.bases : product.shades;
    setTab(next);
    // Same two rules as on open: a sole option selects itself, and the base
    // tab keeps its top-ranked pre-select. A shade tab with a real choice in
    // it starts empty, because guessing a colour for him would be worse.
    setSelected(soleOf(list) ?? (next === "base" ? (product.bases[0]?.value ?? null) : null));
    setQtys({});
    setExpanded(false);
    setShadeQuery("");
  }

  function selectOption(value: string): void {
    if (value === selected) return;
    setSelected(value);
    // Packs belong to the ROW, and a different option is a different row with
    // a possibly different pack table. Carrying quantities across would keep a
    // "20L x 2" that the new row may not even sell.
    setQtys({});
  }

  // One tap moves a WHOLE BOX; the value shown stays in UNITS. So 1L reads
  // 0 -> 6 -> 12, and 20L (a drum, step 1) reads 0 -> 1 -> 2. Floors at 0.
  function step(label: string, direction: 1 | -1): void {
    const delta = stepForLabel(label) * direction;
    setQtys((prev) => ({ ...prev, [label]: Math.max(0, (prev[label] ?? 0) + delta) }));
  }

  const matrixMode = mode === "flat";
  const options = pools?.all ?? [];
  // FLAT is one pack for the whole product, so the label is stated once in the
  // header instead of on every row.
  const flatPack = mode === "flat" ? (packsOf(options.map((o) => o.row))[0] ?? "") : "";

  function stepCell(option: string, pack: string, direction: 1 | -1): void {
    const delta = stepForLabel(pack) * direction;
    setMatrix((prev) => {
      const row = { ...(prev[option] ?? {}) };
      row[pack] = Math.max(0, (row[pack] ?? 0) + delta);
      return { ...prev, [option]: row };
    });
  }

  // One cart line per OPTION that has any quantity — a single visit to a flat
  // or grid product can legitimately order six shades at once.
  const matrixPicks = matrixMode
    ? options
        .map((opt) => ({
          option: opt.value,
          row: opt.row,
          qtys: Object.fromEntries(
            Object.entries(matrix[opt.value] ?? {}).filter(([, q]) => q > 0),
          ),
        }))
        .filter((p) => Object.keys(p.qtys).length > 0)
    : [];
  const matrixUnits = matrixPicks.reduce((sum, p) => sum + unitsIn(p.qtys), 0);

  // ── Footer gating ────────────────────────────────────────────────────────
  //
  // 🔴 THE BUG THIS FIXES. `needsShade` used to read
  //     !hasVariants && tab === "shade" && selected === null
  // with no test that the product HAS any shades. A product with no bases, no
  // shades and no variants — Cement SB, Zinc Yellow, Red Oxide, Ext Acrylic,
  // Damp 2in1, Roof Coat, Crack 5mm, Damp Base, Thinner, nine live sellers —
  // fell to `tab = "shade"` in the initialiser above, had `selected === null`
  // because there was nothing to pre-select, and so demanded a shade from a
  // chip row that is never rendered for it (showTabs is false). Add stayed
  // dead on "Pick a shade" with no way out. Every one of those products was
  // unorderable.
  //
  // A demand for a selection is only meaningful when there is something to
  // select, so each guard now tests its own list first.
  const units = unitsIn(qtys);
  const needsVariant = hasVariants && selected === null;
  const needsShade   = hasShades && !hasVariants && tab === "shade" && selected === null;
  const canAdd = matrixMode
    ? matrixUnits > 0
    : units > 0 && selectedRow !== null && !needsVariant && !needsShade;

  let addLabel: string;
  if (matrixMode)      addLabel = canAdd ? `Add · ${matrixUnits} units` : "Add to order";
  else if (needsVariant) addLabel = "Interior or exterior?";
  else if (needsShade) addLabel = "Pick a shade";
  else if (!canAdd)    addLabel = "Add to order";
  else                 addLabel = `Add · ${units} units`;

  // Sub-line: in FLAT the pack size, stated once so it is never ambiguous;
  // in GRID the packs are their own column headers; otherwise the selection.
  const selectionLine = mode === "flat" ? flatPack
    : matrixMode ? null
    : product.noOptionRow ? null : selected;

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
        onClick={() => {
          if (!canAdd) return;
          if (matrixMode) onAdd(matrixPicks);
          else if (selectedRow) onAdd([{ option: selected, row: selectedRow, qtys }]);
        }}
        className="min-w-0 flex-1 truncate rounded-[13px] py-3 text-[15px] font-extrabold text-white"
        style={{ background: canAdd ? VIOLET : "#C9C6D2" }}
      >
        {addLabel}
      </button>
    </>
  );

  return (
    <V2Sheet onClose={onClose} footer={footer}>
        {/* ── HEADER ────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start gap-3 px-4 pt-1.5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-extrabold" style={{ color: INK, letterSpacing: "-0.025em" }}>
              {product.label}
            </h2>
            {selectionLine ? (
              <p className="truncate text-[11.5px] font-extrabold uppercase"
                 style={{ color: VIOLET, letterSpacing: ".06em" }}>
                {selectionLine}
              </p>
            ) : (
              <p className="truncate text-[11.5px] text-neutral-400">{product.family}</p>
            )}
          </div>
          <button
            type="button" aria-label="Close" onClick={onClose}
            className="flex shrink-0 items-center justify-center rounded-full"
            style={{ width: 30, height: 30, background: "#F1F0F4" }}
          >
            <X className="h-4 w-4 text-neutral-500" strokeWidth={2.5} />
          </button>
        </div>

        {matrixMode ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FlatBody options={options} pack={flatPack} matrix={matrix} onStep={stepCell} />
          </div>
        ) : (
        <>
        {/* ── TABS — Base first, then Shade; each only if its list exists ── */}
        {showTabs && !hasVariants && (
          <div className="flex shrink-0 gap-5 px-4">
            {hasBases && <TabButton label="Base" active={tab === "base"} onClick={() => switchTab("base")} />}
            {hasShades && <TabButton label="Shade" active={tab === "shade"} onClick={() => switchTab("shade")} />}
          </div>
        )}

            {shadeSearchOpen ? (
              <div className="shrink-0 px-4 pt-3 pb-3" style={{ borderBottom: `1px solid ${RULE}` }}>
                <div className="flex items-center gap-2 rounded-[12px] px-3" style={{ background: SEARCH_BG }}>
                  <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2.5} />
                  <input
                    type="text" inputMode="search" autoComplete="off" autoFocus
                    value={shadeQuery}
                    onChange={(e) => setShadeQuery(e.target.value)}
                    placeholder="Type a shade name"
                    className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] outline-none placeholder:text-neutral-400"
                    style={{ color: INK }}
                  />
                  <button
                    type="button" aria-label="Back to the short list"
                    onClick={() => { setExpanded(false); setShadeQuery(""); }}
                    className="shrink-0 text-[12.5px] font-extrabold" style={{ color: VIOLET }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (hasVariants || activeList.length > 0) && (
              <div className="shrink-0 px-4 pt-3 pb-3" style={{ borderBottom: `1px solid ${RULE}` }}>
                <div className="flex flex-wrap gap-2">
                  {activeList.map((opt) => (
                    colourRow
                      ? <ShadeSwatch
                          key={opt.value}
                          name={opt.value}
                          hex={shadeHex(opt.value) as string}
                          selected={selected === opt.value}
                          onSelect={() => selectOption(opt.value)}
                        />
                      : <button
                          key={opt.value}
                          type="button"
                          onClick={() => selectOption(opt.value)}
                          className="px-3 py-2 text-left text-[13px] font-semibold"
                          style={chipStyle(selected === opt.value)}
                        >
                          {showingBases ? baseChipLabel(opt.value) : opt.value}
                        </button>
                  ))}
                  {/* + More only where the catalog has more to give — never on
                      a variant row, which is already the complete set. */}
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      className="px-3 py-2 text-[10.5px] font-extrabold"
                      style={chipStyle(false, true)}
                    >
                      + More
                    </button>
                  )}
                </div>
              </div>
            )}

            {shadeSearchOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {shadeMatches.length === 0 ? (
                  <p className="px-4 py-10 text-center text-[13px] text-neutral-400">
                    No shade matches {shadeQuery.trim()}
                  </p>
                ) : shadeMatches.map((opt) => {
                  const hex = shadeHex(opt.value);
                  return (
                    <button
                      key={opt.value} type="button"
                      onClick={() => { selectOption(opt.value); setExpanded(false); setShadeQuery(""); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
                      style={{ borderTop: `1px solid ${RULE}` }}
                    >
                      {hex && (
                        <span className="shrink-0" style={{
                          width: 22, height: 22, borderRadius: 6, background: hex,
                          border: isLightHex(hex) ? "1px solid rgba(0,0,0,.15)" : "none",
                        }} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" style={{ color: INK }}>
                        {opt.value}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1">
              {selectedRow ? (
                packLabels.map((label) => (
                  <PackRow
                    key={label}
                    label={label}
                    step={stepForLabel(label)}
                    qty={qtys[label] ?? 0}
                    onStep={(dir) => step(label, dir)}
                  />
                ))
              ) : (
                <p className="px-2 py-8 text-center text-[13px] text-neutral-400">
                  {hasVariants ? "Pick an option to see pack sizes." : "Pick a shade to see pack sizes."}
                </p>
              )}
            </div>
            )}
        </>
        )}
    </V2Sheet>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function TabButton({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button" onClick={onClick}
      className="pb-2 text-[15px] font-extrabold"
      style={{ color: active ? INK : "#9A96A6", borderBottom: `2.5px solid ${active ? VIOLET : "transparent"}` }}
    >
      {label}
    </button>
  );
}

/**
 * One pack row. The "per N" sub-label comes from the copied depot step table,
 * and is HIDDEN when the step is 1 — a drum has no box, so "per 1" would be
 * noise dressed as information.
 */
function PackRow({ label, step, qty, onStep }: {
  label: string; step: number; qty: number; onStep: (direction: 1 | -1) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[16px] font-extrabold leading-tight" style={{ color: INK }}>{label}</p>
        {step > 1 && (
          <p className="font-mono text-[11px] leading-tight text-neutral-400">per {step}</p>
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
        <span
          className="w-8 text-center font-mono text-[16px] font-extrabold tabular-nums"
          style={{ color: qty === 0 ? "#C9C6D2" : INK }}
        >
          {qty}
        </span>
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
 * A shade as a 54x44 block of the colour itself, no text inside.
 *
 * The NAME is not lost — it lands in the drawer's header sub-line the moment
 * this is selected, which is where the confirmation belongs. A caption under
 * every swatch would just rebuild the text row the colour is replacing.
 *
 * A near-white fill gets a faint inner border, or a white chip on a white
 * sheet is simply not there. `title`/`aria-label` carry the name for anyone
 * who cannot use the colour at all.
 */
function ShadeSwatch({ name, hex, selected, onSelect }: {
  name: string; hex: string; selected: boolean; onSelect: () => void;
}): React.JSX.Element {
  const light = isLightHex(hex);
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={selected}
      title={name}
      onClick={onSelect}
      style={{
        width: 54, height: 44, borderRadius: 11, background: hex,
        border: light ? "1px solid rgba(0,0,0,.15)" : "none",
        boxShadow: selected ? `0 0 0 5px ${VIOLET_BG}, 0 0 0 7.5px ${VIOLET}` : undefined,
      }}
    />
  );
}

// ── FLAT MODE ──────────────────────────────────────────────────────────────
/**
 * 2+ options, ONE pack. Every option on screen at once with its own stepper —
 * no option-selection step, no pack step, one screen.
 *
 * Applies to M900 (20L), Acotone, Machine Tinter and GVA (1L each). M900's 12
 * rows overflow the 88dvh cap and scroll VERTICALLY inside the sheet, which is
 * expected: only horizontal scroll is banned.
 *
 * The pack size is not repeated per row — it is stated once in the header,
 * because repeating "1L" fourteen times is noise, not information.
 */
function FlatBody({ options, pack, matrix, onStep }: {
  options: V2Option[];
  pack: string;
  matrix: Record<string, Record<string, number>>;
  onStep: (option: string, pack: string, direction: 1 | -1) => void;
}): React.JSX.Element {
  return (
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
            <Stepper qty={qty} onStep={(d) => onStep(opt.value, pack, d)} label={`${opt.value} ${pack}`} />
          </div>
        );
      })}
    </div>
  );
}

/** The full-row stepper, used by FLAT mode. */
function Stepper({ qty, onStep, label }: {
  qty: number; onStep: (direction: 1 | -1) => void; label: string;
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
      <span
        className="w-8 text-center font-mono text-[16px] font-extrabold tabular-nums"
        style={{ color: qty === 0 ? "#C9C6D2" : INK }}
      >
        {qty}
      </span>
      <button
        type="button" aria-label={`Add one box of ${label}`} onClick={() => onStep(1)}
        className={`flex ${btn} items-center justify-center rounded-full`}
      >
        <Plus className={icon} strokeWidth={3} style={{ color: INK }} />
      </button>
    </div>
  );
}
