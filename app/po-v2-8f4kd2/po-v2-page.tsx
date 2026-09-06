"use client";

import { Search, X } from "lucide-react";

// Hidden v2 salesman order page — STATIC BOARD. No data fetching, no
// localStorage, no email, no state, no handlers. Everything below is
// hard-coded on purpose.
//
// 🔴 CONTAINMENT — v2 must never modify anything outside app/po-v2-8f4kd2/.
// That is why every colour here is an INLINE STYLE and not a CSS variable:
// globals.css, tailwind.config.ts, middleware.ts, app/po/* and lib/* are all
// off limits, so deleting this one folder removes v2 entirely with no orphans.
// If v2 ever needs a shared helper changed, COPY it in here — never edit the
// original. The only outside code referenced is lucide-react (a node_modules
// dependency the app already uses), which modifies no project file.
//
// Tailwind here is 3.4.19, where `line-clamp` IS core — but the clamp below is
// written as an inline style anyway, so v2 keeps working regardless of what
// the shared Tailwind config does. Same reasoning as the tints.
//
// NO HORIZONTAL SCROLL is a hard requirement, and it is met structurally
// rather than by an overflow-x crutch: the grid is four equal `1fr` tracks,
// every grid cell and the header's text block carry `min-w-0` (grid/flex
// children default to `min-width:auto`, which is what actually causes runaway
// rows), and the two header lines truncate.

// ── Data ───────────────────────────────────────────────────────────────────
// `sap` is the REAL mo_order_form_index_v2 product name. It is carried now,
// unused and undisplayed, purely so step 5 can join tiles to catalog rows on
// it without re-typing the mapping. `label` is what the salesman reads.
// Verified spelling matters here: these strings are the join key, so a typo
// costs a silent no-match later, not a visible error now.

type V2Tile = {
  /** Shown on the tile. Short enough to fit two lines at 13px bold. */
  label: string;
  /** mo_order_form_index_v2.product — join key for step 5. NOT displayed. */
  sap: string;
};

type V2Family = {
  name: string;
  /** Tile background. Inline style, deliberately not a CSS variable. */
  tint: string;
  tiles: readonly V2Tile[];
};

const FAMILIES: readonly V2Family[] = [
  {
    name: "Enamel",
    tint: "#F8F0E0",
    tiles: [
      { label: "Gloss",          sap: "GLOSS" },
      { label: "Promise Enamel", sap: "PROMISE ENAMEL" },
      { label: "Super Satin",    sap: "SUPER SATIN" },
      { label: "M900",           sap: "M900 GLOSS" },
    ],
  },
  {
    name: "Interior",
    tint: "#E8EFFA",
    tiles: [
      { label: "Stay Bright",  sap: "SATIN STAY BRIGHT" },
      { label: "Supercover",   sap: "SUPERCOVER" },
      { label: "Pearl Glo",    sap: "VT PEARL GLO" },
      { label: "Platinum Glo", sap: "VT PLATINUM GLO" },
    ],
  },
  {
    name: "Promise",
    tint: "#FBECEF",
    tiles: [
      { label: "Smart Choice",   sap: "PROMISE SMARTCHOICE" },
      { label: "Promise Primer", sap: "PROMISE PRIMER" },
      { label: "Promise Int",    sap: "PROMISE INTERIOR" },
      { label: "Promise Ext",    sap: "PROMISE EXTERIOR" },
    ],
  },
  {
    name: "Exterior",
    tint: "#EAF4E8",
    tiles: [
      { label: "Dustproof",  sap: "WS PROTECT DUSTPROOF" },
      { label: "Hi-Sheen",   sap: "WS PROTECT HI-SHEEN" },
      { label: "Max",        sap: "WS MAX" },
      { label: "Powerflexx", sap: "WS POWERFLEXX" },
    ],
  },
  {
    name: "Primer",
    tint: "#E3F1F8",
    tiles: [
      { label: "Cement SB",   sap: "CEMENT PRIMER SB" },
      { label: "Zinc Yellow", sap: "ZINC YELLOW METAL PRIMER" },
      { label: "Red Oxide",   sap: "RED OXIDE METAL PRIMER" },
      { label: "Ext Acrylic", sap: "EXTERIOR ACRYLIC PRIMER" },
    ],
  },
  {
    name: "Stainer",
    tint: "#F6E8C8",
    tiles: [
      { label: "Acotone",        sap: "ACOTONE" },
      { label: "Uni Stainer",    sap: "UNIVERSAL STAINER" },
      { label: "Machine Tinter", sap: "MACHINE TINTER" },
      { label: "GVA",            sap: "GVA" },
    ],
  },
  {
    name: "Aquatech",
    tint: "#E0F1EA",
    tiles: [
      { label: "Damp 2in1",  sap: "DAMP PROTECT 2IN1" },
      { label: "Roof Coat",  sap: "ROOF COAT WHITE" },
      { label: "Crack 5mm",  sap: "CRACKFILLER 5MM" },
      { label: "Damp Base",  sap: "DAMP PROTECT BASECOAT" },
    ],
  },
  {
    name: "Wood",
    tint: "#EFE6DA",
    tiles: [
      { label: "2K Matt",      sap: "2K PU MATT" },
      { label: "Prime Matt",   sap: "PU PRIME MATT" },
      { label: "Prime Sealer", sap: "PU PRIME SEALER" },
      { label: "Thinner",      sap: "MULTI PURPOSE THINNER" },
    ],
  },
];

