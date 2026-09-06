"use client";

import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import V2Sheet from "./v2-sheet";
import {
  INK, RULE, VIOLET, VIOLET_BG,
  baseChipLabel, chipStyle, formatPack, isLightHex, shadeHex, shadeRowMode,
  stepForLabel, unitsIn,
  type ApiProduct, type V2Option, type V2Resolved,
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
  allOptions,
}: {
  product: V2Resolved;
  /** Opened from a search hit: this exact option starts selected. */
  initialOption?: string | null;
  onClose: () => void;
  onAdd: (line: { option: string | null; row: ApiProduct; qtys: Record<string, number> }) => void;
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
  allOptions?: V2Option[];
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
    if (hasBases)  return "base";
    if (hasShades) return "shade";
    return "base";
  });
  // ONE selection, whichever list it came from. Top base pre-selected; shade
  // and variant never are, so a shade-only or variant product opens with no
  // pack rows until the salesman commits to one — correct, because the packs
  // belong to the ROW and there is no row yet.
  const [selected, setSelected] = useState<string | null>(
    initialOption ?? (hasBases ? (product.bases[0]?.value ?? null) : null),
  );
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState(false);

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
  // Expanding replaces the chip row with the product's full option set.
  const activeList: V2Option[] = expanded && allOptions ? allOptions : curatedList;
  // "+ More" earns its place only when there is genuinely more to show.
  const hasMore = !hasVariants && !expanded
    && !!allOptions && allOptions.length > curatedList.length;

  const selectedRow: ApiProduct | null =
    product.noOptionRow ?? activeList.find((o) => o.value === selected)?.row ?? null;

  const packLabels = selectedRow
    ? selectedRow.packs.map((p) => formatPack(p.packCode, p.unit))
    : [];

  // Switching tabs clears the selection and every quantity. Coming back to
  // Base re-applies the top-base pre-select, keeping that rule true whenever
  // the base row is on screen.
  function switchTab(next: Tab): void {
    if (next === tab) return;
    setTab(next);
    setSelected(next === "base" ? (product.bases[0]?.value ?? null) : null);
    setQtys({});
    setExpanded(false);
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
  const canAdd = units > 0 && selectedRow !== null && !needsVariant && !needsShade;

  let addLabel: string;
  if (needsVariant)    addLabel = "Interior or exterior?";
  else if (needsShade) addLabel = "Pick a shade";
  else if (!canAdd)    addLabel = "Add to order";
  else                 addLabel = `Add · ${units} units`;

  // Sub-line: the chosen option, else the grey board family.
  const selectionLine = product.noOptionRow ? null : selected;

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
        onClick={() => canAdd && selectedRow && onAdd({ option: selected, row: selectedRow, qtys })}
        className="min-w-0 flex-1 truncate rounded-[13px] py-3 text-[15px] font-extrabold text-white"
        style={{ background: canAdd ? VIOLET : "#C9C6D2" }}
      >
        {addLabel}
      </button>
    </>
  );

  return (
    <V2Sheet onClose={onClose} footer={footer} fixedHeight>
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

        {/* ── TABS — Base first, then Shade; each only if its list exists ── */}
        {showTabs && !hasVariants && (
          <div className="flex shrink-0 gap-5 px-4">
            {hasBases && <TabButton label="Base" active={tab === "base"} onClick={() => switchTab("base")} />}
            {hasShades && <TabButton label="Shade" active={tab === "shade"} onClick={() => switchTab("shade")} />}
          </div>
        )}

            {/* ── CONTROL BLOCK ─────────────────────────────────────────── */}
            {(hasVariants || activeList.length > 0) && (
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

            {/* ── BODY — the SELECTED ROW's packs, straight from the payload ── */}
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
