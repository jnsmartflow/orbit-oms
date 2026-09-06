"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import {
  ALL_BASES, INK, RULE, SCRIM, SEARCH_BG, VIOLET, VIOLET_BG,
  stepFor, unitsIn,
  type V2Base, type V2Pack, type V2Product,
} from "./v2-data";

// Hidden v2 product drawer — the bottom sheet a board tile opens.
//
// 🔴 CONTAINMENT — lives entirely inside app/po-v2-8f4kd2/, imports only from
// ./v2-data and node_modules. Nothing from lib/ or app/po/ (step 5 does that),
// no localStorage, no fetch. Every colour is an inline style, so globals.css
// and tailwind.config.ts stay untouched and v2 deletes in one command.
//
// State is intentionally LOCAL and unmounted with the sheet: the page renders
// this component with `key={tile.sap}`, so opening a different tile gives a
// fresh drawer rather than leaking the previous product's selections.
//
// NO HORIZONTAL SCROLL: every chip row is `flex-wrap`, never a scroller.

// The slide-up + fade, plus the sheet's height cap. A scoped <style> tag
// rather than an entry in globals.css — same containment rule as the colours.
// Class names are v2-prefixed so they cannot collide with anything else in
// the app. prefers-reduced-motion disables both animations outright.
//
// The sheet's height is AUTO, capped at 88% of the viewport: a short product
// (Cement SB — no variants, no bases, four packs) opens as a short sheet
// instead of a tall mostly-empty one. `dvh` is the correct unit on a phone
// because `vh` measures the viewport with the browser toolbar COLLAPSED, so a
// vh-sized sheet is taller than what you can actually see. It is applied
// through @supports so older engines keep the vh value rather than nothing.
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

/** Shared chip shell — variants, bases and shades all use this exact border,
 *  radius and fill. Selected is an OUTLINE + tint, never a solid violet fill. */
function chipStyle(selected: boolean, dashed = false): React.CSSProperties {
  return {
    border:      `1.5px ${dashed ? "dashed" : "solid"} ${selected ? VIOLET : RULE}`,
    borderRadius: 11,
    background:  selected ? VIOLET_BG : "#fff",
    color:       INK,
  };
}

