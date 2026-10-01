// The v2 salesman order page — DATA, CURATION, AND THE CATALOG JOIN.
//
// 🔴 CONTAINMENT — everything v2 needs lives inside app/po2/.
// Colours are exported constants used as INLINE STYLES, never CSS variables in
// globals.css and never entries in tailwind.config.ts. Where shared logic is
// needed it is COPIED in with its source named, so deleting this one folder
// removes v2 whole — with ONE read-only exception, stated below.
//
// ⚠ THE EXCEPTION, ADDED 2026-09-09: `packStep` from lib/place-order/pack.ts.
// Nothing in lib/ is modified and app/po/ is still untouched. A COPY of the
// depot's carton table turned out not to be a copy of the depot's carton RULE
// — the overrides that make GVA, Acotone and Machine Tinter sell loose live in
// a second table a snapshot could not see, so v2 stepped them by six where the
// depot steps by one. The full reasoning sits above `stepForLabel`. Read it
// before adding a second import; the bar is "a copy would be silently wrong",
// not "this would be convenient".
import { packKey, packStep, sortPacks } from "@/lib/place-order/pack";

// ── Design tokens ──────────────────────────────────────────────────────────
//
// 🔴 THE NEUTRALS CARRY A VIOLET TINT ON PURPOSE. #74718A is not #737373 with a
// rounding error — every grey here is pulled a few points toward the brand hue
// so that a border beside a violet button reads as part of the same object
// rather than as a stray from a different design. Substituting plain greys is
// the one change that would quietly undo the whole palette, so do not.
//
// Three violets, and they do different jobs. Mixing them up is how a screen
// ends up with two things that look equally like the primary action.
export const BRAND      = "#7C3AED";  // brand.600 — THE ONE commit button per
                                      // screen, the theme colour, the focus ring
export const VIOLET     = "#6D28D9";  // brand.700 — every tappable TEXT
export const BRAND_DEEP = "#5B21B6";  // brand.800 — the wordmark on white

export const SURFACE    = "#FFFFFF";  // cards, sheets, bars
export const PAGE       = "#FAFAFC";  // the page behind them
export const FILL       = "#F4F3F8";  // inputs, inert squares
export const RULE       = "#E9E7F0";  // EVERY border, without exception
export const FAINT      = "#9C99AC";  // placeholders, disabled, chevrons
export const MUTED      = "#74718A";  // second lines, captions
export const BODY       = "#3A3748";  // ordinary text
export const INK        = "#1B1826";  // headings and anything that must land

export const VIOLET_BG  = "#F5F1FE";  // selected-chip / in-cart tile wash

/**
 * 🔴 THE FAVOURITE STAR, AND NOTHING ELSE. Taken from the rebrand's own colour
 * system (docs/mockups/rebrand/orbit-colour-system.html), whose note for this
 * value reads: "The star only. Separate from attention so a favourite never
 * reads as a problem."
 *
 * It is deliberately neither of the two colours already here that it could be
 * confused with. VIOLET is the salesman's own work in progress — a violet star
 * would read as "this is in your order". ATTENTION (#B45309, amber-700) is
 * Urgent, and a filled amber star on a tile would read as a warning about the
 * product rather than a mark he put there himself.
 */
export const FAVOURITE  = "#F59E0B";

/** The focused input border, violet-500 — a step lighter than brand.600 so
 *  the ring around it reads as a halo rather than a second border. */
export const FOCUS      = "#8B5CF6";
/** brand.600 at 13%. The ring, never a fill. */
export const FOCUS_RING = "rgba(124,58,237,.13)";

/**
 * The one destructive colour, red-600.
 *
 * 🔴 IT APPEARS ONLY INSIDE A CONFIRM, never on a trigger sitting loose on a
 * screen. A red button a thumb can reach by accident is not a warning, it is a
 * hazard; the trigger that leads here is quiet text and the weight lands on the
 * button you have to have already decided to press.
 */
export const URGENT     = "#DC2626";

/**
 * The favourite star, amber-500.
 *
 * 🔴 NOT BRAND VIOLET, DELIBERATELY. Violet means "selected" everywhere else in
 * this app — the chosen chip, the current dealer, the live button. A starred
 * dealer is not a selected one, and painting it violet would make a list of
 * favourites look like a list of things already picked.
 */
export const STAR       = "#F59E0B";

/* ── THE THREE DISPATCH DOTS ────────────────────────────────────────────────
 *
 * A 7px round dot in front of each Dispatch chip, so the row reads at a glance
 * without being read. /po has carried these for a year (po-page.tsx:2936-2938,
 * ink-400 / amber-400 / red-400) and v2 dropped them; this brings them back
 * against v2's own palette rather than importing Tailwind names it does not use.
 *
 * 🔴 NAMED FOR THE ROLE, NOT THE COLOUR. DOT_CALL is "the dispatch that needs a
 * phone call first", not "the red one". Rename the value freely; never rename
 * these to DOT_RED and friends, or the next person to change a hue has to
 * change every call site to keep the file honest.
 *
 * ⚠ DOT_CALL IS RED AND THAT IS A DELIBERATE, NARROW EXCEPTION. CLAUDE_UI §1
 * reserves red for something being WRONG or about to be undone, and this app
 * ships Urgent in amber precisely because of that rule. A dot is not a chip, a
 * pill or a button: it carries no text, it is 7px, and it is the one mark that
 * separates "this ships" from "somebody must be phoned before this ships". It
 * is here because the owner asked v2 to match v1's row, and it stops at the
 * dot — the Call chip's own border, ground and text still come from chipStyle
 * like every other chip on the screen. Do not grow it into a red chip.
 */
export const DOT_NORMAL = "#B9B6C6";  // grey — nothing to do, the default
export const DOT_URGENT = "#F59E0B";  // amber-500 — a PRIORITY, never a fault
export const DOT_CALL   = "#EF4444";  // red-500 — phone somebody before it goes

/**
 * 🔴 THE ONLY VIOLET GROUND IN THE APP — the brand row, and nothing else.
 * Every other surface is SURFACE white or PAGE #FAFAFC. A second tinted ground
 * anywhere else and this stops reading as "the masthead" and starts reading as
 * decoration applied at random.
 */
export const BRAND_WASH = "#F5F3FF";

/**
 * A family card lifted off the page. Two layers on purpose: the hairline
 * shadow gives it an edge at rest, the wide soft one gives it height. One
 * layer alone reads either as a border or as a smudge.
 */
export const CARD_SHADOW =
  "0 1px 2px rgba(27,24,38,.04), 0 6px 16px -8px rgba(27,24,38,.10)";
export const SCRIM      = "rgba(18,14,26,.42)";
export const SEARCH_BG  = FILL;
/** One border colour means one token. Kept as a name because rows read better
 *  saying DIVIDER, but it is RULE and must stay RULE. */
export const DIVIDER    = RULE;

/**
 * The brand gradient. Screen only — it never goes on paper.
 *
 * ⚠ CURRENTLY UNUSED — ZERO CALL SITES, verified by grep 2026-09-10. It was the
 * splash's ground until the splash went white with the mark in BRAND (the
 * "Trail" motion, docs/mockups/po-v2/splash-motion.html). It is kept rather
 * than deleted on the mockup's own advice: a full-bleed brand ground is a thing
 * this app may want again, the value below is tuned and the tuning notes are
 * the point of keeping it. Delete it in a deliberate cleanup, not as a side
 * effect of some other change — and check for call sites first, because this
 * comment goes stale the moment somebody adds one.
 *
 * 🔴 TWO STOPS, NOT THREE. It used to fall to #581C87 at the far corner, which
 * read as a bruise on a full screen rather than as a brand. The radial geometry
 * is unchanged; only the dark stop is gone.
 *
 * ⚠ THE APP ICON HAS ITS OWN GRADIENT and is not generated from this. It is
 * public/icon-source.svg, a five-stop radial written by
 * scripts/generate-wordmark.mjs, and a 512px tile can carry a depth a whole
 * phone screen cannot. Editing this value does not change any icon.
 *
 * ⚠ THIS NOTE USED TO SAY "so public/brand/ is untouched". v2 stopped
 * referencing that folder on 2026-09-10 — its icons are the root set now — so
 * the sentence pointed at a relationship that no longer exists.
 */
export const BRAND_GRADIENT =
  "radial-gradient(125% 125% at 26% 20%, #A78BFA 0%, #7C3AED 100%)";

// ── The payload from GET /api/order/data ───────────────────────────────────
// Field names and nesting mirror app/api/order/data/route.ts exactly. `packs`
// is the only nested field; `product`, `uiGroup`, `baseColour`, `tinterType`
// and `region` are all NULLABLE there and are typed nullable here.

export type ApiPack = { packCode: string; unit: string | null; material: string };

export type ApiProduct = {
  id:           number;
  family:       string;
  section:      string;
  subgroup:     string;
  subProduct:   string;
  product:      string | null;
  uiGroup:      string | null;
  baseColour:   string | null;
  displayName:  string;
  searchTokens: string;
  tinterType:   string | null;
  productType:  string;
  sortOrder:    number;
  region:       string | null;
  packs:        ApiPack[];
};

export type ApiCustomer = { name: string; code: string; area: string | null };
export type ApiPayload  = { customers: ApiCustomer[]; products: ApiProduct[] };

// ── Board ──────────────────────────────────────────────────────────────────
// `sap` is the catalog join key. It must equal COALESCE(product, subProduct)
// for that product's menu rows — see joinKey() below for why that COALESCE is
// not optional.

