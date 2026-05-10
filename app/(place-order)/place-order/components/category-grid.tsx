"use client";

import { Fragment, useMemo, useState } from "react";
import type { Product } from "../types";

// Photo-first category grid.
//
// Derives categories from `products` by grouping on family. Cards sort by
// SKU count descending; the top 9 get a keyboard digit badge (1-9). Photos
// load from /category-images/{slug}.png with onError → letter monogram
// fallback (planning doc §6.2). The 11 starter photos are already in the
// repo; AUTO and any unknown family fall back to the monogram cleanly.
//
// Phase 4 adds:
//   - active-card teal-600 border (hand-off to the panel below)
//   - inline `renderExpanded` slot inserted after the active card's row
//   - imageFailed map exposed via getImageState so the panel can render the
//     same fallback (image vs monogram) the card shows
//
// Phase 5 wires keyboard 1-9 to onCategoryClick.

const COLS_DEFAULT = 4;  // matches the responsive grid; ≥1700px goes to 5
                          // cols visually but the inline panel still spans
                          // full width via col-span-full, so JS COLS only
                          // affects the row-aware insertion of the panel.

interface CategoryGridProps {
  products:          Product[];
  onCategoryClick?:  (family: string) => void;
  expandedFamily?:   string | null;
  renderExpanded?:   (family: string, imageSlug: string, imageFailed: boolean) => React.ReactNode;
}

type CategoryEntry = {
  family:           string;
  productCount:     number;
  skuCount:         number;
  isSingleProduct:  boolean;     // exactly one distinct subProduct
  colourCount:      number;      // distinct baseColour values
};

// Per-family dot colours from the v4 mockup. Covers the 12 known families;
// anything outside this map gets a neutral gray.
const DOT_COLOR_BY_FAMILY: Record<string, string> = {
  WS:             "#3b82c4",
  GLOSS:          "#d97706",
  VT:             "#8b1e3f",
  SADOLIN:        "#a16207",
  WEATHERCOAT:    "#0284c7",
  DULUX:          "#5d9b4f",
  PROMISE:        "#3b82f6",
  AQUATECH:       "#7a8b9c",
  SATIN:          "#7c3aed",
  AUTO:           "#1f2937",
  SUPERCLEAN:     "#fbc52d",
  PROMISE_ENML:   "#9d174d",
  "PROMISE ENML": "#9d174d",
};

function dotColorForFamily(family: string): string {
  return DOT_COLOR_BY_FAMILY[family] ?? DOT_COLOR_BY_FAMILY[family.toUpperCase()] ?? "#9ca3af";
}