export default function ProductDrawer({
  product,
  onClose,
  onAdd,
}: {
  product: V2Product;
  onClose: () => void;
  onAdd: (line: {
    variant: string | null;
    base:    string | null;
    shade:   string | null;
    qtys:    Record<string, number>;
  }) => void;
}): React.JSX.Element {
  // Tabs exist only when the product carries BOTH bases and shades (Gloss).
  const hasTabs = product.bases.length > 0 && product.shades.length > 0;

  const [tab,     setTab]     = useState<Tab>("base");
  const [variant, setVariant] = useState<string | null>(null);
  // "Pre-select the FIRST base" — applied on mount, and re-applied whenever the
  // base row becomes visible again (tab switch back, non-Primer variant).
  const [base,    setBase]    = useState<string | null>(product.bases[0]?.code ?? null);
  const [shade,   setShade]   = useState<string | null>(null);
  const [qtys,    setQtys]    = useState<Record<string, number>>({});
  const [moreOpen, setMoreOpen] = useState(false);

  // Lock the board behind the scrim, and put the salesman back exactly where
  // he was on close. Local to this component by design — no global provider.
  //
  // `position: fixed` on <body>, not `overflow: hidden`: iOS Safari ignores
  // overflow-hidden on body and keeps scrolling the page under the sheet.
  // Fixing the body collapses its scroll to zero, so the offset is stashed in
  // `top` and handed back to window.scrollTo on cleanup. Every property that
  // is touched is read first and restored, rather than reset to "", so this
  // cannot clobber a style someone else set.
  useEffect(() => {
    const body = document.body;
    const y = window.scrollY;
    const prev = {
      position: body.style.position,
      top:      body.style.top,
      left:     body.style.left,
      right:    body.style.right,
      width:    body.style.width,
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

  // A primer takes no base, so the whole base row disappears for those
  // variants. The stored base is CLEARED too, not just hidden — leaving it set
  // would let the header sub-line advertise a base the line does not carry.
  const variantIsPrimer = !!variant && variant.toLowerCase().includes("primer");
  const showBaseRow = tab === "base" && product.bases.length > 0 && !variantIsPrimer;
  const showShadeRow = tab === "shade" && product.shades.length > 0;

  function selectVariant(next: string): void {
    const isPrimer = next.toLowerCase().includes("primer");
    setVariant(next);
    if (isPrimer) setBase(null);
    else if (base === null) setBase(product.bases[0]?.code ?? null);
  }

  // Switching tabs clears the current selection and every quantity.
  function switchTab(next: Tab): void {
    if (next === tab) return;
    setTab(next);
    setShade(null);
    setBase(next === "base" ? (product.bases[0]?.code ?? null) : null);
    setQtys({});
    setMoreOpen(false);
  }

  // One tap moves a WHOLE BOX. The value shown stays in units, so 1L reads
  // 0 -> 6 -> 12 and 20L (a drum, step 1) reads 0 -> 1 -> 2. Floors at 0.
  function step(pack: V2Pack, direction: 1 | -1): void {
    const delta = stepFor(pack) * direction;
    setQtys((prev) => ({
      ...prev,
      [pack.size]: Math.max(0, (prev[pack.size] ?? 0) + delta),
    }));
  }

  // ── Footer gating ────────────────────────────────────────────────────────
  const units = unitsIn(qtys);
  const needsVariant = product.variants.length > 0 && variant === null;
  const needsShade   = tab === "shade" && shade === null;
  const canAdd = units > 0 && !needsVariant && !needsShade;

  // Units only — no box figure anywhere in v2. See unitsIn()'s note.
  let addLabel: string;
  if (needsVariant)    addLabel = "Interior or exterior?";
  else if (needsShade) addLabel = "Pick a shade";
  else if (!canAdd)    addLabel = "Add to order";
  else                 addLabel = `Add · ${units} units`;

  // Header sub-line: whichever of the selections are set, joined by " · ".
  // The second slot is the SHADE on the Shade tab and the BASE otherwise —
  // they are alternatives, never both, because the base row is hidden on the
  // Shade tab. Empty string falls back to the grey category.
  const selectionLine = [variant, tab === "shade" ? shade : base]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fixed inset-0 z-50">
      <style>{SHEET_CSS}</style>

      {/* Scrim — tapping anywhere outside the sheet closes it. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="v2-scrim absolute inset-0 h-full w-full cursor-default"
        style={{ background: SCRIM }}
      />

      {/* Sheet */}
      {/* Height is AUTO — no `top`. The cap lives in .v2-sheet (88dvh/88vh),
          so a short product opens as a short sheet and only a tall one grows
          to the cap and scrolls internally. */}
      <section
        className="v2-sheet absolute inset-x-0 bottom-0 flex flex-col overflow-hidden bg-white"
        style={{
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          boxShadow: "0 -8px 32px rgba(18,14,26,.16)",
        }}
      >
        {/* Grab bar */}
        <div className="flex shrink-0 justify-center pt-2.5 pb-1">
          <span
            className="block rounded-full"
            style={{ width: 38, height: 4.5, background: "#DEDCE3" }}
          />
        </div>

        {/* ── HEADER ────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start gap-3 px-4 pt-1.5 pb-3">
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-[18px] font-extrabold"
              style={{ color: INK, letterSpacing: "-0.025em" }}
            >
              {product.name}
            </h2>
            {selectionLine ? (
              <p
                className="truncate text-[11.5px] font-extrabold uppercase"
                style={{ color: VIOLET, letterSpacing: ".06em" }}
              >
                {selectionLine}
              </p>
            ) : (
              <p className="truncate text-[11.5px] text-neutral-400">{product.category}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex shrink-0 items-center justify-center rounded-full"
            style={{ width: 30, height: 30, background: "#F1F0F4" }}
          >
            <X className="h-4 w-4 text-neutral-500" strokeWidth={2.5} />
          </button>
        </div>

        {/* ── TABS (Gloss only — needs both bases and shades) ───────────── */}
        {hasTabs && (
          <div className="flex shrink-0 gap-5 px-4">
            {(["base", "shade"] as const).map((t) => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchTab(t)}
                  className="pb-2 text-[15px] font-extrabold capitalize"
                  style={{
                    color: active ? INK : "#9A96A6",
                    borderBottom: `2.5px solid ${active ? VIOLET : "transparent"}`,
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}

        {moreOpen ? (
          // ── "+ MORE" STATE — replaces control block AND body in place ──
          <div className="min-h-0 overflow-y-auto">
            <div className="px-4 pt-3">
              {/* Static by spec — a div, not an <input>. Nothing is focusable. */}
              <div
                className="flex items-center gap-2 rounded-[12px] px-3 py-2.5"
                style={{ background: SEARCH_BG }}
              >
                <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2.5} />
                <span className="truncate text-[14px] text-neutral-400">
                  {tab === "base" ? "Search base" : "Type a shade name"}
                </span>
              </div>
            </div>

            {tab === "base" ? (
              <div className="grid grid-cols-3 gap-2 px-4 pt-3 pb-4">
                {ALL_BASES.map((b) => (
                  <BaseChip
                    key={b.code}
                    base={b}
                    selected={base === b.code}
                    onSelect={() => {
                      setBase(b.code);
                      setMoreOpen(false);
                    }}
                  />
                ))}
              </div>
            ) : (
              // Shade "+ More" is deliberately EMPTY — no palette, by spec.
              <p className="px-6 pt-8 text-center text-[13px] leading-relaxed text-neutral-400">
                Type any shade name — golden, black, ivory.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* ── CONTROL BLOCK ─────────────────────────────────────────── */}
            <div
              className="shrink-0 px-4 pt-3 pb-3"
              style={{ borderBottom: `1px solid ${RULE}` }}
            >
              {/* a) VARIANTS — full words, nothing pre-selected. */}
              {product.variants.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => selectVariant(v)}
                      className="px-3 py-2 text-[13px] font-semibold"
                      style={chipStyle(variant === v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}

              {/* b) BASES — hidden entirely for a Primer variant. */}
              {showBaseRow && (
                <div
                  className={`flex flex-wrap gap-2 ${product.variants.length > 0 ? "mt-2" : ""}`}
                >
                  {product.bases.map((b) => (
                    <BaseChip
                      key={b.code}
                      base={b}
                      selected={base === b.code}
                      onSelect={() => setBase(b.code)}
                    />
                  ))}
                  <MoreChip onClick={() => setMoreOpen(true)} />
                </div>
              )}

              {/* c) SHADES — colour blocks, no text, nothing pre-selected. */}
              {showShadeRow && (
                <div className="flex flex-wrap gap-2">
                  {product.shades.map((s) => {
                    const selected = shade === s.name;
                    return (
                      <button
                        key={s.name}
                        type="button"
                        aria-label={s.name}
                        title={s.name}
                        onClick={() => setShade(s.name)}
                        style={{
                          width: 52,
                          height: 42,
                          borderRadius: 11,
                          background: s.hex,
                          border: `1.5px solid ${selected ? VIOLET : RULE}`,
                          boxShadow: selected ? `0 0 0 2.5px ${VIOLET_BG}, 0 0 0 4px ${VIOLET}` : undefined,
                        }}
                      />
                    );
                  })}
                  <MoreChip onClick={() => setMoreOpen(true)} tall />
                </div>
              )}
            </div>

            {/* ── BODY — one row per pack ───────────────────────────────── */}
            <div className="min-h-0 overflow-y-auto px-4 py-1">
              {product.packs.map((pack) => (
                <PackRow
                  key={pack.size}
                  pack={pack}
                  qty={qtys[pack.size] ?? 0}
                  onStep={(dir) => step(pack, dir)}
                />
              ))}
            </div>
          </>
        )}

        {/* ── FOOTER ────────────────────────────────────────────────────── */}
        <div
          className="flex shrink-0 gap-2 px-4 pt-3"
          style={{
            borderTop: `1px solid ${RULE}`,
            paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
          }}
        >
          {moreOpen ? (
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="w-full rounded-[13px] py-3 text-[15px] font-extrabold"
              style={{ border: `1.5px solid ${RULE}`, color: INK }}
            >
              Back
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-[13px] px-5 py-3 text-[15px] font-extrabold"
                style={{ border: `1.5px solid ${RULE}`, color: INK }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canAdd}
                onClick={() => canAdd && onAdd({ variant, base, shade, qtys })}
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

/** Base chip: code above, word below. Same shell as every other chip. */
function BaseChip({
  base, selected, onSelect,
}: { base: V2Base; selected: boolean; onSelect: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="min-w-0 px-3 py-1.5 text-center"
      style={chipStyle(selected)}
    >
      <span className="block text-[15px] font-extrabold leading-tight">{base.code}</span>
      <span
        className="block text-[8.5px] font-extrabold leading-tight text-neutral-400"
        style={{ letterSpacing: ".08em" }}
      >
        {base.word}
      </span>
    </button>
  );
}

/** The dashed "+ More" chip. `tall` matches the 42px shade blocks. */
function MoreChip({ onClick, tall = false }: { onClick: () => void; tall?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 text-[10.5px] font-extrabold"
      style={{ ...chipStyle(false, true), height: tall ? 42 : undefined, paddingTop: tall ? 0 : 6, paddingBottom: tall ? 0 : 6 }}
    >
      + More
    </button>
  );
}

/** One pack row: size + "per N" on the left, a stepper pill on the right. */
function PackRow({
  pack, qty, onStep,
}: { pack: V2Pack; qty: number; onStep: (direction: 1 | -1) => void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[16px] font-extrabold leading-tight" style={{ color: INK }}>
          {pack.size}
        </p>
        {pack.per !== null && (
          <p className="font-mono text-[11px] leading-tight text-neutral-400">per {pack.per}</p>
        )}
      </div>

      <div
        className="flex shrink-0 items-center rounded-full"
        style={{ border: `1px solid ${RULE}` }}
      >
        <button
          type="button"
          aria-label={`Remove one ${pack.size}`}
          disabled={qty === 0}
          onClick={() => onStep(-1)}
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
          type="button"
          aria-label={`Add one ${pack.size}`}
          onClick={() => onStep(1)}
          className="flex h-9 w-9 items-center justify-center rounded-full"
        >
          <Plus className="h-4 w-4" strokeWidth={3} style={{ color: INK }} />
        </button>
      </div>
    </div>
  );
}