export type V2Tile   = {
  label: string;
  /** Catalog join key — COALESCE(product, subProduct) for this product's rows. */
  sap: string;
  /**
   * 🔴 THE IMAGE KEY, AND IT IS NEVER DERIVED FROM `label`.
   *
   * It would be one line to slugify the label instead, and that line would
   * break the board silently the next time a tile is renamed — which is not
   * hypothetical: "Dustproof" became "Protect Dustproof" and M900 was replaced
   * by PU Enamel, both in a single step, and neither touched a filename. A
   * derived slug would have turned both renames into a broken-image icon on a
   * salesman's phone with nothing failing anywhere a developer would look.
   *
   * So the slug is written down, matches the committed filename in
   * public/category-images/ exactly, and changes only when the FILE is renamed.
   * Labels are free to change; this is not.
   */
  slug: string;
};
export type V2Family = {
  name: string;
  tint: string;
  /**
   * 🔴 FAMILY-WIDE OPENING TAB, AND IT BEATS THE PER-PRODUCT RANKING.
   *
   * The general rule opens each product on whichever tab holds its single
   * most-ordered option. For ENAMEL that gets Super Satin wrong: its top base
   * (BRILLIANT WHITE, 431) outsells its top shade (BLACK, 197), so the ranking
   * says Base while the counter says Shade — an enamel customer is buying a
   * colour, and the base is what you reach for when he is not.
   *
   * Written HERE, on the family, and not as an if-statement over four product
   * names. Add a fifth enamel tomorrow and it inherits this; the four names
   * would not have.
   */
  openTab?: "base" | "shade";
  tiles: readonly V2Tile[];
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 FAMILIES IS NOT DEAD. TWO COMMENTS IN THIS FILE USED TO SAY IT WAS AND
 *    BOTH WERE WRONG — corrected 2026-09-09, along with the closing block that
 *    said Step 2 had deleted it.
 *
 * WHAT IT STILL OWNS — CURATION, and nothing else.
 *   buildCatalog() walks this constant (its `for (const family of FAMILIES)`
 *   loop, :824 below). For each tile it looks up
 *   CURATION[tile.sap] and, where there is one, resolves that product's rows
 *   into a V2Resolved with RANKED base and shade lists — the 90-day ordering
 *   that decides which option a drawer pre-selects, which one leads the column
 *   and which tab the drawer opens on. buildBoard() calls buildCatalog() once
 *   and passes catalog.byTile into resolveGroup for every member, so a member
 *   that is one of the 32 curated products keeps those rankings and a member
 *   that is not gets its options straight from the payload in sortOrder.
 *
 * WHAT IT STOPPED OWNING — LAYOUT and ART.
 *   BOARD is the layout: 9 families, 37 tiles, 98 members, and a tile may hold
 *   several products. tileArtFor() and variantImage() were switched onto BOARD
 *   at c98b4e8c; FAMILIES.slug has been read by nothing since.
 *
 * 🔴 DELETING IT BREAKS PRE-SELECTION ON 32 PRODUCTS, SILENTLY. Not a crash —
 * buildCatalog would simply return an empty byTile, resolveGroup would fall
 * through to the payload for every member, and each of those 32 drawers would
 * open on an unranked list in catalog order with the wrong option selected.
 * Nothing throws and nothing looks broken; the salesman just has to hunt for
 * the colour that used to be first.
 *
 * 🔴 AND THE RANKINGS CANNOT BE DERIVED FROM BOARD. BOARD carries the order of
 * a tile's MEMBERS. It carries nothing about the order of one product's bases
 * and shades, which is what CURATION holds. Removing FAMILIES therefore means
 * moving that data somewhere first — real work, not a tidy-up.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const FAMILIES: readonly V2Family[] = [
  {
    name: "Enamel",
    tint: "#F8F0E0",
    openTab: "shade",
    tiles: [
      { label: "Gloss",          sap: "GLOSS", slug: "gloss" },
      { label: "Promise Enamel", sap: "PROMISE ENAMEL", slug: "promise-enamel" },
      { label: "Super Satin",    sap: "SUPER SATIN", slug: "super-satin" },
      // M900 left the board 2026-09-07 and is now reachable by SEARCH ONLY -
      // a low-volume line was holding a permanent tile. PU Enamel took the
      // slot; "PU ENAMEL" is its real string, quoted from the live payload,
      // where menu.product and menu.subProduct are both exactly that.
      { label: "PU Enamel",      sap: "PU ENAMEL", slug: "pu-enamel" },
    ],
  },
  {
    name: "Interior",
    tint: "#E8EFFA",
    tiles: [
      { label: "Stay Bright",  sap: "SATIN STAY BRIGHT", slug: "stay-bright" },
      { label: "Supercover",   sap: "SUPERCOVER", slug: "supercover" },
      { label: "Pearl Glo",    sap: "VT PEARL GLO", slug: "pearl-glo" },
      { label: "Platinum Glo", sap: "VT PLATINUM GLO", slug: "platinum-glo" },
    ],
  },
  {
    name: "Promise",
    tint: "#FBECEF",
    tiles: [
      { label: "Smart Choice",   sap: "PROMISE SMARTCHOICE", slug: "smart-choice" },
      { label: "Promise Primer", sap: "PROMISE PRIMER", slug: "promise-primer" },
      { label: "Promise Int",    sap: "PROMISE INTERIOR", slug: "promise-int" },
      { label: "Promise Ext",    sap: "PROMISE EXTERIOR", slug: "promise-ext" },
    ],
  },
  {
    name: "Exterior",
    tint: "#EAF4E8",
    tiles: [
      // 🔴 THESE TWO LABELS ARE DISPLAY ONLY. `sap` is the catalog join key and
      // is untouched, and the email line is built by emailLineLabel() off the
      // menu ROW (product / baseColour / subProduct) - never off `label`. A
      // tile rename therefore cannot reach the wire, and it must not: the
      // PowerShell intake parser reads that product string, and a changed one
      // would break order intake silently.
      { label: "Protect Dustproof", sap: "WS PROTECT DUSTPROOF", slug: "protect-dustproof" },
      { label: "Protect Hi-Sheen",  sap: "WS PROTECT HI-SHEEN", slug: "protect-hi-sheen" },
      { label: "Max",        sap: "WS MAX", slug: "max" },
      { label: "Powerflexx", sap: "WS POWERFLEXX", slug: "powerflexx" },
    ],
  },
  {
    name: "Primer",
    tint: "#E3F1F8",
    tiles: [
      { label: "Cement SB",   sap: "CEMENT PRIMER SB", slug: "cement-sb" },
      { label: "Zinc Yellow", sap: "ZINC YELLOW METAL PRIMER", slug: "zinc-yellow" },
      { label: "Red Oxide",   sap: "RED OXIDE METAL PRIMER", slug: "red-oxide" },
      { label: "EAP",         sap: "EXTERIOR ACRYLIC PRIMER", slug: "ext-acrylic" },
    ],
  },
  {
    name: "Stainer",
    tint: "#F6E8C8",
    tiles: [
      { label: "Acotone",        sap: "ACOTONE", slug: "acotone" },
      { label: "Universal Stainer", sap: "UNIVERSAL STAINER", slug: "uni-stainer" },
      { label: "Machine Tinter", sap: "MACHINE TINTER", slug: "machine-tinter" },
      { label: "GVA",            sap: "GVA", slug: "gva" },
    ],
  },
  {
    name: "Aquatech",
    tint: "#E0F1EA",
    tiles: [
      { label: "Damp 2in1", sap: "DAMP PROTECT 2IN1", slug: "damp-2in1" },
      { label: "Roof Coat", sap: "ROOF COAT WHITE", slug: "roof-coat" },
      { label: "Crack 5mm", sap: "CRACKFILLER 5MM", slug: "crack-5mm" },
      // ⚠ THIS SLUG NAMES NO FILE, AND NOTHING READS IT. damp-base.webp was
      // deleted on 2026-09-07: Damp Protect Basecoat is a MEMBER of the Damp
      // Protect 2in1 tile now and its photo ships as
      // product-damp-protect-basecoat.webp. FAMILIES survives only because
      // buildCatalog still walks it, and buildCatalog reads sap and label only
      // — the whole FAMILIES.slug field has been read by nothing since
      // tileArtFor moved onto BOARD. Left in place rather than emptied so the
      // literal keeps one shape; the string is inert.
      { label: "Damp Base", sap: "DAMP PROTECT BASECOAT", slug: "damp-base" },
    ],
  },
  {
    name: "Wood",
    tint: "#EFE6DA",
    tiles: [
      { label: "2K Matt",      sap: "2K PU MATT", slug: "2k-matt" },
      { label: "Prime Matt",   sap: "PU PRIME MATT", slug: "prime-matt" },
      { label: "Prime Sealer", sap: "PU PRIME SEALER", slug: "prime-sealer" },
      { label: "Thinner",      sap: "MULTI PURPOSE THINNER", slug: "thinner" },
    ],
  },
];

// ── Tile art ───────────────────────────────────────────────────────────────

/**
 * 🔴 THE SLUGS THAT ACTUALLY HAVE A FILE. An explicit list, checked before any
 * <img> is rendered — never "render it and hope".
 *
 * A missing file does not fail quietly. The browser paints a broken-image glyph
 * in the tile and the salesman is the one who sees it; the 404 lands in a
 * console nobody on a warehouse floor is reading. So the board asks this set
 * first and renders an empty tinted square when the answer is no.
 *
 * GENERATED by listing public/category-images/ (2026-09-07, second pass).
 * 7 of the 32 tiles have no art: smart-choice, acotone, uni-stainer, machine-tinter, gva, prime-sealer, thinner.
 * When art arrives, run scripts/convert-tile-images.mjs and re-derive this
 * from the folder; nothing else changes.
 *
 * ⚠ smart-choice IS ON THAT LIST AND USED TO HAVE ART. Its file was renamed
 * to smart-choice-exterior.webp because the picture was the Exterior tin, and
 * the Exterior tin is now a VARIANT image in the drawer's rail. Proven by
 * hash, not assumed: smart-choice-exterior.webp is byte-identical to the
 * smart-choice.webp committed at a911a89a. If the board tile should keep art,
 * the answer is a new photograph of the RANGE, not that one variant's tin
 * standing in for four others.
 */
export const TILE_IMAGES: ReadonlySet<string> = new Set([
  // 2026-09-10: five tiles that used to BORROW a file through TILE_ART_ALIAS
  // now own one in public/PO/board/, so their slugs are declared here.
  "superclean", "vt-eterna", "smart-choice", "promise-sheen",
  "coats-additives", "vt-specialty",
  // ⚠ "thinner" IS DELIBERATELY ABSENT, 2026-09-10. The file
  // public/PO/board/thinner.webp IS STILL ON DISK and is NOT deleted — the
  // picture is simply not of this product, and a tin that is not the thing is
  // worse than no tin: it teaches a salesman the wrong shape. Undeclaring the
  // slug is how a tile goes back to its plain family wash, which is exactly
  // what GVA and Hydro PU already do on purpose.
  //
  // 🔴 EXACTLY ONE TILE USED THIS SLUG and no member did — checked by walking
  // BOARD, not by reading the name. So this blanks "Thinner & More" and
  // nothing else. Put the entry back the day a photograph of a real thinner
  // arrives, and put it back in TRANSPARENT_ART at the same time.
  "uni-stainer", "machine-tinter", "acotone", "spray-paint",
  "2k-matt",
  "cement-sb",
  "crack-5mm",
  "damp-2in1",
  "ext-acrylic",
  "gloss",
  // 2026-09-10 — the first Wood tile to get a photograph of its own range.
  // 2k-matt and prime-matt were already here; their FILES were replaced in the
  // same pass, so those two tiles change picture rather than gain one.
  "luxurio",
  "max",
  "pearl-glo",
  "platinum-glo",
  "powerflexx",
  "prime-matt",
  "promise-enamel",
  "promise-ext",
  "promise-int",
  "promise-primer",
  "protect-dustproof",
  "protect-hi-sheen",
  "pu-enamel",
  "red-oxide",
  "roof-coat",
  "stay-bright",
  "super-satin",
  "supercover",
  "zinc-yellow",
]);

/**
 * 🔴 THE SAME IDEA FOR VARIANT ART, AND A SEPARATE SET ON PURPOSE.
 *
 * A variant slug is <tile-slug>-<variant-slug>, in the same folder. Keeping it
 * apart from TILE_IMAGES means a board tile can never accidentally resolve to
 * a variant's tin, or the reverse, however the two lists grow.
 *
 * WHY VARIANTS GET PICTURES AND BASES AND SHADES DO NOT. A base or a shade is
 * the SAME TIN in a different colour, so a photograph of it says nothing a
 * swatch does not say better. Smart Choice's five variants are five different
 * products in five differently coloured buckets — Acrylic Distemper red,
 * Interior cream, Exterior navy, Ext Primer blue-silver — and at 44px the
 * bucket's COLOUR separates them even though its text cannot be read.
 *
 * GENERATED by listing the folder, same pass as TILE_IMAGES.
 */
export const VARIANT_IMAGES: ReadonlySet<string> = new Set([
  "smart-choice-acrylic-distemper",
  "smart-choice-ext-primer",
  "smart-choice-exterior",
  "smart-choice-int-primer",
  "smart-choice-interior",
]);
/**
 * 🔴 ART FOR ONE PRODUCT, NAMED FOR THE PRODUCT — NEVER FOR ITS TILE.
 *
 * The convention is  product-<sap>.webp  in the same flat root, where <sap> is
 * the member's catalog join key — COALESCE(product, subProduct) — lowercased
 * with every run of non-alphanumerics collapsed to a hyphen. "AQUATECH PU COAT"
 * becomes product-aquatech-pu-coat.webp.
 *
 * ⚠ WHY IT MUST NOT USE THE TILE SLUG. Under Scheme A a tile's key IS its
 * top-selling member's sap, so the tile renames itself the day sales reorder
 * its members. Any filename with the tile's identity baked in would stop
 * resolving on that day — silently, because a missing image is a blank square
 * and nobody on a warehouse floor reads a 404. The sap cannot move that way:
 * renaming it renames the PRODUCT, which changes what the email sends, so it
 * is the one identifier the catalog itself guarantees. This is the Diamond Glo
 * failure one layer down — a stored key that outlived its meaning.
 *
 * The "product-" prefix keeps this namespace clear of both the other two:
 * TILE_IMAGES holds hand-authored short slugs (gloss, max, crack-5mm) and
 * VARIANT_IMAGES holds <tile-slug>-<option-slug>. No tile slug is "product",
 * so nothing can collide.
 *
 * TWO FILES ARE DELIBERATELY SHARED, and they are the only two:
 *   product-crackfiller.webp  Crackfiller 5mm / 10mm / 20mm
 *   product-roof-coat.webp    Roof Coat White / Teracotta / Grey
 * One tub each; only the printed text differs, and the NAME under the tile is
 * what tells them apart. Owner's ruling, 2026-09-07. Everything else is 1:1,
 * and the proof asserts exactly that.
 *
 * GENERATED by listing public/category-images/ — never typed from a message.
 */
export const MEMBER_IMAGES: ReadonlySet<string> = new Set([
  // 2026-09-10: eight slugs added with the PO/drawer cut-outs. Four of them
  // are also TILE slugs — a leader with its own member entry, per the
  // both-folders rule at TRANSPARENT_ART.
  "powerflexx", "promise-int", "promise-ext", "floor-plus",
  "product-superclean", "product-fbc-neo",
  "product-waterblock-2k",
  // 🔴 pu-enamel IS A MEMBER FILE TOO, 2026-09-10, and this entry is what
  // makes memberImage return it instead of falling through to LEADER_TILE.
  // The same slug is in TILE_IMAGES; artPath sends the two to different
  // folders, so public/PO/board/pu-enamel.webp and
  // public/PO/drawer/pu-enamel.webp are both reachable.
  "pu-enamel",
  "product-5in1-gloss",
  "product-alkali-bloc-primer",
  "product-aquatech-pu-coat",
  "product-crackfiller",
  "product-damp-protect-2in1",
  "product-damp-protect-basecoat",
  "product-exterior-acrylic-primer",
  "product-farco-white-primer",
  "product-fbc-advance",
  "product-fbc-neo",
  "product-interior-wbc",
  "product-lustre",
  "product-promise-sheen-exterior",
  "product-promise-sheen-interior",
  "product-pu-prime-gloss",
  "product-pu-prime-matt",
  "product-roof-coat",
  "product-superclean",
  "product-superclean-3in1",
  "product-supercover",
  "product-vt-eterna",
  "product-vt-eterna-hi-sheen",
  "product-vt-eterna-matt",
  "product-waterblock-2k",
  "product-ws-protect-rainproof",
]);

/**
 * A member's own tin, or null.
 *
 * 🔴 ONE FALLBACK, AND ONLY ONE: THE TILE'S LEADER GETS THE TILE'S ART.
 *
 * A tile's photograph IS a photograph of its top-selling member — that is what
 * the board tile has always been showing. So PU Enamel, Powerflexx, 2K PU Matt
 * and Promise Interior standing as bare washes in a strip beside siblings with
 * tins was not missing art; it was the same art, unreachable by a second name.
 * The rule costs no bytes and copies no file, which is the point: copying
 * pu-enamel.webp to product-pu-enamel.webp would be correct for exactly as long
 * as PU Enamel outsells Lustre, and would quietly become a lie the day it does
 * not. A rule re-reads the board every render; a copy freezes one ranking.
 *
 * ⚠ A NON-LEADER WITH NO ART GETS NOTHING, DELIBERATELY. Extending the fallback
 * to every member is precisely the bug the cart shipped for eleven commits —
 * nine Powerflexx products under one tub, a Lustre line drawing pu-enamel — and
 * it is worse in the strip than in the cart, because the strip's whole job is
 * to tell nine products apart. The family wash says "no photo yet"; the
 * leader's tin would say "this is the leader", which is false.
 *
 * The leader is read from LEADER_TILE, which the BOARD walk fills at
 * members[0]. Reorder the members tomorrow and the fallback follows the new
 * leader with nothing to edit.
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 WHERE AN ART FILE LIVES — TWO FOLDERS, ONE SWITCH.
 *
 *   public/PO/board/    this page's own TILE art
 *   public/PO/drawer/   this page's own MEMBER art
 *   public/category-images/   LEGACY
 *
 * public/PO/ is /po2's own art, cut out on transparency and shot for
 * this board. public/category-images/ is what the page started on: padded
 * opaque squares, shared in spirit with the older surfaces. It is not frozen
 * and it is not wrong — it is simply the art that has NOT been replaced yet,
 * and it SHRINKS every time a tile gets a cut-out. When the last one is
 * replaced the folder retires.
 *
 * 🔴 ONE RULE DECIDES BOTH THINGS. TRANSPARENT_ART already says which slugs
 * are cut-outs, and a cut-out is exactly what lives in PO/. So membership
 * settles the folder AND the rendering — no square, no multiply, a
 * drop-shadow. Two parallel switches would drift the first time somebody added
 * a file to one and forgot the other, and the failure is silent: a tin
 * multiplied into a tint looks muddy rather than broken.
 *
 * board vs drawer is decided by WHICH RESOLVER IS ASKING, not by a second
 * list. tileImage says "board", memberImage and variantImage say "drawer".
 * That is why the same slug can be a tile and a member — pu-enamel is the
 * More Enamels TILE and the PU Enamel MEMBER, and the two folders hold the
 * same bytes on purpose.
 *
 * ⚠ A WRONG PREFIX SHOWS AS A BLANK TILE, not an error. The board is the
 * check after any change here.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function artPath(slug: string, kind: "board" | "drawer"): string {
  return TRANSPARENT_ART.has(slug)
    ? `/PO/${kind}/${slug}.webp`
    : `/category-images/${slug}.webp`;
}

export function memberImage(sap: string): string | null {
  const slug = MEMBER_SLUG.get(sap);
  if (slug !== undefined && MEMBER_IMAGES.has(slug)) return artPath(slug, "drawer");
  const leads = LEADER_TILE.get(sap);
  return leads !== undefined ? boardTileArtFor(leads).src : null;
}

/**
 * 🔴 FOUR TILES WHOSE PICTURE IS ANOTHER FILE'S. AN ALIAS, NOT A COPY.
 *
 * SuperClean, VT Eterna, Smart Choice and Promise Sheen had no tile art of
 * their own, and a photograph of the right product was already on disk under a
 * product or variant name. Duplicating the bytes under a fifth name would have
 * worked and been wrong twice over: 100 KB for nothing, and two files that can
 * drift apart the day one of them is replaced.
 *
 * ⚠ IT REDIRECTS THE FILE, NEVER THE SLUG. A tile's slug is also the stem every
 * VARIANT filename is built from — variantImage() composes
 * <tile-slug>-<option-slug> — so renaming smart-choice's slug to the file it
 * borrows would have silently broken all five Smart Choice bucket tins, which
 * are the one place variant art exists. The alias is consulted here and
 * nowhere else, so the slug keeps its other job.
 *
 * It lives inside tileImage() rather than beside BOARD because po-v2-page.tsx
 * calls tileImage(tile.slug) directly for the board grid. One redirect, and the
 * board and the drawer cannot show different pictures for the same tile.
 */
/**
 * 🔴 EMPTY SINCE 2026-09-10, AND KEPT ON PURPOSE.
 *
 * It held five tiles that borrowed another file: superclean, vt-eterna,
 * smart-choice, promise-sheen and coats-additives. Every one of them now has
 * its OWN cut-out in public/PO/board/, so the borrow is gone rather than
 * repointed — an alias that resolves to the same picture the slug already
 * names is a redirect nobody can see the purpose of.
 *
 * The mechanism stays because the next tile to arrive without art will want
 * it, and because tileImage still consults it. See the git history for what
 * borrowing looked like and why it beat copying the bytes.
 */
const TILE_ART_ALIAS: ReadonlyMap<string, string> = new Map([]);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 WHICH TILES CARRY A CUT-OUT INSTEAD OF A PADDED WHITE SQUARE.
 *
 * A LIST, NOT A GUESS. It would be one line to sniff the file, and that line
 * would be wrong the first time somebody exported a webp with an alpha channel
 * that happens to be fully opaque — which is exactly what arrived on
 * 2026-09-10 and was refused. Nothing about a filename or an extension tells
 * you whether the background was actually removed. So the answer is written
 * down, one slug at a time, by somebody who checked.
 *
 * Membership changes THREE things, and only for the tiles named here:
 *   1. the pale family-tint square behind the image does not render
 *   2. mixBlendMode: multiply does not apply — it would darken a cut-out
 *      against the card instead of dropping out a white ground
 *   3. the image gets a two-layer drop-shadow, so the shadow follows the
 *      tin's OUTLINE rather than a rectangle
 *
 * The other 33 tiles are untouched, byte for byte.
 *
 * ⚠ THE FILE AND THE SET MOVE TOGETHER. Putting an opaque file at one of
 * these slugs paints a white square on the card with a shadow around it;
 * putting a cut-out at a slug NOT listed here multiplies it into the family
 * tint and it will look muddy. If you swap one, swap both.
 *
 * ENAMEL ONLY, 2026-09-10, and deliberately — this is a look the owner is
 * comparing against the other eight families on one screen. Do not extend it
 * until he has seen it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const TRANSPARENT_ART: ReadonlySet<string> = new Set([
  // ── TILE art — public/PO/board/<slug>.webp ────────────────────────────
  "gloss", "super-satin", "promise-enamel", "pu-enamel",
  "stay-bright", "supercover", "superclean",
  "pearl-glo", "platinum-glo", "vt-eterna", "vt-specialty",
  "smart-choice", "promise-int", "promise-primer", "promise-sheen",
  "protect-dustproof", "protect-hi-sheen", "max", "powerflexx",
  "ext-acrylic",
  "damp-2in1", "crack-5mm",
  "prime-matt", "2k-matt", "luxurio", "coats-additives",
  // 2026-09-10, the last five board files. FOUR OF THESE REPLACE LEGACY
  // OPAQUE ART — cement-sb, zinc-yellow, red-oxide and roof-coat each showed
  // a padded white square, and joining this set is what takes the square away
  // with the picture. "thinner" was blank and only needed the entry.
  //
  // ⚠ cement-sb IS FED BY A FILE NAMED cement-wb, ON THE OWNER'S EXPLICIT
  // PLACEMENT, MADE TWICE. WB is WATER-based and SB is SOLVENT-based, and
  // BOARD holds them as two different products: CEMENT PRIMER SB is this tile,
  // CEMENT PRIMER WB is a separate "Cement WB" member of the Primers tile. So
  // this tile may be showing a photograph of a different product. Recorded
  // rather than second-guessed; ask before "fixing" it.
  // ⚠ "thinner" WAS HERE AND CAME OUT WITH ITS TILE_IMAGES ENTRY,
  // 2026-09-10 — the picture was not that product. Both entries go together
  // or neither does: TRANSPARENT_ART alone declares "read from /PO/, no pale
  // square, two-layer shadow" for a slug tileImage() will never return, which
  // is a claim about a file nothing asks for. The file stays on disk.
  "cement-sb", "zinc-yellow", "red-oxide", "roof-coat",
  // 2026-09-10, the Stainer family. All three tiles were BLANK, so each also
  // had to be declared in TILE_IMAGES — the entry here alone would have left
  // them blank, which is what nearly shipped for "thinner" one commit ago.
  //
  // ⚠ uni-stainer IS A BOTTLE, NOT A TUB. 62% of its file is transparent
  // against 25-35% for its neighbours, because the product is narrow and
  // tall: it pads with transparency either side and reads smaller in its
  // tile. That is the shape of the thing. Do NOT scale or crop it to match.
  "uni-stainer", "machine-tinter", "acotone",
  // Spray Paint's first tile, 2026-09-10 — replaced More Interior, which was
  // removed rather than renamed so no tile key had to move. See BOARD.
  "spray-paint",
  // ── MEMBER art — public/PO/drawer/<slug>.webp ─────────────────────────
  // Four slugs appear in BOTH lists — pu-enamel, powerflexx, promise-int and
  // the rest of the leaders below. artPath picks the folder from which
  // resolver is asking, so one entry covers a tile and its leading member and
  // the two folders hold the same bytes under the same name. That is the
  // owner's both-folders rule: a leader with its OWN member entry cannot lose
  // its picture when the drawer is reordered.
  "product-5in1-gloss", "product-lustre",
  "product-superclean", "product-superclean-3in1",
  "product-vt-eterna-matt", "product-vt-eterna-hi-sheen",
  "promise-ext",
  "product-promise-sheen-interior", "product-promise-sheen-exterior",
  "floor-plus",
  "product-exterior-acrylic-primer", "product-alkali-bloc-primer",
  "product-damp-protect-2in1", "product-damp-protect-basecoat",
  "product-crackfiller",
  "product-fbc-advance", "product-fbc-neo", "product-waterblock-2k",
  "product-aquatech-pu-coat",
]);


/**
 * 🔴 THE SHADOW IS A filter, NOT A box-shadow, AND THAT IS THE WHOLE POINT.
 *
 * box-shadow traces the element's BOX. On a tile whose image is a cut-out on
 * transparency, that draws a rectangle floating behind a tin — the exact
 * "sticker on a square" this change exists to remove. drop-shadow() reads the
 * alpha channel and follows the tin's own outline, handle and all.
 *
 * TWO LAYERS, because one cannot do both jobs. The tight one at 1.5px/2px is
 * CONTACT — it sits the tin on the card. The wide one at 4px/6.5px is LIFT —
 * it gives the object somewhere to be. One shadow doing both is either too
 * hard at the edge or too vague underneath, and reads as cheap.
 *
 * Values approved from the owner's preview. #181426 rather than black: the
 * app's neutrals carry a violet tint (see the token block at the top of this
 * file) and a pure-black shadow under them reads as a smudge.
 */
export const CUTOUT_SHADOW =
  "drop-shadow(0 1.5px 2px rgba(24,20,38,0.35)) drop-shadow(0 4px 6.5px rgba(24,20,38,0.21))";

/**
 * The same shadow for a RAIL or STRIP cell, scaled — NOT copied.
 *
 * 🔴 A SHADOW IS A DISTANCE, AND THE CELL IS SMALLER. A board tile is about
 * 79px across on a 390px phone; a rail square is 60 and a strip square 56. The
 * board's 4px offset under a 60px tin is proportionally half again what it is
 * under a 79px one, and it reads as a sticker lifting off the page rather than
 * an object resting on it.
 *
 * So the geometry is scaled by ~0.7 (60/79 rounded to something legible) and
 * the OPACITIES ARE NOT. Alpha is not a distance — darkening the shadow to
 * "compensate" for a smaller blur is what makes a small shadow look dirty.
 *
 *   contact  1.5px/2px  ->  1px/1.5px
 *   lift     4px/6.5px  ->  3px/4.5px
 */
export const CUTOUT_SHADOW_RAIL =
  "drop-shadow(0 1px 1.5px rgba(24,20,38,0.35)) drop-shadow(0 3px 4.5px rgba(24,20,38,0.21))";

/**
 * Is this resolved art a cut-out?
 *
 * 🔴 IT ASKS THE PATH, AND THAT IS STILL ONE RULE, NOT TWO. TRANSPARENT_ART
 * decides the folder in artPath(); this reads that decision back. A component
 * holding only a resolved `src` — which is all BigTile ever gets — cannot look
 * the slug up, and threading one through would be a second thing to keep in
 * step. The path IS the answer.
 */
export function isCutout(src: string | null | undefined): boolean {
  return typeof src === "string" && src.startsWith("/PO/");
}

/** The tile's image URL, or null when there is no file for that slug. */
export function tileImage(slug: string): string | null {
  const file = TILE_ART_ALIAS.get(slug) ?? slug;
  // All three presence sets, because an alias deliberately points OUT of
  // TILE_IMAGES — into a product photo or, for Smart Choice, a variant tin.
  return TILE_IMAGES.has(file) || MEMBER_IMAGES.has(file) || VARIANT_IMAGES.has(file)
    ? artPath(file, "board") : null;
}

/**
 * A variant option's image URL, or null when there is no file for it.
 *
 * The slug is built, not stored: <tile-slug>-<option-slug>. That is safe here
 * in a way it would NOT be for a tile — a tile slug is written down precisely
 * because a rename must not break it, whereas the option string IS the catalog
 * value and renaming it renames the product itself. The set below is still
 * consulted before anything renders, so a build that does not match a file
 * resolves to null and the option falls back to its text tile.
 */
export function variantImage(sap: string, option: string): string | null {
  // BOARD's slug, for the same reason tileArtFor moved: a variant filename is
  // built from the TILE's slug, and only BOARD knows the layout now.
  //
  // ⚠ THIS USED TO SAY "FAMILIES is dead". It is not — it still owns curation,
  // and buildCatalog walks it on every load. What it lost is layout and art,
  // which is all this line ever needed. See the block above FAMILIES.
  const tile = boardTileSlugFor(sap);
  if (!tile) return null;
  const slug = `${tile}-${optionSlug(option)}`;
  return VARIANT_IMAGES.has(slug) ? artPath(slug, "drawer") : null;
}

/** "Acrylic Distemper" -> "acrylic-distemper". Filenames only, never a value. */
function optionSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Mix a hex colour toward white. `amount` is how far: 0 keeps it, 1 is white.
 *
 * The family tints were picked to fill an 84px block. Behind a product photo
 * they are far too strong — the tin ends up competing with its own background —
 * so the board washes them out to about half strength. The point of keeping ANY
 * colour is that the eye still bands four tiles into a family down the page;
 * the point of taking most of it away is that a tile should read as a product,
 * not as a coloured square with a product on it.
 */
export function mixToWhite(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0"));
  return "#" + ch.join("").toUpperCase();
}

/** How far the family tint is washed out behind the tile art. */
export const TILE_WASH = 0.55;

/**
 * The thumbnail for a cart line, looked up by its tile key.
 *
 * 🔴 THIS NOW READS THE 36-TILE BOARD. It used to be built from FAMILIES, and
 * the note here said "keyed on the 32-tile board's saps and the review screen
 * reads it today — Step 4 owns the switch-over". Step 4 never did it, and the
 * review screen went on asking a dead constant for eleven commits: nine tiles
 * — SuperClean, More Interior, Pearl Glo, Platinum Glo, VT Eterna, VT
 * Specialty, Promise Sheen, Coats & Additives, More Wood — came back with a
 * family wash from the OLD grouping, so those cart lines sat on the wrong tint.
 * One map now, so the board and the cart cannot disagree again.
 *
 * A SEARCHED NON-TILE product is not on the board, so it gets the neutral fill
 * and no image — the same treatment as a tile whose art has not arrived.
 */
export function tileArtFor(sap: string): { src: string | null; wash: string } {
  return boardTileArtFor(sap);
}

// ── Pack formatting ────────────────────────────────────────────────────────

/**
 * COPIED from lib/place-order/pack.ts's `formatPack` (read 2026-09-06),
 * behaviour for behaviour. Copied, not imported — containment. It is a
 * SNAPSHOT: if the original changes, this does not follow.
 *
 * The live payload carries units L / KG / GM / ML / PC and packCodes from
 * "0.2" to "925", so every branch below is reachable, not defensive padding.
 */
export function formatPack(packCode: string, unit?: string | null): string {
  const u = (unit ?? "").toUpperCase();
  if (u === "KG") return `${packCode}KG`;
  if (u === "GM") return `${packCode}GM`;
  // Tools sold by the piece: the carton size rides packCode, the label does not.
  if (u === "PC") return "1 pc";
  // Spray paint aerosol — a specific (packCode+unit) case so the 50/100/200 ML
  // magnitude path below stays byte-identical for paint.
  if (packCode === "400" && u === "ML") return "400 ml";
  const num = parseFloat(packCode);
  if (Number.isNaN(num)) return packCode;
  if (num >= 50)         return `${num}ML`;
  if (num < 1)           return `${Math.round(num * 1000)}ML`;
  return `${num}L`;
}

/**
 * Units moved by one tap of +/-: a whole box, or 1 for a drum.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE THIRD DOCUMENTED CONTAINMENT EXCEPTION, AND THE FIRST IN THIS FILE.
 *
 * `v2-data.ts` had no imports at all until 2026-09-09. It now has one, and the
 * reason is that a COPY of the depot's carton table is not a copy of the
 * depot's carton RULE.
 *
 * What was here: a verbatim snapshot of `PACK_STEP_MAP`, label-keyed, taken on
 * 2026-09-06. It was accurate. It was also only half the rule —
 * `lib/place-order/pack.ts` checks `PRODUCT_CARTON_OVERRIDES` through
 * `cartonOverride()` BEFORE it reaches that map, and the snapshot could not.
 * So v2 stepped GVA, Acotone and Machine Tinter 1L by six when the depot sells
 * them loose and v1 steps them by one, and it stepped Universal Stainer's
 * 50/100/200ML and the three Crackfillers on the wrong carton too. Nothing
 * failed; the numbers were simply wrong, on the control the salesman actually
 * taps.
 *
 * 🔴 SO THE TABLE IS DELETED, NOT EXTENDED. Copying the override table in
 * beside the step table would have reproduced the same failure one layer up:
 * two owners for one rule, drifting the first time the depot re-cartons
 * anything. `packStep` is the owner. This is a delegate.
 *
 * The signatures line up with no shim: `packStep(packLabel, productKey?)`
 * takes the RENDERED label, which is what every v2 call site has.
 *
 * ⚠ ONE THING THIS CANNOT REACH, AND IT IS NOT AN OVERSIGHT. Tools are keyed
 * in `PIECE_BOX_STEP` on the RAW pack (`25PC` / `12PC` / `500PC`), and
 * `formatPack` collapses every one of them to the single string `"1 pc"` — so
 * no label-keyed lookup can tell a roller from a brush, and both come back as
 * 1. Only `packStepForPack(packCode, unit, productKey)` sees them, and v2 has
 * no packCode at a step call site. 31 live products, search-only, none on the
 * board. Owner deferred it 2026-09-09 rather than reshape the drawer; it is on
 * ROADMAP under `/po2`. Do NOT "fix" it by keying anything off the
 * `"1 pc"` string.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @param productKey COALESCE(product, subProduct) — the SAP-clean stock name,
 *   never a displayName or a board label. That is the key `cartonOverride()`
 *   expects, and a friendly name silently misses every override and looks like
 *   it worked. Omitted, the global table applies.
 */
export function stepForLabel(label: string, productKey?: string | null): number {
  return packStep(label, productKey);
}

// ── Curated option lists ───────────────────────────────────────────────────
// 🔴 THIS IS NOT THE CATALOGUE. It is EVERY option a tile has, IN RANK ORDER, ranked by what was
// actually ordered in the 90 days to 2026-09-07 — mail-order line frequency
// first (what the salesman ASKED for), SAP dispatch frequency breaking ties,
// catalog sortOrder last for anything never ordered. Anything the catalogue has
// that this does not name is appended AFTER it, in sortOrder, by the drawer —
// so the rail holds every option and nothing is unreachable.
//
// GENERATED from a read-only query, then frozen here BY DESIGN: the lists stay
// hand-editable in this exact shape so a list can be overridden by name without
// re-running anything. Re-rank deliberately, not on every deploy — the board
// should not reshuffle under a salesman who has learned where things are.
//
// Values are EXACT `baseColour` strings, matched literally including case:
// Sadolin stores "90 Base" while every other family stores "90 BASE", and that
// difference is real, not a typo.
//
// NOTHING IS TRUNCATED HERE OR ANYWHERE DOWNSTREAM. There is no cap and no
// expander any more — see the note where chipLimit() used to live.
//
// `variants` is not a different KIND of thing — Smart Choice and Promise
// Primer store their variants in `baseColour` too. It is a separate field only
// so the drawer can render them in one column with no group toggle.

export type V2Curation = {
  bases:    readonly string[];
  shades:   readonly string[];
  variants: readonly string[];
  /**
   * Which tab the drawer OPENS on — the one holding this product's single
   * most-ordered option, not always Base.
   *
   * GENERATED from the same 90-day ranking as the arrays, never hand-written.
   * Promise Enamel opens on SHADE because CLASSIC WHITE (797 mail orders) far
   * outsells its only base, BRILLIANT WHITE (241); opening on a one-chip Base
   * tab would put the thing he actually wants one tap away, every time.
   * Absent (or on a product with only one tab) means Base.
   */
  defaultTab?: "base" | "shade";
};

const NONE: readonly string[] = [];

export const CURATION: Record<string, V2Curation> = {
  "GLOSS":                     { bases: ["90 BASE", "BRILLIANT WHITE", "92 BASE", "93 BASE", "94 BASE", "GREEN BASE"], shades: ["BLACK", "DARK BROWN", "GOLDEN BROWN", "SMOKE GREY", "DA GREY", "GOLDEN YELLOW", "PO RED", "PHIROZA", "DEEP ORANGE", "BUS GREEN", "SIGNAL RED", "OXFORD BLUE", "SAND STONE", "ROYAL IVORY", "LEAF BROWN", "SKY BLUE", "LIGHT GREY", "CHERRY", "DAWN", "MINT GREEN", "CLASSIC WHITE", "MIDDLE BUFF", "DEEP GREEN", "BLAZING WHITE", "TRUCK BROWN", "WILD PURPLE", "AQUAMARINE", "MAHOGANY", "OFF WHITE", "PALE CREAM", "CASCADE GREEN", "OPALINE GREEN"], variants: NONE, defaultTab: "shade" },
  "PROMISE ENAMEL":            { bases: ["BRILLIANT WHITE"], shades: ["CLASSIC WHITE", "BLACK", "SMOKE GREY", "PHIROZA BLUE", "PO RED", "GOLDEN YELLOW", "GOLDEN BROWN", "DARK BROWN", "BUS GREEN"], variants: NONE, defaultTab: "shade" },
  "SUPER SATIN":               { bases: ["BRILLIANT WHITE", "90 BASE", "93 BASE", "92 BASE", "94 BASE", "96 BASE", "97 BASE"], shades: ["BLACK", "BROWN", "RICH BROWN", "MAHOGANY", "SPECIAL TEAK", "TEAK", "TIMBER GOLDEN BROWN"], variants: NONE, defaultTab: "base" },
  "PU ENAMEL":                 { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "94 BASE"], shades: ["BLACK", "SMOKE GREY", "DARK BROWN", "GOLDEN BROWN", "PHIROZA"], variants: NONE, defaultTab: "shade" },
  "SATIN STAY BRIGHT":         { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE"], shades: ["WALNUT", "BLACK"], variants: NONE, defaultTab: "base" },
  "SUPERCOVER":                { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE", "96 BASE", "95 BASE", "97 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "VT PEARL GLO":              { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE", "95 BASE", "96 BASE", "97 BASE", "PASTEL BASE"], shades: ["RARE PEARL COPPER", "RARE PEARL GREEN"], variants: NONE, defaultTab: "base" },
  "VT PLATINUM GLO":           { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE", "95 BASE", "96 BASE", "97 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  // 🔴 OPTION ORDER LIVES HERE, NOT IN BOARD. These are catalog baseColour
  // VALUES and this array is what ranks them; BOARD carries members, not
  // options. Reordered 2026-09-10 to the owner's sequence — Distemper first,
  // then the two paints, then the two primers. The VALUES are the catalog's
  // own and are untouched: "Acrylic Distemper", "Int Primer" and "Ext Primer"
  // are spelled as the rows spell them, not as the request worded them.
  // Five options is all the tile has; there is no sixth to place.
  "PROMISE SMARTCHOICE":       { bases: NONE, shades: NONE, variants: ["Acrylic Distemper", "Interior", "Exterior", "Int Primer", "Ext Primer"], defaultTab: "base" },
  "PROMISE PRIMER":            { bases: NONE, shades: NONE, variants: ["Freedom 2in1 Primer", "2in1 Primer", "Promise Primer"], defaultTab: "base" },
  "PROMISE INTERIOR":          { bases: ["BRILLIANT WHITE", "90 BASE", "93 BASE", "92 BASE", "94 BASE", "97 BASE", "96 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "PROMISE EXTERIOR":          { bases: ["BRILLIANT WHITE", "93 BASE", "90 BASE", "92 BASE", "94 BASE", "96 BASE", "98 BASE", "95 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "WS PROTECT DUSTPROOF":      { bases: ["BRILLIANT WHITE", "92 BASE", "93 BASE", "90 BASE", "94 BASE", "97 BASE", "96 BASE", "95 BASE", "98 BASE", "99 BASE"], shades: ["TERACOTTA", "SIGNAL RED", "PO RED", "SUNRISE", "ELECTRIC BLUE PLUS"], variants: NONE, defaultTab: "base" },
  "WS PROTECT HI-SHEEN":       { bases: ["93 BASE", "BRILLIANT WHITE", "92 BASE", "90 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "WS MAX":                    { bases: ["92 BASE", "90 BASE", "93 BASE", "BRILLIANT WHITE", "94 BASE", "97 BASE", "96 BASE", "95 BASE", "98 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "WS POWERFLEXX":             { bases: ["BRILLIANT WHITE", "90 BASE", "92 BASE", "93 BASE", "94 BASE", "95 BASE", "96 BASE", "97 BASE", "98 BASE"], shades: NONE, variants: NONE, defaultTab: "base" },
  "CEMENT PRIMER SB":          { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "ZINC YELLOW METAL PRIMER":  { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "RED OXIDE METAL PRIMER":    { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "EXTERIOR ACRYLIC PRIMER":   { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "ACOTONE":                   { bases: NONE, shades: ["NO1", "XY1", "WH1", "YE1", "XR1", "RE1", "OR1", "MA1", "BU1", "GR1", "BU2", "YE2", "NO2", "RE2"], variants: NONE, defaultTab: "shade" },
  "UNIVERSAL STAINER":         { bases: NONE, shades: ["FAST VIOLET", "BLACK", "YELLOW OXIDE", "FAST RED", "BURNT SIENNA", "FAST BLUE", "FAST YELLOW", "FAST ORANGE", "FAST GREEN", "FASTYELLOWGREEN"], variants: NONE, defaultTab: "shade" },
  "MACHINE TINTER":            { bases: NONE, shades: ["WHITE", "YOX", "OXR", "TBL", "LFY", "FFR", "BLACK", "MAG", "GRN"], variants: NONE, defaultTab: "shade" },
  "GVA":                       { bases: ["BRILLIANT WHITE"], shades: ["BLACK", "YELLOW OXIDE", "ORGANIC ORANGE", "ORGANIC LEMON YELLOW", "BLUE", "RED OXIDE", "ORGANIC MIDDLE YELLOW", "ORGANIC VIOLET", "ORGANIC RED VIOLET", "FAST RED", "GREEN"], variants: NONE, defaultTab: "base" },
  "DAMP PROTECT 2IN1":         { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "ROOF COAT WHITE":           { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "CRACKFILLER 5MM":           { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "DAMP PROTECT BASECOAT":     { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
  "2K PU MATT":                { bases: ["90 Base", "93 Base"], shades: ["Int Clear", "Opaque White", "Ext Clear"], variants: NONE, defaultTab: "base" },
  "PU PRIME MATT":             { bases: ["90 Base", "93 Base"], shades: ["Clear", "White"], variants: NONE, defaultTab: "base" },
  "PU PRIME SEALER":           { bases: NONE, shades: ["White", "Clear"], variants: NONE, defaultTab: "shade" },
  "MULTI PURPOSE THINNER":     { bases: NONE, shades: NONE, variants: NONE, defaultTab: "base" },
};

// (The nine hard-coded "+ More" bases went first, then the search round-trip
// that replaced them, then the in-place expansion that replaced THAT. The rail
// replaced the question: a column shows the lot.)

// ── The join ───────────────────────────────────────────────────────────────

/**
 * 🔴 RULE 1 — THE GROUP KEY IS COALESCE(product, subProduct), NEVER `product`.
 *
 * `mo_order_form_index_v2.product` is NULLABLE. Measured against the live
 * payload on 2026-09-06: 133 of 471 rows carry NULL, and **13 of our 32 tiles**
 * resolve only through `subProduct` — GLOSS itself, all four primers, all four
 * Aquatech, all three Sadolin, and Thinner. Joining on `product` alone finds
 * nothing for any of them and those tiles open empty. The payload route does
 * the same COALESCE for its own pack join (route.ts:114).
 */
function joinKey(row: ApiProduct): string {
  return row.product ?? row.subProduct;
}

/**
 * 🔴 RULE 2 — baseColour is matched NULL-SAFELY, AND BLANK COUNTS AS NULL.
 *
 * 36 payload rows carry `baseColour: null` — the nine no-option tiles among
 * them. NULL is a real, selectable identity here ("this product has exactly
 * one row"), not an absence, so it is mapped to an explicit sentinel rather
 * than left to fall through a lookup as `undefined`. A Map keyed on `null`
 * would work in JS; a sentinel makes the intent unmissable and survives the
 * key being serialised.
 *
 * 🔴 AND 37 MORE ROWS CARRY AN EMPTY STRING, WHICH IS THE SAME FACT WRITTEN A
 * SECOND WAY. `mo_order_form_index_v2.baseColour` is nullable, and the depot's
 * data has both spellings of "this product has no options": 36 NULL and 37
 * "". Measured 2026-09-07 — 398 rows carry a real value, 36 NULL, 37 blank.
 *
 * Until this rule existed, "" fell through every null test in the file and
 * became a SELECTABLE OPTION WHOSE VALUE WAS THE EMPTY STRING, and that made
 * all 37 products IMPOSSIBLE TO ORDER. The screen looked perfectly normal:
 * resolveGroup saw a row that was not null, so it built `bases: [{ value: "" }]`
 * and left `noOptionRow` null; the drawer selected that option, rendered a
 * blank 44px rail tile and the right pack rows, and took a quantity into
 * `matrix[""]`. Then the drawer's rowFor() short-circuits on `key === ""` —
 * the key it uses for a product with NO options — and returned the null
 * noOptionRow, so the pick was filtered out and Add never lit. Nineteen of the
 * 37 were ordered by mail in the 90 days to 2026-09-07, 136 lines across 123
 * orders, Acrylic Putty the largest at 44.
 *
 * ⚠ THE FIX BELONGS HERE AND NOWHERE ELSE. Teaching the drawer about "" would
 * have left the empty string a legal option value and simply moved the bug to
 * whatever reads it next — the cart, the email, the parser. A blank baseColour
 * is not a colour; it is the absence of one, and this is the line that says so.
 */
export const NULL_OPTION = " NULL";

/**
 * Does this row actually carry an option, or is it a product with exactly one
 * row? The ONE test. Every place that used to ask `!== null` asks this.
 */
export function hasOption(baseColour: string | null | undefined): boolean {
  return baseColour !== null && baseColour !== undefined && baseColour.trim() !== "";
}

function optionKey(baseColour: string | null): string {
  return hasOption(baseColour) ? (baseColour as string) : NULL_OPTION;
}

/** One curated chip that resolved to a real menu row. */
export type V2Option = { value: string; row: ApiProduct };

export type V2Resolved = {
  sap:      string;
  /** Header name — the curated tile label. Catalog `displayName` is NOT used:
   *  it varies per row ("M900 Gloss - 90 Base"), so it names a variant, not a
   *  product. */
  label:    string;
  /** Sub-line when nothing is selected — the board family ("Enamel"). */
  family:   string;
  bases:    V2Option[];
  shades:   V2Option[];
  variants: V2Option[];
  /** The single NULL-baseColour row, for tiles with no options at all. */
  noOptionRow: ApiProduct | null;
  /** Which tab to open on — from CURATION, generated off the 90-day ranking. */
  defaultTab: "base" | "shade";
  /**
   * True for the 32 board tiles, whose lists are RANKED and split base/shade.
   * False for a searched non-tile, whose single list is raw catalog order and
   * is neither — the drawer reads this to know whether to offer a group toggle.
   */
  curated: boolean;
};

/** What the Task-5 gate found. Reported, never papered over. */
export type V2GateReport = {
  missingOptions: { tile: string; option: string }[];
  zeroRowTiles:   string[];
  emptyPackChips: { tile: string; option: string; rowId: number }[];
  droppedDupes:   { tile: string; baseColour: string; keptId: number; droppedId: number; droppedFamily: string }[];
};

export function buildCatalog(products: ApiProduct[]): {
  byTile: Map<string, V2Resolved>;
  report: V2GateReport;
} {
  const report: V2GateReport = {
    missingOptions: [], zeroRowTiles: [], emptyPackChips: [], droppedDupes: [],
  };

  // Group every payload row under COALESCE(product, subProduct).
  const groups = new Map<string, ApiProduct[]>();
  for (const row of products) {
    const key = joinKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const byTile = new Map<string, V2Resolved>();

  for (const family of FAMILIES) {
    for (const tile of family.tiles) {
      const curation = CURATION[tile.sap];
      if (!curation) continue;
      const rows = groups.get(tile.sap) ?? [];

      if (rows.length === 0) {
        report.zeroRowTiles.push(tile.label);
        byTile.set(tile.sap, {
          sap: tile.sap, label: tile.label, family: family.name,
          bases: [], shades: [], variants: [], noOptionRow: null, defaultTab: "base", curated: true,
        });
        continue;
      }

      // 🔴 RULE 3 — DEDUPE. The menu's unique key is
      // (family, subProduct, baseColour), so one product reached from two
      // families can yield the same baseColour twice, and mo_sku_lookup_v2
      // still carries shadow rows from the June dual-homing. Lowest sortOrder
      // wins; the loser is REPORTED, never silently rendered as a second chip
      // with the same label.
      const byOption = new Map<string, ApiProduct>();
      for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
        const key = optionKey(row.baseColour);
        const kept = byOption.get(key);
        if (kept) {
          report.droppedDupes.push({
            tile: tile.label,
            baseColour: key === NULL_OPTION ? "(null)" : key,
            keptId: kept.id, droppedId: row.id, droppedFamily: row.family,
          });
          continue;
        }
        byOption.set(key, row);
      }

      // Resolve each curated option. A miss DROPS the chip and is reported —
      // never falls back to some other row, which would quietly sell the
      // salesman a product he did not choose.
      const resolve = (values: readonly string[]): V2Option[] => {
        const out: V2Option[] = [];
        for (const value of values) {
          const row = byOption.get(value);
          if (!row) {
            report.missingOptions.push({ tile: tile.label, option: value });
            continue;
          }
          if (row.packs.length === 0) {
            report.emptyPackChips.push({ tile: tile.label, option: value, rowId: row.id });
          }
          out.push({ value, row });
        }
        return out;
      };

      const hasOptions =
        curation.bases.length + curation.shades.length + curation.variants.length > 0;
      const noOptionRow = hasOptions ? null : (byOption.get(NULL_OPTION) ?? null);

      if (!hasOptions) {
        if (!noOptionRow) {
          report.missingOptions.push({ tile: tile.label, option: "(expected one NULL-baseColour row)" });
        } else if (noOptionRow.packs.length === 0) {
          report.emptyPackChips.push({ tile: tile.label, option: "(no-options row)", rowId: noOptionRow.id });
        }
      }

      byTile.set(tile.sap, {
        sap: tile.sap, label: tile.label, family: family.name,
        bases:    resolve(curation.bases),
        shades:   resolve(curation.shades),
        variants: resolve(curation.variants),
        noOptionRow,
        // The family override wins over the per-product ranking. See openTab.
        defaultTab: family.openTab ?? curation.defaultTab ?? "base",
        curated: true,
      });
    }
  }

  return { byTile, report };
}

// ── Shade colours ──────────────────────────────────────────────────────────

/**
 * Shade name -> swatch hex. Hand-authored, keyed by the EXACT `baseColour`
 * string, uppercased.
 *
 * ── WHERE THE VALUES COME FROM ───────────────────────────────────────────
 *
 * 🔴 dulux.in's OWN PER-SHADE PAGES — the colour is read off the shade page's
 * markup, e.g. /en/colour-palettes/gloss-oxford-blue-1975129. That source
 * replaced eleven earlier values on 2026-09-07 and supplied six new ones.
 *
 * NOT the shade-card PDF: its yellow plate is missing, so every value taken
 * from it ran cold. If a value here is ever questioned, the per-shade page is
 * the thing to check it against, and nothing else is.
 *
 * A shade Dulux does not publish a page for is NOT in this table. See the
 * still-unmapped list at the foot of it.
 *
 * 🔴 A NAME THAT IS NOT HERE GETS NO COLOUR. Not a guess, not a nearest match,
 * not a hash of the string — a text chip. A wrong colour on a paint order is
 * worse than no colour: the salesman reads the swatch, not the code, and a
 * plausible-but-wrong brown ships the wrong tin. Adding a shade means adding
 * a real value here, deliberately.
 */
const SHADE_HEX: Record<string, string> = {
  "BLACK":                 "#1D1E1F",
  "DARK BROWN":            "#4B2D25",
  "GOLDEN BROWN":          "#834A1E",
  "SMOKE GREY":            "#5E7D8C",
  "DA GREY":               "#6E7175",
  "GOLDEN YELLOW":         "#F3A000",
  "CLASSIC WHITE":         "#F4F1E6",
  "BRILLIANT WHITE":       "#FAF8F2",
  "PHIROZA BLUE":          "#1B8A9E",
  "PO RED":                "#8D2023",
  "BROWN":                 "#59352F",
  "RICH BROWN":            "#48332F",
  "TERACOTTA":             "#A5502F",
  "SIGNAL RED":            "#B3312C",
  "BUS GREEN":             "#005C3A",
  "WALNUT":                "#5C4033",
  "WHITE":                 "#FFFFFF",
  "OPAQUE WHITE":          "#FAFAF7",
  "RED OXIDE":             "#8C3A26",
  "YELLOW OXIDE":          "#C8981F",
  "BURNT SIENNA":          "#8A4B2A",
  "FAST VIOLET":           "#6B3FA0",
  "FAST RED":              "#CC2222",
  "FAST BLUE":             "#1F4FA8",
  "FAST GREEN":            "#1F7A4A",
  "FAST ORANGE":           "#E2701E",
  "FAST YELLOW":           "#EFC223",
  "FASTYELLOWGREEN":       "#9BB82E",
  "ORGANIC ORANGE":        "#E86A16",
  "ORGANIC VIOLET":        "#6B3FA0",
  "ORGANIC LEMON YELLOW":  "#EFD73B",
  "ORGANIC MIDDLE YELLOW": "#F0B71C",
  "BLUE":                  "#1F4FA8",

  // Added 2026-09-07, each one approved by name before it was written.
  //
  // 🔴 PHIROZA AND PHIROZA BLUE ARE DELIBERATELY DIFFERENT — DO NOT "FIX" IT.
  // They were identical on purpose for one day, because two hexes a shade
  // apart on the same colour read as a bug. The reason that no longer applies:
  // PHIROZA now carries Dulux's OWN published value (#0081B0, off its shade
  // page) and PHIROZA BLUE has no published page, so it keeps the earlier
  // hand-authored value. An authoritative value and a hand-authored one are
  // not the same kind of thing and should not be forced to agree.
  //
  // They also never meet: PHIROZA is on Gloss and PU Enamel, PHIROZA BLUE on
  // Promise Enamel, so no rail column ever shows both. If Dulux publishes a
  // Phiroza Blue page, take that value — do not copy PHIROZA's across.
  "PHIROZA":               "#0081B0",
  "DEEP ORANGE":           "#D2540B",
  "MAHOGANY":              "#6E2C1F",
  "TEAK":                  "#63483D",
  "ELECTRIC BLUE PLUS":    "#1560BD",
  "ORGANIC RED VIOLET":    "#9B3B7A",

  // ── SAMPLED FROM THE PRINTED CARD, 2026-09-10 ─────────────────────────
  //
  // 🔴 SAMPLED FROM THE PRINTED DULUX ENAMEL SHADE CARD BY SMART FLOW,
  // 2026-09-10. Measured off the physical card, not read off a screen and not
  // guessed — which is what this constant's no-guessing rule asks for: a value
  // may go in when somebody can say where it came from.
  //
  // ⚠ A DIFFERENT SOURCE FROM THE BLOCK ABOVE, and that matters if one is ever
  // questioned. Everything above came from dulux.in's per-shade pages. These
  // thirteen came from the card, because Dulux publishes no page for them. The
  // note at the head of this constant says the per-shade page is the thing to
  // check a value against; for THESE thirteen it is the card.
  //
  // ⚠ THIRTEEN OF THIRTY ROWS OFFERED WERE WRITTEN. Every key below was first
  // matched against the LIVE catalogue and confirmed to be a real baseColour
  // with no existing hex. What was NOT written, and why:
  //   · five CONFLICTED with a published dulux.in value already here — CHERRY,
  //     MAHOGANY, DA GREY, SAND STONE and DEEP ORANGE. An authoritative value
  //     is not overwritten by a sampled one without somebody choosing.
  //   · nine were already set to the identical value, so there was nothing to do.
  //   · BLAZING WHITE came with no value and stays unmapped.
  // The full verdict table is in the session record.
  //
  // ⚠ SIGNAL RED AND SIGNAL RED PLUS ARE TWO PRODUCTS AND WERE NOT CONFLATED.
  // The catalogue holds both: SIGNAL RED (Gloss, WS Protect, Floor Plus) which
  // already carries #B3312C, and SIGNAL RED PLUS (Floor Plus only) which has
  // no hex and did not get one here.
  "ROYAL IVORY":           "#F5CF98",
  "SKY BLUE":              "#2EA4C5",
  "LIGHT GREY":            "#CCCCCB",
  "DAWN":                  "#D8BAA3",
  "MINT GREEN":            "#419343",
  "DEEP GREEN":            "#1D2F28",
  "TRUCK BROWN":           "#634F35",
  "WILD PURPLE":           "#A7A3C8",
  "AQUAMARINE":            "#53B88D",
  "OFF WHITE":             "#F3D5A0",
  "PALE CREAM":            "#E7C482",
  "CASCADE GREEN":         "#A2AF73",
  "OPALINE GREEN":         "#7C9971",

  // ── SPECIAL TEAK AND TIMBER GOLDEN BROWN STOOD HERE, AND CAME BACK OUT ──
  //
  // Both were hand-authored guesses (#A56B2E and #BC8A3C), added on 2026-09-07
  // and REMOVED the same day. They were refused once on the grounds that as
  // bare squares they sit next to TEAK and GOLDEN BROWN as near-identical
  // browns; that refusal was overturned when a swatch + NAME chip made the
  // word decide, and it came back the moment the rail took the names off the
  // swatches and dulux.in's published browns landed. Measured on the rail:
  //
  //   before the dulux.in values   closest pair 7.9  (SPECIAL TEAK / TEAK)
  //   after them                   closest pair 5.9  (BROWN / RICH BROWN)
  //
  // 🔴 SO SUPER SATIN'S IS THE TIGHTEST CLUSTER IN THE APP, and a GUESSED
  // colour in the one place colours are hardest to tell apart is the worst
  // combination available. They are text tiles again, and the word is the only
  // thing that was ever deciding between them anyway. Do not re-add them
  // without a published Dulux value; a plausible brown is not a value.
  //
  // ⚠ THE CLUSTER IS STILL TIGHT WITHOUT THEM. BROWN #59352F, RICH BROWN
  // #48332F and TEAK #63483D are all published values and all within ΔE 8.2 of
  // each other. That is a known cost of using what Dulux prints rather than
  // colours chosen to separate, and the mitigation is the name bar and the
  // rail search — never a nudged hex, because a hex nudged to look different
  // is a wrong colour.

  // Added 2026-09-07 from the SAME dulux.in source as the replacements above.
  // MIDDLE BUFF and SAND STONE are keyed on the payload's spelling, not the
  // shade page's — Dulux writes "Midbuff" and "Sandstone", the menu row says
  // "MIDDLE BUFF" and "SAND STONE", and the KEY has to be the menu row or the
  // lookup silently misses. ROSEWOOD is the only one of the six that is not on
  // a board tile: it belongs to Wood Stain, which is reached through search.
  "OXFORD BLUE":           "#1C2A40",
  "CHERRY":                "#5C2428",
  "LEAF BROWN":            "#794830",
  "MIDDLE BUFF":           "#C48A42",
  "SAND STONE":            "#9A7C62",
  "ROSEWOOD":              "#824640",

  // 🔴 CLEAR / INT CLEAR / EXT CLEAR ARE PERMANENTLY ABSENT - DO NOT "FIX" THIS.
  // They are TRANSPARENT products. There is no colour to show, so a swatch
  // would be a lie; 2K Matt, Prime Matt and Prime Sealer stay text tiles.
  //
  // ── STILL UNMAPPED, ON PURPOSE — 2026-09-07 ─────────────────────────────
  //
  // Dulux publishes no per-shade page for these, so there is no authoritative
  // value and none is invented. They render as TEXT TILES in the rail, which
  // is the correct outcome: a wrong swatch ships a wrong order, a word does
  // not. Do not fill these from a screenshot, a PDF plate or a nearest match.
  //
  //   SKY BLUE · MINT GREEN · DEEP GREEN · AQUAMARINE · OFF WHITE
  //   PALE CREAM · ROYAL IVORY · CASCADE GREEN · OPALINE GREEN
  //   LIGHT GREY · DAWN · TRUCK BROWN · WILD PURPLE · SUNRISE
  //   RARE PEARL COPPER · RARE PEARL GREEN
  //   SPECIAL TEAK · TIMBER GOLDEN BROWN   (were mapped; withdrawn — see above)
  //
  // ⚠ THREE HAND-AUTHORED VALUES ARE KEPT ON PURPOSE, and they are the only
  // ones left in the table that Dulux does not publish a page for:
  //
  //   MAHOGANY #6E2C1F · TERACOTTA #A5502F · ELECTRIC BLUE PLUS #1560BD
  //
  // They stay because the risk that retires a guessed colour is CONFUSION WITH
  // A NEIGHBOUR, not the guess itself — and the neighbour that matters is the
  // NAME, not the hex.
  //
  // ⚠ MEASURED, BECAUSE "no near neighbours" IS NOT WHAT THE NUMBERS SAY. Two
  // of the three have a close colour beside them:
  //
  //   MAHOGANY   @ Gloss        7.5 from PO RED, 8.4 from CHERRY
  //              @ Super Satin  8.2 from BROWN, 11.9 from TEAK
  //   TERACOTTA  @ Dustproof    9.6 from SIGNAL RED, 14.5 from PO RED
  //   ELEC BLUE  @ Dustproof   41.6 from PO RED — genuinely alone
  //
  // They are kept anyway, and the reason is the NAMES. Nobody reaching for
  // Mahogany taps Cherry or PO Red by mistake: the words are nothing alike, so
  // the rail search finds it and the name bar confirms it. SPECIAL TEAK beside
  // TEAK, and TIMBER GOLDEN BROWN beside GOLDEN BROWN, are near-duplicate
  // WORDS on near-duplicate browns — the word could not break the tie because
  // the word was half the problem. That is the test, and it is a test about
  // names as much as colours: not "is the hex plausible" but "if he picks the
  // wrong one, is there anything on screen that would have told him".
  //
  // Also unmapped and never to be mapped: every Acotone (NO1, XY1...) and
  // Machine Tinter (YOX, TBL...) colorant CODE.
};

/** The swatch for a shade name, or undefined when it has none. Case-insensitive
 *  because Sadolin stores title case ("Opaque White") and everyone else caps. */
export function shadeHex(value: string): string | undefined {
  return SHADE_HEX[value.trim().toUpperCase()];
}

/**
 * WCAG relative luminance. Above 0.85 the swatch is near-white and needs an
 * inner border, or a white chip on a white sheet simply is not there.
 */
export function isLightHex(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = chan((n >> 16) & 255), g = chan((n >> 8) & 255), b = chan(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.85;
}

// ── THE ΔE CLOSE-PAIR RULE — RETIRED 2026-09-07, RECORDED HERE ─────────────
//
// deltaE2000(), labOf(), shadeRowMode(), CLOSE_DE, TWINS_DE and the V2ChipStyle
// type stood here until the drawer's chip row became a RAIL. They are removed
// because the rail leaves nothing to call them: the question they answered —
// "does this whole row render as colour, or as swatch+name, or as text?" — is
// no longer asked. A rail tile decides for ITSELF, from one fact: a name in
// SHADE_HEX gets a swatch, a name that is not there gets a text tile. Mixed
// columns are now the intended outcome, not the thing the rule existed to
// prevent. Grepped before deleting: product-drawer.tsx was the only caller of
// any of them, and it no longer has a chip row.
//
// WHAT THE RULE WAS, so it is not re-derived from scratch if a row-level
// decision is ever wanted again — it is in git at 2679c189:
//
//   Perceptual distance, CIE Lab / D65, ΔE2000 — because plain RGB distance is
//   useless here: #6B4423 and #4A2C1A are far apart in RGB and all but
//   identical as two squares on a phone. A row went to swatch+name when it had
//   TWO OR MORE pairs within ΔE 12, or ANY single pair within ΔE 6; otherwise
//   bare squares. Measured on the live curation:
//
//     Super Satin     6 close pairs of 21, closest  7.9  -> swatch + name
//     Gloss           1 close pair  of 36, closest 10.4  -> bare squares
//     Uni Stainer     1 close pair  of 45, closest 11.9  -> bare squares
//     Promise Enamel  0 close pairs of 36, closest 17.3  -> bare squares
//     PU Enamel       0 close pairs of 10, closest 17.3  -> bare squares
//     Stay Bright     0 close pairs of 1,  closest 19.8  -> bare squares
//
//   COUNTING pairs rather than taking the minimum was the whole point: one
//   ambiguous pair among nine well-separated colours is survivable, five browns
//   are not, and no single-minimum threshold separates those two cases without
//   landing in the 2.5-point gap between 7.9 and 10.4.
//
// 🔴 WHAT THE RULE PROVED IS STILL TRUE, and the rail answers it a different
// way: Super Satin's browns cannot be told apart as bare squares. They are
// still bare squares — but the NAME BAR above the packs spells the selection
// out at 15px the moment a tile is tapped, which is a bigger, later and more
// legible check than a caption on a chip ever was. The hexes themselves, each
// approved by name, are untouched above.

// ── Drawer shape ───────────────────────────────────────────────────────────

export type V2DrawerMode = "single" | "flat" | "standard";

/** Every distinct RENDERED pack label a product sells, across all its options. */
export function packsOf(rows: ApiProduct[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const p of r.packs) seen.add(formatPack(p.packCode, p.unit));
  // Array.from, not spread — the tsconfig target is below ES2015 and a Set
  // spread does not downlevel (CLAUDE.md §1).
  return Array.from(seen);
}

/**
 * 🔴 THE ONE PLACE THE DRAWER'S SHAPE IS DECIDED. Option count first, then
 * pack count. Nothing else in v2 may re-derive this.
 *
 *   1 option           -> single  : no chips, straight to packs, ANY pack count
 *   2+ options, 1 pack  -> flat    : every option listed, a stepper on each
 *   2+ options, 2+ packs-> standard: pick an option, then its packs
 *
 * GRID (options down, packs across) WAS a fourth outcome and is deleted: the
 * bare "+" cell read as inert and the minus was invisible until you had
 * already tapped. Uni Stainer, 2K Matt, Prime Matt and Prime Sealer return to
 * standard, the pattern that already works.
 *
 * ⚠ `single` IS NOT A NEW CODE PATH. The nine one-option products already open
 * straight to their packs: their curated lists are all empty, so the drawer's
 * control block never renders (its gate is `hasVariants || activeList.length`)
 * and `selectedRow` falls through to `noOptionRow`. This mode NAMES that
 * existing behaviour so the census can report it; it does not re-implement it.
 * Measured live 2026-09-07: 9 single, 4 flat, 19 standard.
 */
export function drawerMode(rows: ApiProduct[]): V2DrawerMode {
  if (rows.length <= 1) return "single";
  const packs = packsOf(rows).length;
  if (packs <= 1) return "flat";
  return "standard";
}

/**
 * Is this option a BASE — something a machine tints into — or a finished
 * shade a dealer buys off the shelf?
 *
 * 🔴 A NAME RULE, DELIBERATELY, AND IT REPLACES A productType RULE THAT WAS
 * WRONG. The payload types some ready-made colours as BASE_VARIANT: on Gloss
 * that put BLAZING WHITE, CLASSIC WHITE and OFF WHITE on the Base tab, where a
 * dealer would never look for them. They are finished paint, not tinting bases.
 *
 * The rule is exactly two clauses, and it is case-insensitive because Sadolin
 * stores "90 Base" in title case while everyone else stores "90 BASE":
 *   - the name contains "BASE"  (90 BASE, 94 BASE, GREEN BASE, PASTEL BASE)
 *   - or the name IS Brilliant White (or its "BW" short form)
 * Everything else is a shade, whatever productType says.
 *
 * DISPLAY ONLY. `productType` is not rewritten and the payload is not touched;
 * this decides which tab an option appears under and nothing else.
 */
export function isBaseOption(value: string): boolean {
  const v = value.trim().toUpperCase();
  return v.includes("BASE") || v === "BRILLIANT WHITE" || v === "BW";
}

/**
 * 🔴 THE BASE COLUMN SORTS IN SEQUENCE, NOT BY SALES.
 *
 *   BW first, then numeric ascending (90, 92, 93, 94, 95, 96, 97, 98, 99),
 *   then named bases (GREEN BASE, PASTEL BASE) alphabetically.
 *
 * A NUMBERED SERIES ALREADY HAS AN ORDER THE SALESMAN KNOWS, and sorting it by
 * sales destroys the one thing that made it findable — he ends up hunting for
 * 93 somewhere between BW and 90. Frequency ordering is right for SHADES, where
 * there is no natural sequence and the top of the column is the curation, and
 * wrong for BASES, where the sequence is the curation. Shades and variants are
 * untouched by this.
 *
 * Sadolin's title-case "90 Base" sorts by its number like everyone else's
 * "90 BASE": the match is case-insensitive.
 *
 * ⚠ THIS SORTS THE COLUMN, IT DOES NOT CHOOSE THE DEFAULT. The drawer still
 * pre-selects the most-ORDERED base, which after this sort is usually not the
 * first tile. Those are two different jobs: the sequence is for finding, the
 * default is for selling, and making the default follow the sort would quietly
 * change what Protect Hi-Sheen and Max send when nobody touches the rail.
 */
export function sortBases(options: V2Option[]): V2Option[] {
  const rank = (value: string): [number, number, string] => {
    const v = value.trim().toUpperCase();
    if (v === "BRILLIANT WHITE" || v === "BW") return [0, 0, ""];
    const m = v.match(/^(\d+)\s+BASE$/);
    if (m) return [1, Number(m[1]), ""];
    return [2, 0, v];
  };
  return [...options].sort((a, b) => {
    const ra = rank(a.value), rb = rank(b.value);
    if (ra[0] !== rb[0]) return ra[0] - rb[0];
    if (ra[1] !== rb[1]) return ra[1] - rb[1];
    return ra[2].localeCompare(rb[2]);
  });
}

/**
 * The base and shade pools the RAIL's two groups are built from, split by
 * isBaseOption().
 *
 * Both pools are drawn from EVERY option the product has, so nothing in the
 * catalog is unreachable: whatever is not a base is a shade, and the two are
 * exhaustive and disjoint. The drawer lists the ranked curation first and
 * appends whatever these hold that the ranking does not name.
 */
export function optionPools(
  rows: ApiProduct[],
): { all: V2Option[]; bases: V2Option[]; shades: V2Option[] } {
  const all = allOptionsFor(rows);
  const bases: V2Option[]  = [];
  const shades: V2Option[] = [];
  for (const opt of all) (isBaseOption(opt.value) ? bases : shades).push(opt);
  return { all, bases, shades };
}

// 🔴 chipLimit() IS GONE, AND SO IS THE IDEA BEHIND IT. It decided how many
// chips a row showed before "+ More" — the top 4 bases, the top 9 shades — and
// it was the last survivor of a cut that had already been rebuilt three times.
// A cut only exists because a horizontal row is finite. The rail is a vertical
// column that scrolls, so it holds EVERY option in rank order and hides none:
// the top of the column is the curation, and there is nothing behind anything.
// Deleted 2026-09-07 with "+ More" itself; in git at 2679c189 if the reasoning
// is ever wanted.

/**
 * Turn a whole searched PRODUCT into something the drawer can open on.
 *
 * A tile hands back its curated resolution untouched — searching "gloss" and
 * tapping its tile must land on the same six shades and four bases, or the
 * board and the search would teach two different products.
 *
 * A non-tile (most of the 143 catalog products) gets its options straight from
 * the payload, ordered by sortOrder — the depot's own order — IN FULL. Nothing
 * cuts it, here or later: the drawer puts the whole list in one rail column
 * with no group toggle, because an uncurated list has no base/shade split to
 * offer.
 */
export function resolveGroup(
  key: string,
  rows: ApiProduct[],
  label: string,
  byTile: Map<string, V2Resolved>,
): V2Resolved {
  const tile = byTile.get(key);
  if (tile) return tile;

  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  // hasOption(), not `!== null` — a blank baseColour is a product with no
  // options, exactly like a NULL one. See RULE 2; this test is where the
  // empty string used to slip through and become an unorderable option.
  const single = ordered.length === 1 && !hasOption(ordered[0].baseColour);

  return {
    sap: key,
    label,
    family: ordered[0]?.family ?? "",
    bases: single ? [] : ordered
      .filter((r) => hasOption(r.baseColour))
      .map((r) => ({ value: r.baseColour as string, row: r })),
    shades: [],
    variants: [],
    noOptionRow: single ? ordered[0] : null,
    defaultTab: "base",
    curated: false,
  };
}

/**
 * EVERY option a product has, in catalog order.
 *
 * Passed to the drawer alongside the ranked curation; the rail shows the
 * ranking first and then whatever this holds that the ranking does not name,
 * so one column is the complete list.
 */
export function allOptionsFor(rows: ApiProduct[]): V2Option[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    // 🔴 THE THIRD PLACE "" COULD BECOME AN OPTION, and the one that would
    // have survived fixing the other two: optionPools() is built from this,
    // the drawer's rail is built from optionPools(), so a blank row left here
    // would still have drawn a nameless 44px tile the salesman could tap.
    .filter((r) => hasOption(r.baseColour))
    .map((r) => ({ value: r.baseColour as string, row: r }));
}

// ── Cart ───────────────────────────────────────────────────────────────────

export type V2CartLine = {
  id:      string;
  /** Which board tile produced this line — drives the tile badge + fill. */
  tileSap: string;
  label:   string;
  /** The chosen baseColour, or null for a no-options product. */
  option:  string | null;
  /** The resolved menu row's id — the catalog anchor. */
  rowId:   number;
  /**
   * 🔴 THE THREE FIELDS emailLineLabel() READS, snapshotted from the menu row.
   *
   * The wire name is NOT our tile label. `label` above is the curated board
   * word ("Smart Choice", "M900") and must never reach an email — /po sends
   * emailLineLabel(product, baseColour, subProduct) for that same row, and v2
   * has to send the identical string or the parser sees a different product.
   */
  product:    string | null;
  baseColour: string | null;
  subProduct: string;
  /** Rendered pack label -> quantity in UNITS. Only non-zero entries kept. */
  qtys:    Record<string, number>;
  /**
   * The row's pack labels in CATALOG order, snapshotted at add time.
   *
   * `qtys` is a Record, so its key order is the order the salesman TAPPED —
   * fine for a total, wrong for a printed pack string. The payload sorts packs
   * ascending by millilitres with KG last (route.ts:21-28), and step 9's email
   * has to match /po byte for byte, so the order has to come from the catalog
   * rather than from the order of his thumbs.
   */
  packOrder: string[];
};

/**
 * Pack labels for one row, smallest first, KG last and IN ORDER.
 *
 * 🔴 THE PAYLOAD'S SORT IS BLIND TO KG, AND THAT IS THE WHOLE REASON THIS
 * EXISTS. route.ts:21-28 compares `packToMl`, and packToMl returns **0 for
 * every KG, GM and PC pack** (pack.ts:47) because they are not litres. So the
 * comparator sees 0 against 0 for a KG product, the sort is stable, and the
 * packs come back in database insertion order: Acrylic Distemper arrives as
 * 10KG, 20KG, 5KG.
 *
 * Measured against the live catalogue 2026-09-10: **6 of 347 multi-pack rows**
 * are affected and every one of them is KG — Smart Choice's Acrylic Distemper,
 * VT Concrete Finish, both Magik bases, Acrylic Distemper's Duwel row and
 * Acrylic Putty. No ML or L product moves; the payload already gets those
 * right.
 *
 * 🔴 pack.ts ALREADY KNOWS HOW, so this uses `sortPacks` rather than writing a
 * second rule. That function has a dedicated KG branch comparing the numeric
 * pack code, which is exactly the case the payload's comparator drops. The
 * labels are still rendered by THIS file's formatPack, so nothing about how a
 * pack is spelled changes — only the order.
 */
export function sortedPacks(packs: ApiPack[]): ApiPack[] {
  const byKey = new Map<string, ApiPack>();
  for (const p of packs) byKey.set(packKey(p.packCode, p.unit), p);
  return sortPacks(Array.from(byKey.keys()))
    .map((k) => byKey.get(k))
    .filter((p): p is ApiPack => p !== undefined);
}

/**
 * The ordered packs of one line, smallest first, zero quantities dropped.
 *
 * `packOrder` is sorted by sortedPacks() at the moment the line is built
 * (po-v2-page's addLines), so this is a filter, not a re-sort.
 *
 * Returned as ROWS rather than a joined string: a review line is what somebody
 * checks a physical load against, and "100ML ×24, 200ML ×12, 500ML ×12, 1L ×6"
 * wrapping across two lines is not checkable. One pack per row, right-aligned
 * and tabular, is.
 */
export function packRows(line: V2CartLine): { label: string; qty: number }[] {
  return line.packOrder
    .filter((label) => (line.qtys[label] ?? 0) > 0)
    .map((label) => ({ label, qty: line.qtys[label] }));
}

/**
 * DISPLAY-ONLY chip text for a BASE.
 *
 * 🔴 THE WIRE VALUE IS UNTOUCHED. This is called in JSX and nowhere else: the
 * selection state, the cart line and the email all carry the raw `baseColour`
 * ("90 BASE", "BRILLIANT WHITE") straight off the menu row. Changing what the
 * chip says must never change what the depot is asked for.
 *
 * Scoped to bases on purpose — "BRILLIANT WHITE" is also a SHADE on GVA and
 * Promise Enamel, and shortening it to "BW" there would rename a colour.
 */
export function baseChipLabel(value: string): string {
  const v = value.trim();
  if (/^brilliant\s+white$/i.test(v)) return "BW";
  const m = v.match(/^(.+?)\s+base$/i);   // "90 BASE" and Sadolin's "90 Base"
  return m ? m[1] : v;
}

// ── Order-level fields ─────────────────────────────────────────────────────
// 🔴 THESE MIRROR lib/place-order/email.ts's TYPES EXACTLY (EmailDispatch,
// EmailCallTarget, EmailMarker — read 2026-09-06). Mirrored, not imported:
// step 9 does the importing. If they drift, the email silently stops matching
// what /po sends and the parser's app-format path stops recognising it.
//
// Dispatch is TWO fields, not one. "Call" is not a complete state — email.ts
// emits "Call to " + (callTarget ?? "SO"), so a Call with no target silently
// becomes a Call to SO. The UI surfaces both rather than hiding that default.

export type V2Dispatch   = "Normal" | "Urgent" | "Call";
export type V2CallTarget = "SO" | "Dealer";
export type V2Marker     = "Truck" | "Cross Delivery" | "Bounce" | "DTS" | null;

export type V2Order = {
  dispatch:   V2Dispatch;
  callTarget: V2CallTarget;
  marker:     V2Marker;
  crossDepot: string;
  notes:      string;
};

/** Defaults = the state email.ts OMITS from the body: no Dispatch, no Remark. */
export const EMPTY_ORDER: V2Order = {
  dispatch: "Normal", callTarget: "SO", marker: null, crossDepot: "", notes: "",
};

/**
 * The depots a cross-billing order can be billed FROM.
 *
 * ⚠ THIS IS THE SECOND COPY. The first is `CROSS_DEPOTS` in
 * app/po/po-page.tsx:89, which is LIVE and out of v2's containment fence — v2
 * modifies nothing outside app/po2/. The two must be edited together
 * until they are unified into one shared const; that unification is parked on
 * ROADMAP.md under `/po2`, because doing it now means editing v1.
 *
 * 🔴 THE LIST DOES NOT VALIDATE ANYTHING. `crossDepot` is a free string on
 * V2Order and stays one: drafts saved before the picker existed hold a
 * hand-typed depot, which may be a fifth name, a misspelling or a lowercase
 * one. Those still render and still reach buildSubject exactly as typed. This
 * array is what the SHEET OFFERS, never a whitelist a stored value is checked
 * against — the moment it becomes one, somebody's saved order loses its depot.
 */
export const CROSS_DEPOTS = ["Dahisar", "Ahmedabad", "Rajkot", "Pune"] as const;

/**
 * THE SCREEN TITLE. One scale, every screen that has a title.
 *
 * 🔴 IT IS THE BIGGEST TEXT ON ANY SCREEN AND IT NAMES THE SCREEN. On checkout
 * that is the DEALER — the order is "for MOHAN COLOUR CO" and nothing else on
 * that page outranks whose account it goes on. On the dealer and ship-to
 * pickers it is the question being asked. Same job, so one number.
 *
 * 🔴 20/700 IS NOT A NEW INVENTION. The order-detail screen has shipped its
 * h1 at exactly 20 / bold / -.02em since it was built (order-sheet.tsx, "T1
 * screen title"). This constant is that value given a name so the other two
 * screens can point at it instead of hand-typing 16 and 17 — which is what
 * they did, and why no two screen titles in this app were the same size.
 *
 * ⚠ order-sheet.tsx STILL HAND-TYPES ITS OWN. It is outside this step's
 * containment; point it here the next time that file is open. Three call sites
 * agreeing by accident is the state this constant exists to end.
 *
 * ⚠ THE SUBORDINATE LINE UNDER IT IS NOT SCALED FROM THIS. A mono meta line
 * grown in proportion to a 25% title bump reads as a second title. Order
 * detail pairs this size with an 11px mono line; checkout pairs it with 12.5.
 * Both are deliberate and neither is derived.
 */
export const SCREEN_TITLE: React.CSSProperties = {
  fontSize:      20,
  fontWeight:    700,
  letterSpacing: "-0.02em",
  lineHeight:    1.25,
};

/**
 * THE DEALER NAME in the checkout header. Related to SCREEN_TITLE, not equal
 * to it, and it has its own constant because it stopped doing the same job.
 *
 * 🔴 WHY IT FORKED. SCREEN_TITLE is "the biggest text on the screen, and it
 * names the screen" — one line, alone, with nothing beside it. That is still
 * exactly what the dealer and ship-to pickers show. The checkout header is no
 * longer that shape: the name shares its row with two 44px icon buttons and
 * shares its column with a code line, and it has to WRAP inside what is left.
 * At 20 it fitted about 17 characters a line there and cut real dealers in
 * half; 17px fits about 21. Same family, same tracking, different job — so the
 * picker keeps SCREEN_TITLE untouched and checkout points here.
 *
 * 🔴 THE LINE HEIGHT IS PX, NOT A RATIO, AND THAT IS LOAD-BEARING. The header
 * reserves a fixed block so it cannot change height when a long dealer is
 * picked (see NAME_BLOCK_H in review-screen.tsx). That reservation is two of
 * THIS line box plus the code line, and arithmetic on a unitless ratio is how
 * a reservation quietly stops matching what it reserves. Change this and the
 * two constants over there must change with it.
 */
export const DEALER_TITLE: React.CSSProperties = {
  fontSize:      17,
  fontWeight:    600,
  letterSpacing: "-0.02em",
  lineHeight:    "21px",
};

/** Shared chip shell. Selected is an OUTLINE + tint, never a solid violet fill. */
export function chipStyle(selected: boolean, dashed = false): React.CSSProperties {
  return {
    border:       `1.5px ${dashed ? "dashed" : "solid"} ${selected ? VIOLET : RULE}`,
    borderRadius: 11,
    background:   selected ? VIOLET_BG : "#fff",
    color:        INK,
  };
}

/**
 * Total UNITS in one set of quantities — a plain sum, nothing else.
 *
 * 🔴 THERE IS DELIBERATELY NO BOX COUNT ANYWHERE IN v2. An earlier cut divided
 * qty by the carton size and reported boxes to one decimal; "2.5 boxes" is not
 * a thing anyone can pick, load or check on a depot floor. Units are always
 * whole, so every number this app shows is a number a person can act on.
 */
/**
 * 🔴 snapToBox WAS HERE AND IS GONE — owner ruling 2026-09-09.
 *
 * It rounded a typed figure to the nearest whole box with one box as the
 * floor, so 9 typed on a six-per pack became 12 and 1 became 6. The argument
 * for it was that the depot cannot pick part of a carton. The depot's answer
 * is that it can, and a salesman who could not ask for nine was the larger
 * problem. v1 has never snapped (`app/po/po-page.tsx:1723`), so the two pages
 * disagreed on what a typed number means — which is exactly the kind of
 * divergence the successor-parity gate exists to catch.
 *
 * Recorded rather than deleted silently, because the reasoning above is
 * plausible enough to be reinvented. It was tried, it shipped, and it was
 * ruled against. Step drives +/- and the "per N" sub-label; it does not touch
 * a typed figure.
 */

export function unitsIn(qtys: Record<string, number>): number {
  let units = 0;
  for (const qty of Object.values(qtys)) {
    if (qty > 0) units += qty;
  }
  return units;
}

// ── Customer search ────────────────────────────────────────────────────────
// No shared helper exists for this anywhere in the app: /po filters inline at
// po-page.tsx:1139-1145 and the desktop page has its own copy at
// customer-search.tsx:57-62. Neither is exported, so this is written here
// rather than imported — and it is deliberately stricter than either.

const SEARCH_CAP = 30;

/**
 * THREE TIERS, in this order: code-PREFIX, then NAME-contains, then
 * code-SUBSTRING. Case-insensitive, each tier alphabetical by name, the whole
 * list capped at 30.
 *
 * The third tier is what restores parity with /po's `code.includes(q)`
 * (po-page.tsx:1143) — a dealer whose code merely CONTAINS the digits is still
 * findable. Keeping it in its own tier below the other two is the point: as a
 * flat rule it floods the top, because typing "24" matches every 6-digit code
 * with a 24 anywhere in it. Tiered, the dealer whose code STARTS with what was
 * typed still wins, and the loose matches wait underneath.
 */
export function searchCustomers(customers: ApiCustomer[], rawQuery: string): ApiCustomer[] {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 1) return [];

  const codePrefix: ApiCustomer[] = [];
  const nameHits:   ApiCustomer[] = [];
  const codeSub:    ApiCustomer[] = [];
  for (const c of customers) {
    const code = c.code.toLowerCase();
    if (code.startsWith(q))                    codePrefix.push(c);
    else if (c.name.toLowerCase().includes(q)) nameHits.push(c);
    else if (code.includes(q))                 codeSub.push(c);
  }
  const byName = (a: ApiCustomer, b: ApiCustomer): number => a.name.localeCompare(b.name);
  codePrefix.sort(byName);
  nameHits.sort(byName);
  codeSub.sort(byName);
  return [...codePrefix, ...nameHits, ...codeSub].slice(0, SEARCH_CAP);
}

// ════════════════════════════════════════════════════════════════════════════
// THE 9 × 4 BOARD — ADDITIVE, AND NOT YET CONSUMED BY ANYTHING
// ════════════════════════════════════════════════════════════════════════════
//
// 🔴 EVERYTHING ABOVE THIS LINE IS UNTOUCHED. FAMILIES still holds the live
// 32-tile board and po-v2-page.tsx still renders from it; TILE_ART, TILE_SLUG,
// tileArtFor and buildCatalog are byte-for-byte what they were. This section
// adds a SECOND, richer board beside them. Step 2 owns po-v2-page.tsx and
// switches the render over; until it does, nothing here runs on a phone.
//
// The whole safety property of this step is that the board renders identically
// today, so the live constant could not be rewritten in place — see the note
// at the foot of this section.
//
// ── WHAT A TILE IS NOW ────────────────────────────────────────────────────
//
// One tile, several PRODUCTS. Two reasons, and they are different:
//
//   1. Two rows the customer reads as one thing — 2K PU Matt and 2K PU Gloss
//      are the same tin in two finishes.
//   2. Four tiles per family, no exceptions. A family with a fifth seller
//      merges its tail rather than dropping it to search-only.
//
// 🔴 ONE SHAPE, ALWAYS AN ARRAY. A single-product tile is a ONE-MEMBER tile,
// not a separate branch. A branch would take the 32 single tiles off the code
// path everyone edits, and that is precisely how `needsShade` demanded a shade
// from nine products that had none, and how an empty-string baseColour made 37
// products unorderable while the screen looked perfectly normal. Both hid for
// months in the path nobody exercised. There is one path here.

/** One product inside a tile. `sap` is the catalog join key. */
export type V2Member = {
  /** COALESCE(product, subProduct) — the same key buildCatalog joins on. */
  sap:   string;
  /** What the rail says and what the cart line will store. Display only. */
  label: string;
  /** Per-member art — product-<sap>.webp. Unset means "no photo of its own". */
  slug?: string;
  /**
   * 🔴 PIN THIS MEMBER TO ONE CATALOG ROW — the row whose baseColour is exactly
   * this string.
   *
   * A PRODUCT THAT IS REALLY TWO PRODUCTS. Wood Primer ships in White and Pink
   * and nothing else; they are not "a colour you choose", they are two things a
   * dealer asks for by name. Left as one member with a two-option rail, it made
   * the whole Primers tile carry a product strip so that ONE of its seven
   * members could offer a choice — six products paying for the seventh.
   *
   * A pinned member resolves to exactly one row, shows no picker, and its cart
   * line carries THAT ROW's product / baseColour / subProduct, so
   * emailLineLabel prints "Wood Primer White" and "Wood Primer Pink" with
   * nothing in this file touching the wire.
   *
   * ⚠ THE MATCH IS CASE-SENSITIVE AND MUST STAY SO. The live rows are
   * baseColour "White" (id 21910) and "PINK" (id 21911) — the catalog is not
   * consistent, and that is exactly why this compares raw rather than folding
   * case: the string written here has to be the string that is stored, so a
   * typo fails loudly at build time (the member is reported missing) instead of
   * quietly matching the wrong row. Normalising would hide the day two rows
   * differ only by case.
   */
  option?: string;
  /**
   * 🔴 PUT THIS MEMBER UNDER A CATEGORY CHIP. A tile whose members carry one
   * becomes the fourth drawer shape: categories across the top, that category's
   * PRODUCTS in the rail, that product's packs in the pane.
   *
   * BOTH ZONES ARE SPENT, so every member of such a tile must have NOTHING to
   * choose — no options at all, or exactly one that is pinned above. The Wood
   * family is the case that asked for it: twenty-one leftovers with no colour
   * between them, which a product strip could not hold and a flat rail could
   * not sort. buildBoard() THROWS if a categorised member turns out to have an
   * unpinned options level, so the mistake is caught the first time the board
   * is built and not by a salesman looking at a rail he cannot use.
   *
   * The categories' ORDER is first appearance in this array — no separate list
   * to keep in step with the members.
   */
  category?: string;
};

export type V2BoardTile = {
  /**
   * 🔴 A FROZEN HISTORICAL STRING. IT IS NOT DERIVED FROM members[0].
   *
   * It WAS, until 2026-09-09 — "Scheme A", the tile key is the top seller's
   * own catalog join key — and BOARD_INVARIANTS enforced it. The values below
   * are all still exactly what that rule produced; not one was changed when the
   * rule went. What changed is that they no longer MOVE.
   *
   * ⚠ SOME NO LONGER MATCH THE FIRST PRODUCT, AND THAT IS CORRECT. Eterna's key
   * is "VT ETERNA MATT" and Matt is now the second member. Hydro PU's is
   * "HYDRO PU DEAD MATT" and Dead Matt is now the fourth. Do not "tidy" either
   * one, and do not re-derive.
   *
   * 🔴 WHY THE RULE HAD TO GO. Deriving the key from members[0] meant that
   * REORDERING A DRAWER RENAMED THE TILE. Favourites are stored on tile keys
   * (po2_fav_products), so putting Eterna above Matt would have silently
   * deleted every stored Eterna favourite on the next load — nothing thrown,
   * nothing logged, a tile just gone from someone's board. The owner asked for
   * two such reorders and both were blocked at 985f075f for exactly this.
   *
   * 🔴 SO CHANGING A KEY VALUE DELETES SOMEONE'S FAVOURITE. That is now the
   * only rule about this field, and it is the reason the values are frozen
   * rather than tidied. A key is an identifier, not a description.
   *
   * WHAT SCHEME A BOUGHT, AND WHAT IS KEPT. Choosing a real member sap over a
   * synthetic string meant 29 of the 32 pre-merge cart lines needed no
   * migration at all. Those saps are still the values, so that still holds.
   * tileKeyForMember() is still the derived index that finds a tile from any
   * member, and migrateLine() still refiles a stored line whose tileSap has
   * gone stale — see v2-storage. Never replace either with a hand-written
   * table of whichever saps happened to move.
   *
   * ⚠ ONE CONSEQUENCE, RECORDED BECAUSE IT IS SUBTLE. migrateLine's case 3
   * argues it is "idempotent by construction" because a tile's key IS its top
   * member's sap, so a product that is on no tile cannot have a sap that is a
   * live tile key. Every frozen value below is still SOME member's sap, so
   * that argument survives today. It would break if a future edit removed the
   * member a key was named after while keeping the key. If you ever do that,
   * re-read migrateLine before you commit it.
   */
  key:     string;
  label:   string;
  slug:    string;
  /**
   * Ordered by 90-day line frequency, then by the owner's own curation.
   * members[0] is what the drawer pre-selects and what inherits the tile's
   * photograph (LEADER_TILE) — but it no longer decides the key.
   */
  members: readonly V2Member[];
};

export type V2BoardFamily = {
  name:     string;
  tint:     string;
  openTab?: "base" | "shade";
  tiles:    readonly V2BoardTile[];
};

/**
 * 🔴 NINE FAMILIES. THE TILE COUNT PER FAMILY IS BOUNDED, NOT FIXED — see
 * FAMILY_MIN / FAMILY_MAX. It was exactly four until 2026-09-08, when Wood took
 * a fifth for Hydro PU.
 *
 * Membership and member ORDER are generated from the same 90-day mail-order
 * ranking as CURATION (lines resolved skuCode -> mo_sku_lookup_v2.material ->
 * product, matched on COALESCE(product, subProduct)), then frozen here so a
 * list can be overridden by name without re-running anything. Re-rank
 * deliberately, never on every deploy — the board must not reshuffle under a
 * salesman who has learned where things are.
 *
 * Proved against the live payload 2026-09-07: 36 tiles, 106 members, every sap
 * present, no sap on two tiles, all 32 of today's saps surviving as a key or a
 * member, no two members of one tile sharing a rowId.
 */
export const BOARD: readonly V2BoardFamily[] = [
  {
    name: "Enamel",
    tint: "#F8F0E0",
    openTab: "shade",
    tiles: [
      { key: "GLOSS", label: "Gloss", slug: "gloss",
        members: [{ sap: "GLOSS", label: "Gloss" }] },
      { key: "SUPER SATIN", label: "Super Satin", slug: "super-satin",
        members: [{ sap: "SUPER SATIN", label: "Super Satin" }] },
      { key: "PROMISE ENAMEL", label: "Promise Enamel", slug: "promise-enamel",
        members: [{ sap: "PROMISE ENAMEL", label: "Promise Enamel" }] },
      // PU Enamel gives up its own tile at 61 lines/90d — the weakest tile on
      // today's board — and buys homes for three products that had none.
      { key: "PU ENAMEL", label: "More Enamels", slug: "pu-enamel",
        members: [
          // 🔴 ITS OWN FILE, NOT THE TILE'S. This member used to have no slug
          // and inherited the More Enamels tile art through LEADER_TILE. That
          // works only while PU Enamel is members[0] — reorder the drawer and
          // the picture would follow whoever led instead. The slug matches the
          // tile's on purpose: public/PO/board/ and public/PO/drawer/ hold the
          // same bytes under the same name, which is the duplication the owner
          // asked for and the cost of making it explicit.
          { sap: "PU ENAMEL",  label: "PU Enamel", slug: "pu-enamel" },
          { sap: "5IN1 GLOSS", label: "5in1 Gloss", slug: "product-5in1-gloss" },
          { sap: "LUSTRE",     label: "Lustre", slug: "product-lustre" },
          { sap: "M900 GLOSS", label: "M900 Gloss" },
        ] },
    ],
  },
  {
    name: "Interior",
    tint: "#E8EFFA",
    tiles: [
      { key: "SATIN STAY BRIGHT", label: "Stay Bright", slug: "stay-bright",
        members: [{ sap: "SATIN STAY BRIGHT", label: "Stay Bright" }] },
      // Supercover Sheen moved here from More Interior 2026-09-07. It has
      // still never been ordered — 0 lines and 0 orders across the whole
      // history — but it is a Supercover, and a range sits with its range.
      // More Interior is the leftovers drawer, not a home for a product that
      // has one.
      { key: "SUPERCOVER", label: "Supercover", slug: "supercover",
        members: [
          { sap: "SUPERCOVER",       label: "Supercover", slug: "product-supercover" },
          { sap: "SUPERCOVER SHEEN", label: "Sheen" },
        ] },
      { key: "SUPERCLEAN", label: "SuperClean", slug: "superclean",
        members: [
          { sap: "SUPERCLEAN",      label: "SuperClean", slug: "product-superclean" },
          { sap: "SUPERCLEAN 3IN1", label: "3in1", slug: "product-superclean-3in1" },
        ] },
      // ═══════════════════════════════════════════════════════════════════
      // 🔴 "MORE INTERIOR" WAS HERE AND IS GONE — 2026-09-10.
      //
      // It was key "ACRYLIC PUTTY", slug "more-interior", holding Acrylic
      // Putty and PolyPutty. Spray Paint took its slot below.
      //
      // WHERE THE PUTTIES WENT: nowhere. Nothing was removed from the
      // catalogue, from any keyword map or from any search path — this was a
      // BOARD MEMBERSHIP change and only that. Both are family PUTTY with full
      // searchTokens ("ACRYLIC PUTTY,PUTTY,ACRYLIC,PREP" and
      // "POLYPUTTY,POLY PUTTY,PUTTY,DUWEL,PREP"), and all four keyword
      // promotions — putty, acrylic putty, polyputty, poly putty — still
      // resolve to family PUTTY. They are search-only now, which is what
      // SPRAY PAINT was until this commit.
      //
      // 🔴 AND "ACRYLIC PUTTY" IS NO LONGER ANY TILE'S KEY. That matters more
      // than the label. The frozen-key rule was NOT spent here: rather than
      // rename this tile and leave its key naming a product it no longer held,
      // the tile went and Spray Paint arrived with a key of its own. The
      // difference is not cosmetic —
      //
      //   addLines filters `l.tileSap === tileKey` (po-v2-page.tsx:709). Had
      //   the key stayed while the members changed, opening the new drawer and
      //   adding anything would have DELETED every stored Acrylic Putty line,
      //   silently. That is the VELVETINO incident migrateLine case 3 exists
      //   to prevent, and keeping the key would have rebuilt it.
      //
      //   With no tile holding the key, migrateLine takes CASE 2 instead:
      //   boardTile("ACRYLIC PUTTY") is null, so a stored line is returned
      //   UNCHANGED — the same object, so migrateLines writes nothing back.
      //   It renders, it sends, it does not badge. The documented correct end
      //   state for a product that left the board.
      //
      // ⚠ ONE COST, AND IT IS SILENT: a favourite stored on the key
      // "ACRYLIC PUTTY" is pruned on the next read (loadFavProducts filters on
      // boardTile(f.key) !== null) with no message. Exactly one key is
      // affected; POLYPUTTY was never a key. Judged the honest outcome — the
      // salesman starred Acrylic Putty, and it no longer has a tile.
      // ═══════════════════════════════════════════════════════════════════
      //
      // 🔴 SPRAY PAINT'S FIRST TILE. It has been a search-only family since v1
      // (CLAUDE_PLACE_ORDER §6). ONE product, eleven colours: the key IS its
      // single member's sap, the convention, no exception needed.
      //
      // No CURATION entry, so the eleven options come straight from the
      // payload in sortOrder — Brilliant White, Black, Phiroza, Golden Yellow,
      // Signal Red, Deep Orange, Golden Brown, Dark Brown, Gold, Silver, Bus
      // Green. resolveGroup already branches on that; nothing to add.
      //
      // The member carries the tile's own label and de-doubles to one word in
      // any caption, exactly as Gloss and Max do.
      //
      // ⚠ THE CAN IS TALL AND NARROW — 80% of spray-paint.webp is transparent,
      // against 25-35% for a tub. It pads with space either side and reads
      // smaller in its tile than its neighbours. That is the product. Do NOT
      // scale or crop it to match the row.
      { key: "SPRAY PAINT", label: "Spray Paint", slug: "spray-paint",
        members: [
          { sap: "SPRAY PAINT", label: "Spray Paint" },
        ] },
    ],
  },
  {
    // The ninth family, and the only new TINT on the board. A cool grey-lilac,
    // chosen to sit apart from Promise's warm pink and Primer's blue at the
    // 0.55 wash the tiles use. It is NOT BRAND_WASH — the masthead keeps the
    // only violet ground in the app.
    name: "VT",
    tint: "#EDEBF5",
    tiles: [
      { key: "VT PEARL GLO", label: "Pearl Glo", slug: "pearl-glo",
        members: [{ sap: "VT PEARL GLO", label: "Pearl Glo" }] },
      { key: "VT PLATINUM GLO", label: "Platinum Glo", slug: "platinum-glo",
        members: [{ sap: "VT PLATINUM GLO", label: "Platinum Glo" }] },
      // ⚠ THE KEY SAYS MATT AND MATT IS SECOND. Deliberate — keys are frozen
      // historical strings (see V2BoardTile.key). Renaming it to "VT ETERNA"
      // would delete every stored Eterna favourite. Do not tidy it.
      { key: "VT ETERNA MATT", label: "Eterna", slug: "vt-eterna",
        members: [
          // Owner's order, 2026-09-09. Eterna leads the range so it leads the
          // drawer. It also becomes the tile's leader for LEADER_TILE, but it
          // carries its own tin, so nothing on screen moves except the order.
          { sap: "VT ETERNA",          label: "Eterna", slug: "product-vt-eterna" },
          { sap: "VT ETERNA MATT",     label: "Matt", slug: "product-vt-eterna-matt" },
          { sap: "VT ETERNA HI-SHEEN", label: "Hi-Sheen", slug: "product-vt-eterna-hi-sheen" },
        ] },
      // 🔴 FOUR MEMBERS, NOT SIX. VT DIAMOND GLO and VAF LEFT THE BOARD on
      // 2026-09-07 and are search-only again. Diamond Glo was the family
      // crossing — it is VELVET TOUCH, not VT SPECIALTY — and at 6 lines/90d
      // it was not earning the confusion; VAF at 3 lines was the tail of the
      // tail. What is left is the four products the family actually is.
      //
      // ⚠ A LINE SAVED WHILE THEY WERE MEMBERS STILL CARRIES tileSap
      // "VELVETINO". That sap is STILL a live tile key, so the storage
      // migration reads it as already correct and leaves it — and the next
      // edit of this tile replaces by tile key and deletes it. Reproduced and
      // reported 2026-09-07; the fix belongs in v2-storage.ts, not here.
      // ⚠ THE KEY SAYS VELVETINO AND VELVETINO IS SECOND, 2026-09-10 — owner's
      // sequence: Concrete Finish, Velvetino, Clear, Marble. Same rule as
      // Eterna and Hydro PU above: the key is FROZEN, not tidied to follow the
      // order. It still names a member this tile HOLDS, which is the only thing
      // that matters — addLines filters `l.tileSap === tileKey`
      // (po-v2-page.tsx:709), so a key naming a member that had LEFT would
      // silently delete every stored Velvetino line. Reordering inside the tile
      // touches nothing stored: a cart line carries the tile KEY, never a
      // position.
      { key: "VELVETINO", label: "Luxury Finish", slug: "vt-specialty",
        members: [
          { sap: "VT CONCRETE FINISH", label: "Concrete Finish" },
          { sap: "VELVETINO",          label: "Velvetino" },
          { sap: "VT CLEAR COAT",      label: "Clear Coat" },
          { sap: "VT MARBLE",          label: "Marble" },
        ] },
    ],
  },
  {
    name: "Promise",
    tint: "#FBECEF",
    tiles: [
      { key: "PROMISE SMARTCHOICE", label: "Smart Choice", slug: "smart-choice",
        members: [{ sap: "PROMISE SMARTCHOICE", label: "Smart Choice" }] },
      { key: "PROMISE INTERIOR", label: "Promise", slug: "promise-int",
        members: [
          { sap: "PROMISE INTERIOR", label: "Int", slug: "promise-int" },
          { sap: "PROMISE EXTERIOR", label: "Ext", slug: "promise-ext" },
        ] },
      { key: "PROMISE PRIMER", label: "Promise Primer", slug: "promise-primer",
        members: [{ sap: "PROMISE PRIMER", label: "Promise Primer" }] },
      { key: "PROMISE SHEEN INTERIOR", label: "Promise Sheen", slug: "promise-sheen",
        members: [
          { sap: "PROMISE SHEEN INTERIOR", label: "Int", slug: "product-promise-sheen-interior" },
          { sap: "PROMISE SHEEN EXTERIOR", label: "Ext", slug: "product-promise-sheen-exterior" },
        ] },
    ],
  },
  {
    name: "Exterior",
    tint: "#EAF4E8",
    tiles: [
      { key: "WS PROTECT DUSTPROOF", label: "Protect Dustproof", slug: "protect-dustproof",
        members: [{ sap: "WS PROTECT DUSTPROOF", label: "Protect Dustproof" }] },
      { key: "WS PROTECT HI-SHEEN", label: "Protect Hi-Sheen", slug: "protect-hi-sheen",
        members: [{ sap: "WS PROTECT HI-SHEEN", label: "Protect Hi-Sheen" }] },
      { key: "WS MAX", label: "Max", slug: "max",
        members: [{ sap: "WS MAX", label: "Max" }] },
      // Powerflexx leads at 200 lines/90d, so it pre-selects and NOTHING on
      // the board loses a tap. That is the entire reason this tile is shaped
      // as a tail behind its best seller rather than as a "WS Protect" merge:
      // merging Protect would have put Hi-Sheen's 702 lines one tap further
      // away to rescue the same 94.
      { key: "WS POWERFLEXX", label: "More Exterior", slug: "powerflexx",
        // 🔴 TRIMMED 9 -> 3 on 2026-09-08. Texture, WS Metallic, WS Tile,
        // Texture 2mm, Texture 3mm and Smoothover left the board; they are
        // still ORDERABLE through the search bar, which files a line under the
        // product's own key. The leader does not move, so the tile KEY does not
        // move, so no stored line needs migrating — and the ones that were
        // already saved under WS POWERFLEXX are refiled by v2-storage's case 3
        // the next time they are read.
        members: [
          { sap: "WS POWERFLEXX",        label: "Powerflexx", slug: "powerflexx" },
          { sap: "WS PROTECT RAINPROOF", label: "Protect Rainproof", slug: "product-ws-protect-rainproof" },
          { sap: "FLOOR PLUS",           label: "Floor Plus", slug: "floor-plus" },
        ] },
    ],
  },
  {
    name: "Primer",
    tint: "#E3F1F8",
    tiles: [
      { key: "CEMENT PRIMER SB", label: "Cement SB", slug: "cement-sb",
        members: [{ sap: "CEMENT PRIMER SB", label: "Cement SB" }] },
      { key: "ZINC YELLOW METAL PRIMER", label: "Zinc Yellow", slug: "zinc-yellow",
        members: [{ sap: "ZINC YELLOW METAL PRIMER", label: "Zinc Yellow" }] },
      { key: "RED OXIDE METAL PRIMER", label: "Red Oxide", slug: "red-oxide",
        members: [{ sap: "RED OXIDE METAL PRIMER", label: "Red Oxide" }] },
      // Ext Acrylic keeps the key and the tin; the five primers that had no
      // tile at all ride with it. That is the whole PRIMER family — nine
      // products, four tiles, nothing left over.
      { key: "EXTERIOR ACRYLIC PRIMER", label: "Primers", slug: "ext-acrylic",
        members: [
          // 🔴 MEMBER ORDER IS THE OWNER'S, 2026-09-09. EAP stays FIRST, which
          // it has to: Scheme A makes the tile key members[0].sap, and this
          // tile's key is EXTERIOR ACRYLIC PRIMER. Everything after it is a
          // curation call over the 90-day ranking.
          //
          // ⚠ "EAP" IS THE LABEL AND THERE IS NO SECOND LINE. The owner asked
          // for "Exterior Acrylic Primer" alongside it in the rail. V2Member
          // has no description field and the drawer draws no secondary line
          // per member — the NameBar above the packs shows the selected
          // OPTION, not a product blurb. Adding one is a new UI element, so
          // only the label changed here and the question is open.
          { sap: "EXTERIOR ACRYLIC PRIMER", label: "EAP", slug: "product-exterior-acrylic-primer" },
          { sap: "ALKALI BLOC PRIMER",      label: "Alkali Bloc", slug: "product-alkali-bloc-primer" },
          { sap: "FARCO WHITE PRIMER",      label: "Farco White", slug: "product-farco-white-primer" },
          // 🔴 ONE PRODUCT, TWO MEMBERS, PINNED BY baseColour. The strings are
          // the catalog's own, case for case — see V2Member.option.
          { sap: "WOOD PRIMER",             label: "Wood White", option: "White" },
          { sap: "WOOD PRIMER",             label: "Wood Pink",  option: "PINK" },
          { sap: "CEMENT PRIMER WB",        label: "Cement WB" },
          { sap: "INTERIOR ACRYLIC PRIMER", label: "Int Acrylic" },
        ] },
    ],
  },
  {
    name: "Stainer",
    tint: "#F6E8C8",
    tiles: [
      // 🔴 TILE ORDER IS THE OWNER'S, 2026-09-09 — Universal Stainer first,
      // then Machine Tinter, then Acotone. It was Acotone-first from the
      // original 90-day ranking; this is a curation call over that ranking and
      // is meant to stay until he says otherwise. No key moved.
      { key: "UNIVERSAL STAINER", label: "Universal Stainer", slug: "uni-stainer",
        members: [{ sap: "UNIVERSAL STAINER", label: "Universal Stainer" }] },
      { key: "MACHINE TINTER", label: "Machine Tinter", slug: "machine-tinter",
        members: [{ sap: "MACHINE TINTER", label: "Machine Tinter" }] },
      { key: "ACOTONE", label: "Acotone", slug: "acotone",
        members: [{ sap: "ACOTONE", label: "Acotone" }] },
      { key: "GVA", label: "GVA", slug: "gva",
        members: [{ sap: "GVA", label: "GVA" }] },
    ],
  },
  {
    name: "Aquatech",
    tint: "#E0F1EA",
    tiles: [
      { key: "DAMP PROTECT 2IN1", label: "Damp Protect", slug: "damp-2in1",
        members: [
          { sap: "DAMP PROTECT 2IN1",     label: "2in1", slug: "product-damp-protect-2in1" },
          { sap: "DAMP PROTECT BASECOAT", label: "Basecoat", slug: "product-damp-protect-basecoat" },
        ] },
      { key: "ROOF COAT WHITE", label: "Roof Coat", slug: "roof-coat",
        members: [
          { sap: "ROOF COAT WHITE",     label: "White", slug: "product-roof-coat" },
          { sap: "ROOF COAT TERACOTTA", label: "Teracotta", slug: "product-roof-coat" },
          { sap: "ROOF COAT GREY",      label: "Grey", slug: "product-roof-coat" },
        ] },
      // ═══════════════════════════════════════════════════════════════════
      // 🔴 THE AQUATECH REGROUP, 2026-09-10. Owner's split, and the order of
      // these two tiles is his too: Damp Protect · Roof Coat · Other Coat ·
      // Crack Filler and Additives.
      //
      // SIX MEMBERS MOVED, all one way — Waterblock 2K, RP Latex, WRP,
      // Pretreatment Coat, LW Plus and TG Cotton Wool left the coats tile for
      // the crack-filler one. What stayed behind is the five actual COATS:
      // FBC Advance, FBC Neo, Interior WBC, IBC Advance and PU Coat.
      //
      // 🔴 NEITHER KEY MOVED, AND THAT WAS THE GATE. "Crack Filler and
      // Additives" is still keyed CRACKFILLER 5MM and still holds it; "Other
      // Coat" is still keyed FBC ADVANCE and still holds it. Had a key named a
      // member that left, addLines' `l.tileSap === tileKey` filter
      // (po-v2-page.tsx:709) would have DELETED that member's stored lines the
      // next time anybody added from the tile — the case that stopped the
      // Spray Paint rename. Here the two leaders both stayed put, so no
      // exception was needed and no favourite is pruned.
      //
      // The six movers' stored lines are refiled by migrateLine case 1:
      // tileKeyForMember now answers CRACKFILLER 5MM, that differs from the
      // stored FBC ADVANCE, so tileSap is rewritten once and the second pass
      // returns the same object. Nothing is lost and nothing churns.
      // ═══════════════════════════════════════════════════════════════════
      { key: "FBC ADVANCE", label: "Other Coat", slug: "coats-additives",
        members: [
          { sap: "FBC ADVANCE",       label: "FBC Advance", slug: "product-fbc-advance" },
          { sap: "FBC NEO",           label: "FBC Neo", slug: "product-fbc-neo" },
          { sap: "INTERIOR WBC",      label: "Interior WBC", slug: "product-interior-wbc" },
          { sap: "IBC ADVANCE",       label: "IBC Advance" },
          { sap: "AQUATECH PU COAT",  label: "PU Coat", slug: "product-aquatech-pu-coat" },
        ] },
      // The three fillers read as a SIZE LADDER under a tile that already says
      // "Crack Filler", so they carry the size alone — eb6d8e2f's rule, the
      // same shape Roof Coat's White/Teracotta/Grey uses. The six additives
      // keep their full names: none of them repeats the tile.
      { key: "CRACKFILLER 5MM", label: "Crack Filler and Additives", slug: "crack-5mm",
        members: [
          { sap: "CRACKFILLER 5MM",  label: "5mm", slug: "product-crackfiller" },
          { sap: "CRACKFILLER 10MM", label: "10mm", slug: "product-crackfiller" },
          { sap: "CRACKFILLER 20MM", label: "20mm", slug: "product-crackfiller" },
          // Waterproof Putty left on 2026-09-08 — search-only, same as above.
          { sap: "WATERBLOCK 2K",     label: "Waterblock 2K", slug: "product-waterblock-2k" },
          { sap: "RP LATEX",          label: "RP Latex" },
          { sap: "WRP",               label: "WRP" },
          { sap: "PRETREATMENT COAT", label: "Pretreatment Coat" },
          { sap: "LW PLUS",           label: "LW Plus" },
          { sap: "TG COTTON WOOL",    label: "TG Cotton Wool" },
        ] },
    ],
  },
  {
    name: "Wood",
    tint: "#EFE6DA",
    tiles: [
      { key: "PU PRIME MATT", label: "PU Prime", slug: "prime-matt",
        members: [
          // Matt, Gloss, Sealer — the owner's order, 2026-09-09, and the same
          // three words in the same sequence on PU Prime, 2K PU and Luxurio so
          // the thumb lands in the same place whichever range he is in.
          { sap: "PU PRIME MATT",   label: "Matt", slug: "product-pu-prime-matt" },
          { sap: "PU PRIME GLOSS",  label: "Gloss", slug: "product-pu-prime-gloss" },
          { sap: "PU PRIME SEALER", label: "Sealer" },
        ] },
      // 🔴 2K PU THINNER AND 2K PU PRIMER SURFACER LEFT ON 2026-09-08. They are
      // system components, and the old argument for keeping them here was that
      // a man ordering 2K PU Matt reaches for its matching thinner where the
      // system is. The category tile beats that: he now reaches for it under
      // "Thinner" beside every other thinner, which is where he looks when he
      // does NOT already have the 2K drawer open. Both are still one tap from
      // the board, and this tile is three products with real colour ladders.
      { key: "2K PU MATT", label: "2K PU", slug: "2k-matt",
        members: [
          { sap: "2K PU MATT",   label: "Matt" },
          { sap: "2K PU GLOSS",  label: "Gloss" },
          { sap: "2K PU SEALER", label: "Sealer" },
        ] },
      // 🔴 A NEW TILE KEY, LUXURIO MATT. Luxurio took the third slot over Hydro
      // PU on the numbers: 62 lines / 45 orders in 90 days against 48 / 46, and
      // decisively on LIFETIME — 122 against 48, where Hydro's lifetime equals
      // its 90-day figure exactly on all four products because it has no
      // history before this window. Luxurio also NEEDS a named tile and Hydro
      // does not: all three Luxurio products carry real ladders (5, 2 and 5
      // options) and cannot live in a category tile, while all four Hydro
      // products pin cleanly and do.
      { key: "LUXURIO MATT", label: "Luxurio", slug: "luxurio",
        members: [
          // Matt, Gloss, Sealer — see PU Prime.
          { sap: "LUXURIO MATT",   label: "Matt" },
          { sap: "LUXURIO GLOSS",  label: "Gloss" },
          { sap: "LUXURIO SEALER", label: "Sealer" },
        ] },
      // 🔴 THE FIRST CATEGORY TILE. See V2Member.category.
      //
      // The key stays MULTI PURPOSE THINNER — it was already this family's
      // thinner tile key and it is still members[0], so every stored line filed
      // under it needs no migration at all. NC SANDING SEALER stops being a key
      // and becomes a member; the derived migration refiles those lines onto
      // this tile on read, with no code change in v2-storage.ts.
      //
      // Every product here has NOTHING to choose: eight have no baseColour at
      // all, thirteen are pinned to their single row. buildBoard throws if that
      // ever stops being true.
      // 🔴 THE FIFTH WOOD TILE, 2026-09-08. Hydro PU left the category tile's
      // "Other" and "Sealer" for a tile of its own.
      //
      // WHY IT EARNED ONE. It is a coherent four-product range — Dead Matt,
      // Matt, Gloss, Sealer — and inside "Other" it was four of thirteen
      // unrelated things, findable only by knowing to look under a word that
      // means nothing. 48 lines across 46 orders in 90 days is not large, but
      // it is 46 separate customers, and every one of them was scrolling past
      // Epoxy Insulator and NC Clear Lacquer to reach it.
      //
      // MEMBERS ARE IN 90-DAY LINE ORDER, read from the live catalog and not
      // from a report: Dead Matt 20, Matt 14, Gloss 10, Sealer 4. So the key is
      // HYDRO PU DEAD MATT and a board tap lands on the one they buy most —
      // ONE TAP to a quantity.
      //
      // ALL FOUR ARE PINNED, so the tile is rail-products with no top strip.
      // Three pin to "Int Clear" and the Sealer to "Clear"; the strings are the
      // catalog's own, case for case (see V2Member.option).
      // ⚠ THE KEY SAYS DEAD MATT AND DEAD MATT IS FOURTH. Same rule as Eterna
      // above — frozen, not tidied.
      { key: "HYDRO PU DEAD MATT", label: "Hydro PU", slug: "hydro-pu",
        members: [
          // Matt, Gloss, Sealer, Dead Matt — owner's ruling, 2026-09-09. The
          // first three now sit in the same places as PU Prime's, 2K PU's and
          // Luxurio's, so the thumb lands on the same finish whichever of the
          // four ranges he is in. Dead Matt is the one finish only this range
          // has, so it goes last rather than displacing the pattern.
          { sap: "HYDRO PU MATT",      label: "Matt",      option: "Int Clear" },
          { sap: "HYDRO PU GLOSS",     label: "Gloss",     option: "Int Clear" },
          { sap: "HYDRO PU SEALER",    label: "Sealer",    option: "Clear" },
          { sap: "HYDRO PU DEAD MATT", label: "Dead Matt", option: "Int Clear" },
        ] },
      // 🔴 GROUPED BY RANGE, NOT BY FUNCTION, 2026-09-08.
      //
      // It was Thinner / Sealer / Other, which grouped by what a product DOES.
      // That read well until you looked for one: NC Wood Thinner sat under
      // "Thinner" while NC Sanding Sealer sat under "Sealer" and NC Clear
      // Lacquer under "Other" — three chips to find three products off the same
      // shelf, from the same range, that a dealer names in one breath. A range
      // is how these are bought and how they are stocked; the finish is a
      // detail INSIDE it.
      //
      // So: a product belongs to its RANGE first. Every NC product is under NC
      // even when one of them is a thinner, every Melamine product under
      // Melamine for the same reason, and the Thinner chip keeps only the two
      // general-purpose thinners that belong to no range at all.
      //
      // ⚠ THE THINNER CHIP IS TWO PRODUCTS, AND THAT IS ONLY ACCEPTABLE
      // BECAUSE THE RAIL SEARCH CROSSES CHIPS. Typing "thinner" returns all
      // five — the two here, the two under NC, and the one under Melamine — so
      // the range grouping never hides a product from somebody who is thinking
      // in functions. If that search is ever scoped to the open chip, this
      // grouping has to be revisited in the same commit.
      //
      // Members are in descending 90-day line order within each chip, read
      // from the live catalog on the day of the change. The four ties at zero
      // under NC keep their authored order; nothing in the data separates them.
      { key: "MULTI PURPOSE THINNER", label: "Thinner & More", slug: "thinner",
        members: [
          // ── Thinner ── the two that belong to no range ──────────────────
          { sap: "MULTI PURPOSE THINNER", label: "Multi Purpose Thinner", category: "Thinner" },
          { sap: "2K PU THINNER",         label: "2K PU Thinner",         category: "Thinner" },
          // ── NC ─────────────────────────────────────────────────────────
          { sap: "NC SANDING SEALER",     label: "NC Sanding Sealer",     category: "NC" },
          { sap: "NC CLEAR LACQUER",      label: "NC Clear Lacquer",      category: "NC",
            option: "Clear" },
          { sap: "NC WOOD THINNER",       label: "NC Wood Thinner",       category: "NC" },
          { sap: "NC NECOL THINNER",      label: "NC Necol Thinner",      category: "NC" },
          { sap: "NC NECOL CLEAR",        label: "NC Necol Clear",        category: "NC",
            option: "Clear" },
          { sap: "NC OPAQUE",             label: "NC Opaque",             category: "NC",
            option: "White" },
          // ── Melamine ───────────────────────────────────────────────────
          // Matt, Gloss, Sealer, Thinner — the owner's order, 2026-09-09, and
          // the same finish sequence the three PU tiles now use.
          { sap: "MELAMINE MATT",         label: "Melamine Matt",         category: "Melamine",
            option: "Clear" },
          { sap: "MELAMINE GLOSS",        label: "Melamine Gloss",        category: "Melamine",
            option: "Clear" },
          { sap: "MELAMINE SEALER",       label: "Melamine Sealer",       category: "Melamine",
            option: "Clear" },
          { sap: "MELAMINE THINNER",      label: "Melamine Thinner",      category: "Melamine" },
          // ── Other ── what is left, and it is genuinely miscellaneous ────
          // The owner's order, 2026-09-09: Epoxy Insulator, Hardener, 1K PU,
          // Synthetic Varnish, 2K PU. He named five and this category holds
          // exactly five, so the mapping is 1:1 — "Hardener" is Epoxy
          // Insulator Hardener, "1K PU" is 1K PU Gloss, and "2K PU" is 2K PU
          // Primer Surfacer (the only 2K PU item in this category; the 2K PU
          // TILE in Wood and 2K PU Thinner above are different things).
          //
          // ⚠ ORDER ONLY — the labels are unchanged. He listed these as a
          // sequence, not as renames, and the RENAMES he did ask for named
          // only Uni Stainer and Ext Acrylic.
          { sap: "EPOXY INSULATOR",       label: "Epoxy Insulator",       category: "Other" },
          { sap: "EPOXY INSULATOR HARDENER", label: "Epoxy Insulator Hardener", category: "Other" },
          { sap: "1K PU GLOSS",           label: "1K PU Gloss",           category: "Other",
            option: "Clear" },
          { sap: "SYNTHETIC VARNISH",     label: "Synthetic Varnish",     category: "Other",
            option: "Clear" },
          { sap: "2K PU PRIMER SURFACER", label: "2K PU Primer Surfacer", category: "Other",
            option: "White" },
        ] },
    ],
  },
];

// ── The member -> tile index, DERIVED ─────────────────────────────────────
//
// 🔴 WALKED FROM BOARD, NEVER HAND-WRITTEN. Under Scheme A the tile key IS a
// member sap, so the key moves whenever sales reorder the members. A derived
// index absorbs that move for free: whatever the key used to be, it is still a
// member, so it still resolves to its tile. A hand-written table of "the three
// saps that changed" would be correct for exactly one ranking and would orphan
// every stored draft using an old key on the next one — and the symptom is not
// an error, it is a DUPLICATE cart line the salesman sends without noticing.
//
// Step 2's search and Step 5's storage migration both read this.

const MEMBER_TILE = new Map<string, string>();
const BOARD_TILES = new Map<string, V2BoardTile>();
const BOARD_ART   = new Map<string, { src: string | null; wash: string }>();
const BOARD_SLUG  = new Map<string, string>();
/** member sap -> its own image slug. Empty for a product with no photo yet. */
const MEMBER_SLUG = new Map<string, string>();
/**
 * The sap of each tile's members[0] -> that tile's key.
 *
 * DERIVED, like every other index here. Under Scheme A the leader IS the tile
 * key, so this could be written as "is this sap a tile key?" — but that reads
 * as a coincidence and this reads as the fact it depends on, which is that a
 * tile's photograph is a photograph of its top seller.
 */
const LEADER_TILE = new Map<string, string>();

/**
 * Invariant violations found while indexing BOARD. Recorded, NOT thrown at
 * module load: v2-data is imported by every screen, so a throw here would take
 * the whole page down for an authoring mistake. buildBoard() throws on a
 * non-empty list instead — loud exactly where it is consumed, silent where it
 * would be a catastrophe.
 *
 * buildBoard IS consumed: po-v2-page.tsx:318, on every load, and
 * scripts/po-v2-email-fixtures.ts. (This used to say "nothing consumes
 * buildBoard yet" — it has been consumed since 1129427d.) So a violation
 * recorded here does reach a developer, on the first render.
 */
export const BOARD_INVARIANTS: string[] = [];

/**
 * 🔴 A FAMILY MAY HOLD AS MANY TILES AS IT DESERVES — WITHIN A BOUND.
 *
 * This used to assert exactly four, and the assertion was never about the
 * products: it was about the grid being four across, so four tiles filled one
 * clean row. That is a fact about the LAYOUT, and the layout does not need the
 * data's help — a five-tile family fills a row and leaves one tile alone on the
 * next, inside its own block, which the owner has seen and accepted. Wood is
 * the first family whose product range genuinely wants five.
 *
 * ⚠ DELETING THE CHECK ALTOGETHER WOULD BE WRONG, and the reason is that this
 * file is a hand-authored literal seventeen hundred lines long. The realistic
 * failure is not "a family that deserves five tiles"; it is a misplaced bracket
 * that swallows one family's tiles into its neighbour's array, or a paste that
 * duplicates a block. Both leave a family with an absurd count, and both would
 * otherwise reach a phone as a board with a missing row or a wall of tiles —
 * silently, because every individual tile in it is still well-formed. A bound
 * catches the shape of that mistake without pretending to know how many tiles a
 * range needs.
 *
 * 2 is the floor because a "family" of one is a tile that has been mislabelled
 * as a family. 8 is the ceiling because two full rows of the 4-across grid is
 * already more than the eye groups as one block, so anything past it is a
 * curation decision that should be made deliberately — by raising this number,
 * with a reason, rather than by the board quietly growing.
 */
const FAMILY_MIN = 2;
const FAMILY_MAX = 8;

for (const family of BOARD) {
  const wash = mixToWhite(family.tint, TILE_WASH);
  // 🔴 A BOUND, NOT AN EQUALITY — see FAMILY_MIN / FAMILY_MAX.
  if (family.tiles.length < FAMILY_MIN || family.tiles.length > FAMILY_MAX) {
    BOARD_INVARIANTS.push(
      `family "${family.name}" has ${family.tiles.length} tiles, outside the ` +
      `${FAMILY_MIN}-${FAMILY_MAX} bound`);
  }
  for (const tile of family.tiles) {
    if (tile.members.length === 0) {
      BOARD_INVARIANTS.push(`tile "${tile.label}" has no members`);
      continue;
    }
    // 🔴 THE key === members[0].sap CHECK WAS HERE AND IS GONE, 2026-09-09.
    // It enforced Scheme A, which meant reordering a drawer renamed the tile —
    // and favourites are stored on tile keys, so a reorder silently deleted
    // them. Keys are frozen historical strings now; see V2BoardTile.key.
    // Everything else this loop checks is UNCHANGED and still enforced:
    // family size 2..8, a tile with no members, two tiles sharing a key, and
    // one member on two tiles.
    if (BOARD_TILES.has(tile.key)) {
      BOARD_INVARIANTS.push(`two tiles share the key "${tile.key}"`);
    }
    BOARD_TILES.set(tile.key, tile);
    BOARD_ART.set(tile.key, { src: tileImage(tile.slug), wash });
    BOARD_SLUG.set(tile.key, tile.slug);
    for (const member of tile.members) {
      const already = MEMBER_TILE.get(member.sap);
      if (already !== undefined && already !== tile.key) {
        BOARD_INVARIANTS.push(
          `"${member.sap}" is a member of two tiles: "${already}" and "${tile.key}"`);
      }
      MEMBER_TILE.set(member.sap, tile.key);
      if (member.slug !== undefined) MEMBER_SLUG.set(member.sap, member.slug);
    }
    LEADER_TILE.set(tile.members[0].sap, tile.key);
  }
}

/**
 * The tile key that owns this product, or null when nothing on the board does.
 *
 * Takes ANY member sap — including a key that used to be a tile key and is now
 * an ordinary member, which is the case the whole index exists for.
 */
export function tileKeyForMember(sap: string): string | null {
  return MEMBER_TILE.get(sap) ?? null;
}

/** The tile definition behind a key, or null. */
export function boardTile(key: string): V2BoardTile | null {
  return BOARD_TILES.get(key) ?? null;
}

/**
 * Art for a BOARD tile, keyed on the TILE KEY. THE ONLY SOURCE OF TILE ART.
 *
 * 🔴 THE SWITCH-OVER IS DONE — c98b4e8c. This used to say "Step 4 owns the
 * switch-over", and that sentence is the single most expensive comment in the
 * folder. Step 4 never did it. tileArtFor() went on reading the dead 32-tile
 * grouping for ELEVEN commits, and nine tiles — SuperClean, More Interior,
 * Pearl Glo, Platinum Glo, VT Eterna, VT Specialty, Promise Sheen, Coats &
 * Additives, More Wood — served cart lines a family wash from the old board.
 * Nothing errored; the tints were simply wrong.
 *
 * tileArtFor() is now a one-line delegate to this function (:569), so there is
 * one map and the board and the cart cannot disagree again.
 */
export function boardTileArtFor(key: string): { src: string | null; wash: string } {
  return BOARD_ART.get(key) ?? { src: null, wash: FILL };
}

/** sap-of-tile -> image slug, for the board tiles. */
export function boardTileSlugFor(key: string): string | null {
  return BOARD_SLUG.get(key) ?? null;
}

// ── Resolving a board tile ────────────────────────────────────────────────

/**
 * One member, resolved.
 *
 * 🔴 `mode` AND `pools` ARE CARRIED HERE ON PURPOSE, and they are the reason
 * this type is not just V2Resolved & { sap, label }. They are computed inside
 * buildBoard from THAT MEMBER'S OWN ROWS, so no later caller can be tempted to
 * derive them from the tile. A caller that had to call drawerMode() itself
 * would have a tile in hand and the union is the obvious thing to pass — and
 * the union is wrong for 12 of the 17 merged tiles.
 */
export type V2ResolvedMember = V2Resolved & {
  /**
   * 🔴 THE DRAWER'S KEY, WHICH IS NOT ALWAYS THE CATALOG KEY.
   *
   * For an ordinary member it is the sap. For a PINNED member it is
   * memberKey() — "WOOD PRIMER|||White" — because two pinned members share one
   * sap and the drawer keys quantities, selection and badges on this. Sharing
   * it would sum White's units into Pink's badge and let one clear the other.
   *
   * Nothing downstream of the drawer sees this string: a pick carries its ROW,
   * and the cart line is built from the row's own three catalog fields.
   */
  sap:   string;
  /** COALESCE(product, subProduct) — the catalog key, always, pinned or not. */
  joinSap: string;
  /** The pinned baseColour, or null. */
  pin:   string | null;
  /** The category chip this member sits under, or null. */
  category: string | null;
  label: string;
  /** drawerMode() on this member's rows alone. NEVER on the tile's union. */
  mode:  V2DrawerMode;
  /** optionPools() on this member's rows alone. */
  pools: { all: V2Option[]; bases: V2Option[]; shades: V2Option[] };
};

/**
 * The key a pinned member is known by inside the drawer.
 *
 * "|||" is the same separator the pack map already uses for
 * product|||baseColour, and it cannot occur in a catalog value.
 */
export function memberKey(sap: string, option?: string): string {
  return option === undefined ? sap : sap + "|||" + option;
}

export type V2ResolvedTile = {
  key:     string;
  label:   string;
  slug:    string;
  members: V2ResolvedMember[];
};

export type V2BoardReport = {
  /** A member sap the live payload has no rows for. Reported, never guessed. */
  missingMembers: { tile: string; sap: string }[];
  /** A member that resolved but has no packs at all on any row. */
  emptyMembers:   { tile: string; sap: string }[];
};

/**
 * 🔴 THE ANTI-UNION ASSERTION, AND IT IS THE POINT OF THIS WHOLE FUNCTION.
 *
 * Every row handed to a member's resolve must belong to that member. A caller
 * that passed the tile's combined rows — the obvious mistake, and the one the
 * gate measured — trips this on the first foreign row.
 *
 * It throws. It cannot fire on any DATA: the rows come from a groupBy on the
 * very key being checked. It can only fire on a code change, which is exactly
 * what should stop loudly.
 *
 * Why it matters, measured on the live payload 2026-09-07: drawerMode() on the
 * union returns "standard" for 12 of the 17 merged tiles, and six of those —
 * Damp Protect, Roof Coat, Crack Filler, Coats & Additives, Thinners and the
 * Aquatech tail — are made ENTIRELY of single-mode, option-less products. A
 * standard base/shade shell over a product with no options is the dead screen
 * that `needsShade` produced for nine products and that an empty-string
 * baseColour produced for thirty-seven. Twice is enough.
 */
function assertOwnRows(sap: string, rows: ApiProduct[]): void {
  for (const row of rows) {
    const key = row.product ?? row.subProduct;
    if (key !== sap) {
      throw new Error(
        `v2 board: member "${sap}" was handed a row belonging to "${key}". ` +
        `Members must be resolved on their OWN rows — never on the union of a ` +
        `tile's members. See assertOwnRows in v2-data.ts.`,
      );
    }
  }
}

/**
 * Resolve every board tile, ONE MEMBER AT A TIME.
 *
 * buildCatalog() is called once and its curated resolutions are passed through
 * resolveGroup, so a member that is one of the 32 curated products keeps its
 * ranked base/shade lists exactly as the board gives it today, and a member
 * that is not gets its options straight from the payload in sortOrder. One
 * code path, both cases — resolveGroup already branches on that internally.
 *
 * CALLED AT po-v2-page.tsx:318, once per load, and by
 * scripts/po-v2-email-fixtures.ts. (This used to say "nothing calls this yet
 * — po-v2-page.tsx is Step 2's file". Step 2 was 1129427d and it did point
 * the page here; the comment was never updated.)
 */
export function buildBoard(products: ApiProduct[]): {
  byKey:  Map<string, V2ResolvedTile>;
  report: V2BoardReport;
} {
  if (BOARD_INVARIANTS.length > 0) {
    throw new Error("v2 board is mis-authored:\n  " + BOARD_INVARIANTS.join("\n  "));
  }

  const catalog = buildCatalog(products);
  const groups = new Map<string, ApiProduct[]>();
  for (const row of products) {
    const key = row.product ?? row.subProduct;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const byKey = new Map<string, V2ResolvedTile>();
  const report: V2BoardReport = { missingMembers: [], emptyMembers: [] };

  for (const family of BOARD) {
    for (const tile of family.tiles) {
      const members: V2ResolvedMember[] = [];
      for (const member of tile.members) {
        const rows = groups.get(member.sap) ?? [];
        if (rows.length === 0) {
          report.missingMembers.push({ tile: tile.label, sap: member.sap });
          continue;
        }
        // 🔴 ONE MEMBER'S ROWS, AND ONLY ONE MEMBER'S ROWS.
        assertOwnRows(member.sap, rows);

        // ── A PINNED MEMBER IS ONE ROW AND NOTHING ELSE ──────────────────
        //
        // Built here rather than by resolveGroup because resolveGroup's job is
        // to turn a GROUP of rows into a list of options, and the whole point
        // of a pin is that there is no list. Empty bases/shades/variants and a
        // noOptionRow is the shape the drawer already draws for a product with
        // nothing to choose — Cement SB, Zinc Yellow — so no new code path
        // renders it, and mode "single" keeps it out of flat mode.
        if (member.option !== undefined) {
          const row = rows.find((r) => r.baseColour === member.option);
          if (!row) {
            // Case-sensitive on purpose (see V2Member.option). A pin that does
            // not match is reported, not silently widened.
            report.missingMembers.push({ tile: tile.label, sap: memberKey(member.sap, member.option) });
            continue;
          }
          members.push({
            sap: memberKey(member.sap, member.option),
            joinSap: member.sap,
            pin: member.option,
            category: member.category ?? null,
            label: member.label,
            family: row.family ?? "",
            bases: [], shades: [], variants: [],
            noOptionRow: row,
            defaultTab: "base",
            curated: false,
            mode: "single",
            pools: { all: [], bases: [], shades: [] },
          });
          continue;
        }

        const resolved = resolveGroup(member.sap, rows, member.label, catalog.byTile);
        const mode  = drawerMode(rows);
        const pools = optionPools(rows);
        if (packsOf(rows).length === 0) {
          report.emptyMembers.push({ tile: tile.label, sap: member.sap });
        }
        // 🔴 A CATEGORY TILE SPENDS BOTH ZONES, SO NOTHING IN IT MAY HAVE AN
        // OPTIONS LEVEL. Thrown, not reported: a categorised member with a
        // colour ladder has no zone left to render it in, so the salesman would
        // see a product he cannot complete and the drawer would return a pick
        // with no row. Loud at the first build, which is a developer's machine
        // and a CI run, rather than silent on a phone in a shop.
        if (member.category !== undefined) {
          const n = resolved.bases.length + resolved.shades.length + resolved.variants.length;
          if (n > 0 || mode === "flat") {
            throw new Error(
              `v2 board: "${member.sap}" is in the category tile "${tile.label}" but has ` +
              `${n} option(s)${mode === "flat" ? " and is flat mode" : ""} and no pin. ` +
              `A category tile has no zone left to choose in — either pin it with ` +
              `option: "<the exact baseColour>", or take it off the tile.`);
          }
        }
        members.push({ ...resolved, sap: member.sap, joinSap: member.sap, pin: null,
                       category: member.category ?? null, label: member.label, mode, pools });
      }
      byKey.set(tile.key, { key: tile.key, label: tile.label, slug: tile.slug, members });
    }
  }

  return { byKey, report };
}

// ── Why FAMILIES was not rewritten in place ───────────────────────────────
//
// The step that authored BOARD was told two things that cannot both be done in
// one commit: "rewrite the FAMILIES constant as 9 families x 4 tiles", and
// "the board renders IDENTICALLY to today, all 32 current tiles behave
// IDENTICALLY". FAMILIES is what po-v2-page.tsx renders and po-v2-page.tsx is
// Step 2's file, not this one — rewriting FAMILIES in place would have changed
// the live board to 36 tiles in a commit whose stated safety property is that
// nothing moves, and it would not have compiled, because the page reads
// `tile.sap` and a member-shaped tile has no `sap`.
//
// So the new board is a new constant beside the old one.
//
// 🔴 WHAT ACTUALLY HAPPENED — corrected 2026-09-09. This block used to end
// "Step 2 points the page at BOARD and deletes FAMILIES in the same commit".
// Step 2 (1129427d) did the first half and NOT the second, and the plan was
// right to be abandoned: FAMILIES turned out to be the curation source, not
// just the old layout. The page renders BOARD; FAMILIES is still exported and
// buildCatalog still walks it for the ranked base/shade lists. Both constants
// are live and they own different things — the block above FAMILIES says which.
//
// A comment describing what a FUTURE step will do goes out of date the moment
// that step decides otherwise, and nothing fails when it does. This one was
// believed for three weeks.
