"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import {
  ALL_BASES, INK, RULE, SCRIM, SEARCH_BG, VIOLET, VIOLET_BG,
  formatPack, stepForLabel, unitsIn,
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

// Slide-up + fade, and the sheet's height cap. A scoped <style> tag rather
// than an entry in globals.css — same containment rule as the colours. Class
// names are v2-prefixed so they cannot collide. prefers-reduced-motion
// disables both animations outright.
//
// Height is AUTO, capped at 88% of the viewport, so a product with no options
// and four packs opens as a short sheet. `dvh` is the correct unit on a phone
// because `vh` measures the viewport with the toolbar COLLAPSED; @supports
// keeps the vh value on engines that lack it.
const SHEET_CSS = `
@keyframes v2SheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes v2ScrimIn { from { opacity: 0; } to { opacity: 1; } }
.v2-sheet { animation: v2SheetUp .26s cubic-bezier(.32,.72,0,1) both; max-height: 88vh; }
.v2-scrim { animation: v2ScrimIn .2s ease-out both; }
@supports (max-height: 88dvh) { .v2-sheet { max-height: 88dvh; } }
@media (prefers-reduced-motion: reduce) {
  .v2-sheet, .v2-scrim { animation: none; }
}
`;

type Tab = "base" | "shade";

/** Shared chip shell. Selected is an OUTLINE + tint, never a solid violet fill. */
function chipStyle(selected: boolean, dashed = false): React.CSSProperties {
  return {
    border:       `1.5px ${dashed ? "dashed" : "solid"} ${selected ? VIOLET : RULE}`,
    borderRadius: 11,
    background:   selected ? VIOLET_BG : "#fff",
    color:        INK,
  };
}