// /category-images/<slug>.png — slug is family lowercased with non-alphanumeric
// runs collapsed to underscore. So "PROMISE ENML" / "PROMISE_ENML" both → "promise_enml".
function imageSlugForFamily(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// First 2 chars of family for the monogram (uppercase). "AUTO" → "AU",
// "PROMISE_ENML" → "PR". Falls back to "?" for empty.
function monogramForFamily(family: string): string {
  const trimmed = family.replace(/[^A-Za-z0-9]/g, "");
  if (trimmed.length === 0) return "?";
  return trimmed.slice(0, 2).toUpperCase();
}

export default function CategoryGrid({
  products,
  onCategoryClick,
  expandedFamily = null,
  renderExpanded,
}: CategoryGridProps): React.JSX.Element {
  // Image-failed state per family — flips to true on <img> onError so we
  // render the monogram instead. AUTO is expected to flip immediately since
  // there's no auto.png on disk.
  const [imageFailed, setImageFailed] = useState<Record<string, boolean>>({});

  const categories = useMemo<CategoryEntry[]>(() => {
    const map = new Map<string, { products: Product[] }>();
    for (const p of products) {
      let entry = map.get(p.family);
      if (!entry) {
        entry = { products: [] };
        map.set(p.family, entry);
      }
      entry.products.push(p);
    }
    const out: CategoryEntry[] = [];
    for (const [family, entry] of Array.from(map.entries())) {
      const list = entry.products;
      const distinctSubProducts = new Set(list.map((p) => p.subProduct));
      const distinctBaseColours = new Set(list.map((p) => p.baseColour ?? ""));
      const skuCount = list.reduce((acc, p) => acc + p.packs.length, 0);
      out.push({
        family,
        productCount:    distinctSubProducts.size,
        skuCount,
        isSingleProduct: distinctSubProducts.size === 1,
        colourCount:     distinctBaseColours.size,
      });
    }
    // Descending SKU count, family name asc as tiebreaker for stability.
    out.sort((a, b) => b.skuCount - a.skuCount || a.family.localeCompare(b.family));
    return out;
  }, [products]);

  // Row-aware panel insertion. Insert the expanded panel after the LAST card
  // in the active card's row so it appears directly below that row. Uses
  // COLS_DEFAULT=4 — at ≥1700px the visual grid is 5 cols but the panel still
  // renders correctly via col-span-full; insertion may land one card "early"
  // at that breakpoint (acceptable Phase 4 limitation).
  const activeIdx = expandedFamily
    ? categories.findIndex((c) => c.family === expandedFamily)
    : -1;
  const activeRow = activeIdx >= 0 ? Math.floor(activeIdx / COLS_DEFAULT) : -1;
  const panelAfterIdx = activeRow >= 0
    ? Math.min((activeRow + 1) * COLS_DEFAULT - 1, categories.length - 1)
    : -1;

  return (
    <div className="grid grid-cols-4 [@media(min-width:1700px)]:grid-cols-5 gap-3">
      {categories.map((cat, i) => {
        const showDigit       = i < 9;
        const digit           = showDigit ? String(i + 1) : null;
        const showColourBadge = cat.isSingleProduct && cat.colourCount > 1;
        const slug            = imageSlugForFamily(cat.family);
        const failed          = imageFailed[cat.family] === true;
        const isActive        = cat.family === expandedFamily;

        return (
          <Fragment key={cat.family}>
          <button
            type="button"
            onClick={() => onCategoryClick?.(cat.family)}
            className={`group relative flex flex-col h-[200px] bg-white border rounded-[12px] overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg text-left ${
              isActive ? "border-teal-600" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            {/* Photo zone — uniform light-gray, image OR monogram fallback. */}
            <div className="relative h-[130px] w-full flex items-center justify-center bg-[#fafbfc] border-b border-gray-100 overflow-hidden">
              {failed ? (
                <span
                  className="w-[90px] h-[90px] rounded-[14px] flex items-center justify-center text-white text-[24px] font-bold tracking-wide"
                  style={{ background: "linear-gradient(135deg, #374151, #111827)" }}
                >
                  {monogramForFamily(cat.family)}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/category-images/${slug}.png`}
                  alt={cat.family}
                  onError={() => setImageFailed((s) => ({ ...s, [cat.family]: true }))}
                  className="max-h-[110px] max-w-[110px] w-auto h-auto object-contain transition-transform duration-200 group-hover:scale-105"
                />
              )}

              {/* Top-right keyboard digit (frosted glass), top 9 only. */}
              {digit && (
                <span className="absolute top-[9px] right-[9px] w-[22px] h-[22px] rounded-[6px] bg-white/95 backdrop-blur-[4px] border border-gray-900/[.06] shadow-sm flex items-center justify-center text-[11px] font-semibold font-mono text-slate-600 z-[2]">
                  {digit}
                </span>
              )}

              {/* Bottom-left "N colours" badge for single-product categories. */}
              {showColourBadge && (
                <span className="absolute bottom-[9px] left-[9px] bg-slate-900/85 text-white text-[10px] font-medium px-2 py-[3px] rounded-[5px] z-[2]">
                  {cat.colourCount} colours
                </span>
              )}
            </div>

            {/* Info bar — dot + family + meta. */}
            <div className="flex-1 px-[14px] pt-[10px] pb-3 flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-[3px]">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: dotColorForFamily(cat.family) }}
                />
                <span className="text-[14px] font-semibold text-gray-900 leading-tight tracking-[0.005em]">
                  {cat.family}
                </span>
              </div>
              <span className="text-[11px] text-gray-500 font-mono leading-snug">
                {cat.productCount} product{cat.productCount === 1 ? "" : "s"} · {cat.skuCount} SKUs
              </span>
            </div>
          </button>
          {i === panelAfterIdx && expandedFamily && renderExpanded && (
            renderExpanded(
              expandedFamily,
              imageSlugForFamily(expandedFamily),
              imageFailed[expandedFamily] === true,
            )
          )}
          </Fragment>
        );
      })}
    </div>
  );
}