// ── Tokens (inline, never CSS variables — see the containment note above) ──
const RULE_COLOUR   = "#E9E7ED";   // top-bar border + heading rules
const SEARCH_BG     = "#F4F3F7";
const TILE_INK      = "#16151A";   // near-black tile text

// Two-line clamp. `wordBreak: "normal"` keeps words whole at every normal
// opportunity; `overflowWrap: "break-word"` is the last-resort escape that
// only fires when a SINGLE word cannot fit its line at all. Together that is
// "break at spaces, never mid-word" for every label in FAMILIES — the longest
// one-word label is "Powerflexx" (~72px at 13px bold) inside an ~80px tile.
const TILE_TEXT_STYLE: React.CSSProperties = {
  color:            TILE_INK,
  letterSpacing:    "-0.02em",
  display:          "-webkit-box",
  WebkitBoxOrient:  "vertical",
  WebkitLineClamp:  2,
  overflow:         "hidden",
  overflowWrap:     "break-word",
  wordBreak:        "normal",
};

export default function PoV2Page(): React.JSX.Element {
  return (
    <main className="min-h-screen w-full bg-white pb-6">
      {/* ── 1. TOP BAR ─────────────────────────────────────────────────── */}
      {/* No chevron anywhere in this bar, by spec. The X button is inert. */}
      <header
        className="sticky top-0 z-10 flex items-center gap-3 bg-white px-4 py-2.5"
        style={{ borderBottom: `1px solid ${RULE_COLOUR}` }}
      >
        {/* min-w-0 is what lets the two lines below actually truncate — a flex
            child defaults to min-width:auto and would otherwise push the row
            wider than the viewport. */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold tracking-tight text-violet-700">
            AMBIKA PAINTS
          </p>
          <p className="truncate font-mono text-[11px] text-neutral-400">
            102492 · PARLE POINT
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ border: `1px solid ${RULE_COLOUR}` }}
        >
          <X className="h-4 w-4 text-neutral-400" strokeWidth={2.5} />
        </button>
      </header>

      {/* ── 2. SEARCH ──────────────────────────────────────────────────── */}
      {/* Static by spec — a div, not an <input>. "Search product" is rendered
          text, not a placeholder attribute, so nothing is focusable yet. */}
      <div className="px-4 pt-3">
        <div
          className="flex items-center gap-2 rounded-[12px] px-3 py-3"
          style={{ background: SEARCH_BG }}
        >
          <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2.5} />
          <span className="truncate text-[15px] text-neutral-400">Search product</span>
        </div>
      </div>

      {/* ── 3. FAMILY BLOCKS ───────────────────────────────────────────── */}
      {FAMILIES.map((family) => (
        <section key={family.name} className="px-4 pt-4">
          <div className="mb-2 flex items-center gap-2">
            <h2
              className="shrink-0 text-[10px] font-extrabold uppercase text-neutral-400"
              style={{ letterSpacing: "0.1em" }}
            >
              {family.name}
            </h2>
            {/* flex-1 rule filling the remaining width to the right edge */}
            <span className="h-px flex-1" style={{ background: RULE_COLOUR }} />
          </div>

          <div className="grid grid-cols-4" style={{ gap: 7 }}>
            {family.tiles.map((tile) => (
              // No onClick by spec — tapping does nothing yet.
              <div
                key={tile.sap}
                className="flex h-16 min-w-0 items-center justify-center rounded-[13px] px-[2px]"
                style={{ background: family.tint }}
              >
                <span className="text-center text-[13px] font-bold" style={TILE_TEXT_STYLE}>
                  {tile.label}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