export default function ProductDrawer({
  product,
  onClose,
  onAdd,
}: {
  product: V2Resolved;
  onClose: () => void;
  onAdd: (line: { option: string | null; row: ApiProduct; qtys: Record<string, number> }) => void;
}): React.JSX.Element {
  const hasBases    = product.bases.length > 0;
  const hasShades   = product.shades.length > 0;
  const hasVariants = product.variants.length > 0;
  // A tab appears only if its list is non-empty; neither list -> no tabs.
  const showTabs = hasBases || hasShades;

  const [tab, setTab] = useState<Tab>(hasBases ? "base" : "shade");
  // ONE selection, whichever row it came from. Top base pre-selected; shade
  // and variant never are — so a shade-only or variant product opens with no
  // pack rows until the salesman commits to one, which is correct: the packs
  // are that row's packs, and there is no row yet.
  const [selected, setSelected] = useState<string | null>(
    hasBases ? (product.bases[0]?.value ?? null) : null,
  );
  const [qtys, setQtys]         = useState<Record<string, number>>({});
  const [moreOpen, setMoreOpen] = useState(false);

  // Lock the board behind the scrim; put the salesman back where he was on
  // close. Local to this component by design — no global provider.
  //
  // `position: fixed` on <body>, not `overflow: hidden`: iOS Safari ignores
  // overflow-hidden on body and keeps scrolling the page under the sheet.
  // Fixing the body collapses its scroll to zero, so the offset is stashed in
  // `top` and handed back to window.scrollTo on cleanup. Each property is read
  // first and restored individually, so this cannot clobber another style.
  useEffect(() => {
    const body = document.body;
    const y = window.scrollY;
    const prev = {
      position: body.style.position, top: body.style.top,
      left: body.style.left, right: body.style.right, width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top      = `-${y}px`;
    body.style.left     = "0";
    body.style.right    = "0";
    body.style.width    = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top      = prev.top;
      body.style.left     = prev.left;
      body.style.right    = prev.right;
      body.style.width    = prev.width;
      window.scrollTo(0, y);
    };
  }, []);

  // Which options are on show right now, and which row that resolves to.
  const activeList: V2Option[] = hasVariants
    ? product.variants
    : tab === "base" ? product.bases : product.shades;

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
    setMoreOpen(false);
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
  const units = unitsIn(qtys);
  const needsVariant = hasVariants && selected === null;
  const needsShade   = !hasVariants && tab === "shade" && selected === null;
  const canAdd = units > 0 && selectedRow !== null && !needsVariant && !needsShade;

  let addLabel: string;
  if (needsVariant)    addLabel = "Interior or exterior?";
  else if (needsShade) addLabel = "Pick a shade";
  else if (!canAdd)    addLabel = "Add to order";
  else                 addLabel = `Add · ${units} units`;

  // Sub-line: the chosen option, else the grey board family.
  const selectionLine = product.noOptionRow ? null : selected;

  return (
    <div className="fixed inset-0 z-50">
      <style>{SHEET_CSS}</style>

      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="v2-scrim absolute inset-0 h-full w-full cursor-default"
        style={{ background: SCRIM }}
      />

      <section
        className="v2-sheet absolute inset-x-0 bottom-0 flex flex-col overflow-hidden bg-white"
        style={{
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          boxShadow: "0 -8px 32px rgba(18,14,26,.16)",
        }}
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1">
          <span className="block rounded-full" style={{ width: 38, height: 4.5, background: "#DEDCE3" }} />
        </div>

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

        {moreOpen ? (
          // ── "+ MORE" — replaces control block AND body in place. Static
          //    this step; search lands in step 7.
          <div className="min-h-0 overflow-y-auto">
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 rounded-[12px] px-3 py-2.5" style={{ background: SEARCH_BG }}>
                <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2.5} />
                <span className="truncate text-[14px] text-neutral-400">
                  {tab === "base" ? "Search base" : "Type a shade name"}
                </span>
              </div>
            </div>
            {tab === "base" ? (
              <div className="grid grid-cols-3 gap-2 px-4 pt-3 pb-4">
                {ALL_BASES.map((b) => (
                  <button key={b.code} type="button" className="min-w-0 px-3 py-1.5 text-center"
                          style={chipStyle(false)}>
                    <span className="block text-[15px] font-extrabold leading-tight">{b.code}</span>
                    <span className="block text-[8.5px] font-extrabold leading-tight text-neutral-400"
                          style={{ letterSpacing: ".08em" }}>{b.word}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-6 pt-8 pb-8 text-center text-[13px] leading-relaxed text-neutral-400">
                Type any shade name — golden, black, ivory.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* ── CONTROL BLOCK ─────────────────────────────────────────── */}
            {(hasVariants || activeList.length > 0) && (
              <div className="shrink-0 px-4 pt-3 pb-3" style={{ borderBottom: `1px solid ${RULE}` }}>
                <div className="flex flex-wrap gap-2">
                  {activeList.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => selectOption(opt.value)}
                      className="px-3 py-2 text-left text-[13px] font-semibold"
                      style={chipStyle(selected === opt.value)}
                    >
                      {opt.value}
                    </button>
                  ))}
                  {/* + More only where the catalog has more to give — never on
                      a variant row, which is already the complete set. */}
                  {!hasVariants && (
                    <button
                      type="button"
                      onClick={() => setMoreOpen(true)}
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
            <div className="min-h-0 overflow-y-auto px-4 py-1">
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
          </>
        )}

        {/* ── FOOTER ────────────────────────────────────────────────────── */}
        <div
          className="flex shrink-0 gap-2 px-4 pt-3"
          style={{ borderTop: `1px solid ${RULE}`, paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
        >
          {moreOpen ? (
            <button
              type="button" onClick={() => setMoreOpen(false)}
              className="w-full rounded-[13px] py-3 text-[15px] font-extrabold"
              style={{ border: `1.5px solid ${RULE}`, color: INK }}
            >
              Back
            </button>
          ) : (
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
          )}
        </div>
      </section>
    </div>
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
