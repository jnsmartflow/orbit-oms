// v2 catalog seed — wipes mo_order_form_index_v2 and reinserts every row
// from docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json
// (512 source rows, 0 warnings, 34 families produced by the May 6
// 33-family taxonomy translator).
//
// 2026-05-30: applies a PROMISE-family transform AFTER flatten / validate
// and BEFORE the existing intra-family dedup. Goal — collapse the four
// PROMISE-family duplicates so /order shows each Promise SKU once, while
// keeping the desktop /place-order's section-aware split intact via a
// new mobileFamily column. See "Promise transform" block below.
//
// Per CLAUDE_CORE.md §3:
//   - sequential awaits, no prisma.$transaction([...])
//   - no prisma db push / no prisma migrate (the v2 table was created via
//     Supabase SQL Editor with scripts/v2-catalog-create-table.sql)
//
// Per locked decisions in the v2 catalog prompt (2026-05-10):
//   - v2 is fresh — no historical rows to preserve. wipe-and-reseed is safe.
//   - First-wins on dedup; log every dedup that happens.
//   - Insert in batches of 100 via createMany (skipDuplicates: false).
//   - Touches mo_order_form_index_v2 ONLY. Live mo_order_form_index
//     is never referenced.
//
// Run with:               npx tsx scripts/v2-catalog-seed-from-preview.ts
// Dry-run (NO DB writes): DRY_RUN=1 npx tsx scripts/v2-catalog-seed-from-preview.ts
//
// Idempotent on re-run: deleteMany({}) on an empty table is a no-op,
// and createMany on a wiped table re-inserts cleanly.

import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { BASE_ALIASES } from "@/lib/place-order/base-aliases";

// DATABASE_URL (transaction pooler, port 6543) — depot network blocks direct port 5432 connections per CLAUDE_CORE.md §3.
const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in environment.");
}
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: ["error"],
});

const PREVIEW_PATH = path.join(
  "docs", "prompts", "archive", "drafts", "2026-04-to-05", "taxonomy-preview.json",
);
const BATCH_SIZE   = 100;
const DRY_RUN      = process.env.DRY_RUN === "1";

// Locked expectations from the May 6 preview run. If the JSON drifts from
// these the script refuses to seed — better to fail loudly than to ship
// surprise data into v2.
const EXPECTED_TOTAL_NEW_ROWS    = 517;  // …; VT SPECIALTY net −4 2026-06-13; REMAINING-5 net −2 [TILE +1, LUSTRE −2 (drop BW-dup+YELLOW, +96), FLOOR PLUS −1 (drop BW)] 2026-06-14; SPRAY PAINT +11 2026-06-14; M900 GLOSS +12 2026-06-14; 5IN1 GLOSS +10 2026-06-15
const EXPECTED_WARNINGS          = 0;

// ── PROMISE transform constants ────────────────────────────────────────
// Mobile /order treats all four Promise families as a single "PROMISE"
// section; desktop /place-order keeps them split. The umbrella+specific
// duplication that ships in the source JSON is collapsed here so each
// Promise SKU appears in /order once.
const PROMISE_UMBRELLA  = "PROMISE";
const PROMISE_SPECIFICS = new Set<string>([
  "PROMISE INTERIOR", "PROMISE EXTERIOR", "PROMISE ENAMEL",
]);
const PROMISE_FAMILIES  = new Set<string>([PROMISE_UMBRELLA, ...Array.from(PROMISE_SPECIFICS)]);
// 2026-06-03: the new single PROMISE family authors these 6 clean tabs directly in
// the preview (no umbrella, no cross-listing). They must bypass the legacy phantom-
// reassignment (step 3), which would otherwise re-file e.g. "PROMISE PRIMER" → PRIMER.
const PROMISE_TABS = new Set<string>([
  "PROMISE ENAMEL",
  "PROMISE INTERIOR", "PROMISE SHEEN INTERIOR", "PROMISE EXTERIOR",
  "PROMISE SHEEN EXTERIOR", "PROMISE PRIMER", "PROMISE SMARTCHOICE",
]);
// 7 tabs (2026-06-03): Promise Enamel folded in as a Promise sub-product. Order
// (Enamels·Int·Ext·Sheen Int·Sheen Ext·SmartChoice·Primer) is driven by the
// preview sortOrders; these are the short tab labels (uiGroup).
const PROMISE_TAB_LABEL: Record<string, string> = {
  "PROMISE ENAMEL": "Enamels",
  "PROMISE INTERIOR": "Int", "PROMISE SHEEN INTERIOR": "Sheen Int",
  "PROMISE EXTERIOR": "Ext", "PROMISE SHEEN EXTERIOR": "Sheen Ext",
  "PROMISE PRIMER": "Primer", "PROMISE SMARTCHOICE": "SmartChoice",
};

// Names that should also surface under the PROMISE section on mobile /order
// even when the row's desktop family is something else — e.g. Promise primers
// live in family=PRIMER, Promise SmartChoice variants live in their own
// functional families. Detection is case-insensitive substring on subProduct.
const isPromiseName = (sp: string): boolean => {
  const up = sp.toUpperCase();
  return up.startsWith("PROMISE") || up.includes("SMARTCHOICE");
};

// Desktop families that get tie-break priority when collapsing PROMISE-mobile
// duplicates — a Promise primer's "proper" functional home is PRIMER, not
// PROMISE INTERIOR/EXTERIOR/ENAMEL; same idea for distempers.
const PROMISE_FUNCTIONAL_PRIORITY = new Set<string>(["PRIMER", "DISTEMPER"]);

// Family → section mapping for /place-order grid grouping (6 sections).
// Locked decisions in the section-grouping prompt: 33 functional families +
// PROMISE umbrella mapped to INTERIORS / EXTERIORS / ENAMELS / WOODCARE /
// UTILITY / MULTI-USE. No fallback — any new family must be added here
// before seeding will succeed (validated in step 5 of main()).
//
// May 11 CSV-review iteration: FLOOR PLUS and SMOOTHOVER moved from UTILITY
// to EXTERIORS (operator-aligned ordering — both live with mass exterior
// emulsions on the depot floor).
const FAMILY_TO_SECTION: Record<string, string> = {
  // INTERIORS
  "VELVET TOUCH":     "INTERIORS",
  "VT SPECIALTY":     "INTERIORS",
  "SUPERCLEAN":       "INTERIORS",
  "SUPERCOVER":       "INTERIORS",
  "PROMISE INTERIOR": "INTERIORS",
  // EXTERIORS
  "MAX":              "EXTERIORS",
  "POWERFLEXX":       "EXTERIORS",
  "PROTECT":          "EXTERIORS",
  "RAINPROOF":        "EXTERIORS",
  "HISHEEN":          "EXTERIORS",
  "TILE":             "EXTERIORS",
  "TEXTURE":          "EXTERIORS",
  "METALLIC":         "EXTERIORS",
  "PROMISE EXTERIOR": "EXTERIORS",
  "FLOOR PLUS":       "EXTERIORS",   // moved from UTILITY (May 11 CSV review)
  "SMOOTHOVER":       "EXTERIORS",   // moved from UTILITY (May 11 CSV review)
  "WS":               "EXTERIORS",   // post-grouping family (MAX/PROTECT/DUSTPROOF/RAINPROOF/POWERFLEXX) — step 7.7
  // ENAMELS
  "GLOSS":            "ENAMELS",
  "PU ENAMEL":        "ENAMELS",
  "SATIN":            "ENAMELS",
  "LUSTRE":           "ENAMELS",
  "PROMISE ENAMEL":   "ENAMELS",
  // WOODCARE
  // 2026-06-04: the 7 brand families below were merged into one SADOLIN family
  // (finish tabs). Their keys are kept (harmless) but no JSON rows reference
  // them anymore; SADOLIN is the live woodcare family.
  "SADOLIN":          "WOODCARE",
  "LUXURIO":          "WOODCARE",
  "2K PU":            "WOODCARE",
  "PU PRIME":         "WOODCARE",
  "NC":               "WOODCARE",
  "MELAMINE":         "WOODCARE",
  "WOOD STAIN":       "WOODCARE",
  "WOOD FILLER":      "WOODCARE",
  // UTILITY
  "AQUATECH":         "UTILITY",
  "PRIMER":           "UTILITY",
  "DISTEMPER":        "UTILITY",
  "PUTTY":            "UTILITY",
  "STAINER":          "UTILITY",
  "TOOLS":            "UTILITY",
  "SPRAY PAINT":      "UTILITY",
  // PROMISE (own section — one family head, 6 tabs, surfaced via speed-dial)
  "PROMISE":          "PROMISE",
};

// Family → subgroup mapping for /place-order within-section visual clusters.
// Subgroup is a render-time row-break label — cards within a subgroup flow
// continuously, then a new row starts when subgroup changes within a
// section. No subgroup text label is rendered. Names MAY repeat across
// sections (e.g. "Prep – putty" appears under both UTILITY/PUTTY and
// EXTERIORS/SMOOTHOVER) — row-break detection runs WITHIN a section, so
// cross-section repetition is harmless. No fallback — any new family must
// be added here before seeding will succeed (validated in step 5).
const FAMILY_TO_SUBGROUP: Record<string, string> = {
  // UTILITY
  "STAINER":          "Tinting",
  "PRIMER":           "Prep – primers",
  "DISTEMPER":        "Mass distemper",
  "AQUATECH":         "Waterproofing & decorative",
  "PUTTY":            "Prep – putty",
  "TOOLS":            "Tools & accessories",
  "SPRAY PAINT":      "Spray paints",
  // INTERIORS
  "PROMISE INTERIOR": "Promise (use-case interior)",
  "VELVET TOUCH":     "VT (Dulux Velvet Touch)",
  "VT SPECIALTY":     "VT (Dulux Velvet Touch)",
  "SUPERCLEAN":       "Mass-market emulsion",
  "SUPERCOVER":       "Mass-market emulsion",
  // EXTERIORS
  "PROMISE EXTERIOR": "Mid Tier Exterior Emulsion",
  "MAX":              "Mass exterior emulsion",
  "PROTECT":          "Mass exterior emulsion",
  "POWERFLEXX":       "Mass exterior emulsion",
  "RAINPROOF":        "Mass exterior emulsion",
  "HISHEEN":          "Specialty exterior",
  "FLOOR PLUS":       "Floor coatings",
  "TILE":             "Specialty exterior",
  "SMOOTHOVER":       "Prep – putty",
  "METALLIC":         "Specialty exterior",
  "TEXTURE":          "Specialty exterior",
  "WS":               "WS (Weather Shield)",   // post-grouping family — step 7.7
  // ENAMELS — PU ENAMEL is a standalone family; its subgroup is its own family
  // name (step-5 validation requires every family to map to a subgroup; a
  // standalone family row-breaks on its own rather than sharing a label).
  "GLOSS":            "Enamel finish (gloss)",
  "PU ENAMEL":        "PU ENAMEL",
  "SATIN":            "Enamel finish (satin)",
  "PROMISE ENAMEL":   "Promise (use-case enamel)",
  "LUSTRE":           "Enamel finish (lustre)",
  // WOODCARE — one SADOLIN family (finish tabs) as of 2026-06-04; legacy
  // per-brand subgroups kept as harmless unused keys.
  "SADOLIN":          "Sadolin",
  "LUXURIO":          "Sadolin Premium PU",
  "2K PU":            "Sadolin Premium PU",
  "PU PRIME":         "Sadolin Premium PU",
  "NC":               "Sadolin Standard Woodcare",
  "MELAMINE":         "Sadolin Standard Woodcare",
  "WOOD FILLER":      "Wood finishing",
  "WOOD STAIN":       "Wood finishing",
  // PROMISE
  "PROMISE":          "Promise",
};

// Shape of one row inside taxonomy-preview.json's newRowsByFamily arrays.
// Mirrors NewRow from lib/mail-orders/taxonomy-mapping.ts plus the
// preview-only `skuCount` field which is stripped before insert.
type PreviewRow = {
  family:       string;
  subProduct:   string;
  displayName:  string;
  searchTokens: string;
  baseColour:   string | null;
  productType:  "PLAIN" | "BASE_VARIANT" | "COLOUR";
  tinterType:   string | null;
  sortOrder:    number;
  isActive:     boolean;
  region?:      string | null;   // optional grey per-row region (Tools); paint rows omit it
  skuCount?:    number;     // preview metadata — discarded before insert
};

// Post-transform shape — adds mobileFamily, the single "PROMISE" tag
// (or pass-through family) that drives /order's flat-search section.
// `product` carries the SAP-clean stock product name once the name-map
// fill (step 7.6) runs; NULL until then (Path A default).
// `uiGroup` carries the within-family tab label (set by the grouping
// transform, step 7.7); NULL for families with no sub-grouping.
type TransformedRow = PreviewRow & { mobileFamily: string; product: string | null; uiGroup: string | null };

// ── Name-map fill inputs (broken-row fix, 2026-05-31) ───────────────────
// Rule 1: subProduct → SAP-clean stock product. These families' menu
// subProduct names diverge from mo_sku_lookup_v2.product, so the
// /api/order/data pack join (product ?? subProduct) misses. baseColour is
// left as-is; bases with no matching pack stay empty (acceptable).
const CONFIRMED_SUBPRODUCT_MAP: Record<string, string> = {
  "MAX":               "WS MAX",
  "POWERFLEXX":        "WS POWERFLEXX",
  "RAINPROOF":         "WS PROTECT RAINPROOF",
  "PROTECT":           "WS PROTECT",
  "PROTECT DUSTPROOF": "WS PROTECT DUSTPROOF",
  "HISHEEN":           "WS PROTECT HI-SHEEN",
  "PU STAINER":        "GVA",
  // 5IN1 GLOSS (2026-06-15): identity join-key so menu.product = "5IN1 GLOSS"
  // joins the stock rows (mapped from legacy DULUX/5IN1 + 2 Phiroza injects).
  // Folded into family GLOSS as a flat 4th tab. Non-null product → base aliases
  // (90→White etc.) render + §7.8 bakes their search words.
  "5IN1 GLOSS":        "5IN1 GLOSS",
  // M900 GLOSS (2026-06-14): identity join-key so menu.product = "M900 GLOSS"
  // joins the stock rows (re-keyed from legacy M900). Folded into family GLOSS
  // as a flat 3rd tab; regular GLOSS rows (subProduct "GLOSS") stay product=null.
  "M900 GLOSS":        "M900 GLOSS",
  // SPRAY PAINT (2026-06-14): identity join-key so menu.product = "SPRAY PAINT"
  // (non-null) joins the stock rows (re-keyed from legacy SR SPRAY PAINT) and
  // §7.8 can bake any alias tokens. Single product, colour variants.
  "SPRAY PAINT":       "SPRAY PAINT",
  // INTERIOR WBC (2026-06-14): menu subProduct "INTERIOR BASECOAT" → product
  // "INTERIOR WBC" (real SAP name; paired with the AQUATECH stock rename) so the
  // product+baseColour join hydrates its 4 packs and the email reads "INTERIOR
  // WBC". subProduct/displayName/uiGroup unchanged (AQUA_UI keys by subProduct).
  "INTERIOR BASECOAT": "INTERIOR WBC",
  // MACHINE TINTER (2026-06-14): renamed product STAINER→TINTER (email/grid/tab
  // brand). Identity now; base aliases (codes) key on "MACHINE TINTER".
  "MACHINE TINTER":    "MACHINE TINTER",
  // UNIVERSAL STAINER (2026-06-14): identity (was null) so its tint-code aliases
  // render + §7.8 bakes the code search words. Stock product already equals this.
  "UNIVERSAL STAINER": "UNIVERSAL STAINER",
  // Satin: identity join-key so base aliases render (product must be non-null,
  // like WS) and §7.8 bakes the alias search words. Stock product already
  // equals these, so the pack join is unchanged.
  "SUPER SATIN":       "SUPER SATIN",
  "SATIN STAY BRIGHT": "SATIN STAY BRIGHT",
  // SuperCover: identity join-keys so menu.product is non-null → base aliases
  // render + §7.8 bakes the alias search words. Stock product already equals
  // these ("SUPERCOVER" / "SUPERCOVER SHEEN"), so the pack join is unchanged.
  "SUPERCOVER":        "SUPERCOVER",
  "SUPERCOVER SHEEN":  "SUPERCOVER SHEEN",
  // SuperClean: identity join-keys (same trick) → menu.product non-null so base
  // aliases render + §7.8 bakes tokens. Stock product already matches.
  "SUPERCLEAN":        "SUPERCLEAN",
  "SUPERCLEAN 3IN1":   "SUPERCLEAN 3IN1",
  // Promise 7 tabs — identity join-key so base aliases render + §7.8 bakes tokens
  // (stock product, set via overrides, equals these).
  "PROMISE ENAMEL":         "PROMISE ENAMEL",
  "PROMISE INTERIOR":       "PROMISE INTERIOR",
  "PROMISE SHEEN INTERIOR": "PROMISE SHEEN INTERIOR",
  "PROMISE EXTERIOR":       "PROMISE EXTERIOR",
  "PROMISE SHEEN EXTERIOR": "PROMISE SHEEN EXTERIOR",
  "PROMISE PRIMER":         "PROMISE PRIMER",
  "PROMISE SMARTCHOICE":    "PROMISE SMARTCHOICE",
  // PUTTY + TEXTURE (2026-06-12): identity join-keys so menu.product is non-null
  // (explicit join + base aliases can fire later). Stock product == subProduct
  // after the texture-putty CSV re-key (step 1), so the pack join is unchanged.
  "ACRYLIC PUTTY":          "ACRYLIC PUTTY",
  "POLYPUTTY":              "POLYPUTTY",
  "TEXTURE":                "TEXTURE",
  "TEXTURE 2MM":            "TEXTURE 2MM",
  "TEXTURE 3MM":            "TEXTURE 3MM",
  // VT SPECIALTY (2026-06-13): identity join-keys so menu.product is non-null
  // (explicit join + base aliases can fire later). Stock product == subProduct
  // after the VT SPECIALTY CSV re-key (step 1), so the pack join is unchanged.
  "VAF":                    "VAF",
  "VT CONCRETE FINISH":     "VT CONCRETE FINISH",
  "VELVETINO":              "VELVETINO",
  "VT MARBLE":              "VT MARBLE",
  "VT CLEAR COAT":          "VT CLEAR COAT",
  // VELVET TOUCH (2026-06-13): identity join-keys so menu.product is non-null →
  // base aliases (base-aliases.ts) fire + §7.8 bakes the alias search words.
  // Stock product == subProduct already (rows join via subProduct today), so the
  // pack join is unchanged. Scoped to the 6 alias-bearing ranges.
  "PEARL GLO":              "VT PEARL GLO",
  "PLATINUM GLO":           "VT PLATINUM GLO",
  "DIAMOND GLO":            "VT DIAMOND GLO",
  "ETERNA":                 "VT ETERNA",
  "ETERNA MATT":            "VT ETERNA MATT",
  "ETERNA HI-SHEEN":        "VT ETERNA HI-SHEEN",
  // PU ENAMEL (2026-06-13): identity join-key so menu.product is non-null → its
  // (previously dormant) base aliases fire + §7.8 bakes the alias search words.
  // Stock product == subProduct already (joins via subProduct today), pack join
  // unchanged.
  "PU ENAMEL":              "PU ENAMEL",
  // REMAINING-5 (2026-06-14): identity join-keys so menu.product is non-null →
  // pack join is explicit and LUSTRE base aliases fire. Stock product ==
  // subProduct after the remaining5 CSV re-key (step 1), so the join is unchanged.
  "TILE":                   "WS TILE",
  "METALLIC":               "WS METALLIC",
  "LUSTRE":                 "LUSTRE",
  "SMOOTHOVER":             "SMOOTHOVER",
  "FLOOR PLUS":             "FLOOR PLUS",
};

// Rule 2: HIGH-confidence rows from the reviewed name-map draft
// (docs/prompts/drafts/v2-name-map-broken-2026-05-31.csv, 2026-05-31),
// inlined here so the seed carries no runtime file dependency. Keyed by
// natural key `${family}|||${subProduct}|||${baseColour ?? ""}`. All 17
// HIGH rows had baseColourChanged=N, so only `product` is set; the
// optional `baseColour` field is kept for future entries that repair a
// base spelling.
const HIGH_PRODUCT_MAP: Record<string, { product: string; baseColour?: string }> = {
  // (2026-06-04) removed stale "2K PU|||GLOSS|||93 BASE CLR" → BASE hack: the
  // 2K PU brand family no longer exists in the menu (folded into SADOLIN, where
  // the join key is the brand-scoped subProduct).
  // AQUATECH PU COAT + DAMP PROTECT BASECOAT hacks removed 2026-06-04: the
  // rebuilt AQUATECH menu rows now carry the exact stock product name as
  // subProduct (AQUATECH PU COAT / DAMP PROTECT BASECOAT), so the route's
  // (product ?? subProduct) join hydrates directly. The old DAMP PROTECT
  // BASECOAT → ETERNA mapping (which mis-joined to VT Eterna) is gone.
  "STAINER|||ACOTONE TINTER|||NO1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||XY1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||NO2":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||GR1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||BU1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||RE1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||OR1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||BU2":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||RE2":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||YE1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||YE2":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||XR1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||WH1":              { product: "ACOTONE" },
  "STAINER|||ACOTONE TINTER|||MA1":              { product: "ACOTONE" },
};

type PreviewJson = {
  summary: {
    totalNewRows:     number;
    warnings:         number;
    familiesProduced: number;
  };
  newRowsByFamily: Record<string, PreviewRow[]>;
};

function validateRow(r: PreviewRow, idx: number): void {
  const required: Array<keyof PreviewRow> = [
    "family", "subProduct", "displayName", "searchTokens",
    "productType", "sortOrder", "isActive",
  ];
  for (const f of required) {
    const v = r[f];
    if (v === undefined || v === null || v === "") {
      throw new Error(`Row ${idx} missing required field "${f}". Row: ${JSON.stringify(r)}`);
    }
  }
  if (!["PLAIN", "BASE_VARIANT", "COLOUR"].includes(r.productType)) {
    throw new Error(`Row ${idx} has invalid productType: ${r.productType}`);
  }
}

// Merge comma-separated searchTokens with case-insensitive de-dup, preserving
// the order of first occurrence. Returns a re-joined ", "-separated string.
function mergeSearchTokens(existing: string, incoming: string): string {
  const split = (s: string): string[] =>
    s.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  const seenLower = new Set<string>();
  const out: string[] = [];
  for (const t of [...split(existing), ...split(incoming)]) {
    const lower = t.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    out.push(t);
  }
  return out.join(", ");
}

async function main(): Promise<void> {
  /* eslint-disable no-console */

  // ── 1. Read + parse preview JSON ────────────────────────────────────
  const previewRaw = await fs.readFile(PREVIEW_PATH, "utf8");
  const preview    = JSON.parse(previewRaw) as PreviewJson;

  // ── 2. Validate summary block (locked expectations) ─────────────────
  if (preview.summary.warnings !== EXPECTED_WARNINGS) {
    throw new Error(
      `Preview has ${preview.summary.warnings} warnings (expected ${EXPECTED_WARNINGS}). ` +
      `Refusing to seed — resolve warnings first.`,
    );
  }
  if (preview.summary.totalNewRows !== EXPECTED_TOTAL_NEW_ROWS) {
    throw new Error(
      `Preview totalNewRows=${preview.summary.totalNewRows} (expected ${EXPECTED_TOTAL_NEW_ROWS}). ` +
      `Refusing to seed — preview shape has drifted.`,
    );
  }
  console.log(`Preview validated: warnings=${preview.summary.warnings}, ` +
              `totalNewRows=${preview.summary.totalNewRows}, ` +
              `familiesProduced=${preview.summary.familiesProduced}`);
  if (DRY_RUN) console.log("DRY_RUN=1 — NO DB writes will be performed.");

  // ── 3. Flatten newRowsByFamily into one array ───────────────────────
  const flat: PreviewRow[] = [];
  for (const fam of Object.keys(preview.newRowsByFamily)) {
    for (const r of preview.newRowsByFamily[fam]) flat.push(r);
  }
  if (flat.length !== preview.summary.totalNewRows) {
    throw new Error(
      `Flatten count ${flat.length} ≠ summary.totalNewRows ${preview.summary.totalNewRows}.`,
    );
  }
  console.log(`Rows read from JSON : ${flat.length}`);

  // ── 4. Validate every row (fail fast on shape errors) ───────────────
  flat.forEach(validateRow);

  // ── 4.5. Promise transform — Steps 1/2/3 from the prompt ────────────
  //
  // Step 1: tag every row with a mobileFamily, collapsing the four
  //         PROMISE families onto a single "PROMISE" mobile section.
  //         Also pulls in Promise-named rows whose desktop family is a
  //         functional bucket (PRIMER / DISTEMPER / etc.) — they appear
  //         under PROMISE on mobile but keep their desktop family.
  //         Non-Promise families pass through unchanged.
  const tagged: TransformedRow[] = flat.map((r) => ({
    ...r,
    product: null,
    uiGroup: null,
    mobileFamily: (PROMISE_FAMILIES.has(r.family) || isPromiseName(r.subProduct))
      ? PROMISE_UMBRELLA
      : r.family,
  }));

  // Step 2: group by (subProduct, baseColour) and collapse umbrella
  //         duplicates that have a specific Promise sibling. Drop the
  //         umbrella row(s); keep the specific row(s); merge umbrella
  //         searchTokens into each kept specific.
  const groupMap = new Map<string, TransformedRow[]>();
  for (const r of tagged) {
    const key = `${r.subProduct}|${r.baseColour ?? ""}`;
    let bucket = groupMap.get(key);
    if (!bucket) { bucket = []; groupMap.set(key, bucket); }
    bucket.push(r);
  }

  let collapsed: TransformedRow[] = [];
  const mergedSpecifics: TransformedRow[] = []; // for dry-run sample
  let umbrellaDropped = 0;
  for (const rows of Array.from(groupMap.values())) {
    const umbrellas = rows.filter((r) => r.family === PROMISE_UMBRELLA);
    const specifics = rows.filter((r) => PROMISE_SPECIFICS.has(r.family));
    if (umbrellas.length > 0 && specifics.length > 0) {
      // Concatenate all umbrella searchTokens, then merge into each
      // surviving specific row's searchTokens.
      const umbrellaTokens = umbrellas.map((u) => u.searchTokens).join(", ");
      for (const s of specifics) {
        s.searchTokens = mergeSearchTokens(s.searchTokens, umbrellaTokens);
        mergedSpecifics.push(s);
      }
      // Drop umbrella(s); keep all non-umbrella rows in this group
      // (specifics + any unrelated families that share the key).
      const survivors = rows.filter((r) => r.family !== PROMISE_UMBRELLA);
      collapsed.push(...survivors);
      umbrellaDropped += umbrellas.length;
    } else {
      collapsed.push(...rows);
    }
  }
  console.log(`Promise umbrella collapse: dropped ${umbrellaDropped} umbrella row(s), ` +
              `merged tokens into ${mergedSpecifics.length} specific row(s)`);

  // Step 3: any row still on family="PROMISE" had no specific sibling —
  //         reassign its desktop family by subProduct-name heuristics.
  //         mobileFamily stays "PROMISE". Records UNHANDLED for the report.
  type PhantomEntry = {
    subProduct: string;
    baseColour: string | null;
    assignedTo: string;
  };
  const phantomReassignments: PhantomEntry[] = [];
  const unhandledPhantoms:    TransformedRow[] = [];
  for (const r of collapsed) {
    if (r.family !== PROMISE_UMBRELLA) continue;
    if (PROMISE_TABS.has(r.subProduct)) continue;  // clean new PROMISE family — keep as-is
    const sp = r.subProduct.toUpperCase();
    let assigned: string | null = null;
    if      (sp.includes("PRIMER"))    assigned = "PRIMER";
    else if (sp.includes("DISTEMPER")) assigned = "DISTEMPER";
    else if (sp.includes("EXT"))       assigned = "PROMISE EXTERIOR";
    else if (sp.includes("INT"))       assigned = "PROMISE INTERIOR";
    if (assigned) {
      phantomReassignments.push({
        subProduct: r.subProduct, baseColour: r.baseColour, assignedTo: assigned,
      });
      r.family = assigned;
      // mobileFamily intentionally stays PROMISE
    } else {
      unhandledPhantoms.push(r);
    }
  }
  console.log(`Phantom Promise rows reassigned: ${phantomReassignments.length}, ` +
              `unhandled (still PROMISE): ${unhandledPhantoms.length}`);

  // Step 3.5: SmartChoice primer merge — small explicit name+family
  // canonicalisation. The source JSON ships bare-named rows under
  // family=PRIMER ("SMARTCHOICE EXT PRIMER" / "SMARTCHOICE INT PRIMER")
  // alongside fully-prefixed twins under family=PROMISE EXTERIOR/INTERIOR
  // ("PROMISE SMARTCHOICE EXT PRIMER" / "...INT PRIMER"). The full-name
  // rows are the canonical depot/SAP names and the v2 SKU-lookup join
  // key. Merge each bare row INTO its full-name twin (matched by target
  // subProduct + same baseColour) and drop the bare row. If no twin
  // exists (defensive), rename the bare row to the full shape so the
  // canonical name still wins.
  const SMARTCHOICE_PRIMER_MERGE: Record<string, { subProduct: string; family: string }> = {
    "SMARTCHOICE EXT PRIMER": { subProduct: "PROMISE SMARTCHOICE EXT PRIMER", family: "PROMISE EXTERIOR" },
    "SMARTCHOICE INT PRIMER": { subProduct: "PROMISE SMARTCHOICE INT PRIMER", family: "PROMISE INTERIOR" },
  };
  type SmartchoicePrimerMerge = { oldName: string; keptName: string };
  const smartchoicePrimerMerges: SmartchoicePrimerMerge[] = [];
  const smartchoiceDropped     = new Set<TransformedRow>();
  for (const r of collapsed) {
    if (smartchoiceDropped.has(r)) continue;
    const key    = r.subProduct.toUpperCase().trim();
    const target = SMARTCHOICE_PRIMER_MERGE[key];
    if (!target) continue;
    // Find the full-name twin in the same dataset (same target subProduct
    // AND same baseColour). Excludes already-dropped rows so each bare
    // row collapses at most once.
    const twin = collapsed.find((t) =>
      t !== r &&
      !smartchoiceDropped.has(t) &&
      t.subProduct === target.subProduct &&
      (t.baseColour ?? null) === (r.baseColour ?? null),
    );
    if (twin) {
      twin.searchTokens = mergeSearchTokens(twin.searchTokens, r.searchTokens);
      smartchoiceDropped.add(r);
      smartchoicePrimerMerges.push({ oldName: r.subProduct, keptName: twin.subProduct });
    } else {
      // Defensive: no twin found. Rename the bare row in place so the
      // canonical name still surfaces. mobileFamily is re-derived in
      // case the rename moved family into PROMISE_FAMILIES.
      smartchoicePrimerMerges.push({ oldName: r.subProduct, keptName: target.subProduct });
      r.subProduct = target.subProduct;
      r.family     = target.family;
      if (PROMISE_FAMILIES.has(r.family)) r.mobileFamily = PROMISE_UMBRELLA;
    }
  }
  if (smartchoiceDropped.size > 0) {
    collapsed = collapsed.filter((r) => !smartchoiceDropped.has(r));
  }
  console.log(`SmartChoice primer merge: ${smartchoicePrimerMerges.length} merge(s), ` +
              `${smartchoiceDropped.size} row(s) dropped`);

  // ── 5. Validate every distinct (post-transform) family has FAMILY_TO_SECTION + FAMILY_TO_SUBGROUP ─
  // Reads from `collapsed` so Step 3's reassignments are honoured. No
  // fallback — schema drift must fail loudly, not silently insert NULL
  // into either column.
  const distinctFamilies = Array.from(new Set(collapsed.map((r) => r.family))).sort();
  const missingSection   = distinctFamilies.filter((f) => !(f in FAMILY_TO_SECTION));
  const missingSubgroup  = distinctFamilies.filter((f) => !(f in FAMILY_TO_SUBGROUP));
  if (missingSection.length > 0 || missingSubgroup.length > 0) {
    const lines: string[] = [];
    if (missingSection.length > 0) {
      lines.push(`${missingSection.length} family/families missing from FAMILY_TO_SECTION:`);
      missingSection.forEach((f) => lines.push(`  - ${f}`));
    }
    if (missingSubgroup.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(`${missingSubgroup.length} family/families missing from FAMILY_TO_SUBGROUP:`);
      missingSubgroup.forEach((f) => lines.push(`  - ${f}`));
    }
    lines.push("");
    lines.push("Add entries to the relevant constant(s) at the top of this script before re-running.");
    throw new Error(lines.join("\n"));
  }
  console.log(`Family→section/subgroup coverage: ${distinctFamilies.length} families, all mapped ✓`);

  // ── 6. Sort by sortOrder ASC so dedup keeps the lowest-order winner ─
  // For convergent rows (e.g. WS/MAX + WEATHERCOAT/MAX both producing
  // MAX|MAX|<base>), the byte-identical output property means it doesn't
  // matter which one wins — but sorting first makes the choice
  // deterministic and the dedup log meaningful.
  collapsed.sort((a, b) => a.sortOrder - b.sortOrder);

  // ── 7. Final dedup on (family, subProduct, baseColour ?? '') ────────
  // Intra-family safety pass. Same key as before; the Promise transform
  // above eliminates cross-family PROMISE duplicates already.
  const seen    = new Set<string>();
  let   deduped: TransformedRow[] = [];
  let   dropped = 0;
  for (const r of collapsed) {
    const key = `${r.family}|||${r.subProduct}|||${r.baseColour ?? ""}`;
    if (seen.has(key)) {
      dropped++;
      console.log(`[dedup] ${r.family}|${r.subProduct}|${r.baseColour ?? "null"} ` +
                  `(sortOrder=${r.sortOrder}, kept first occurrence)`);
      continue;
    }
    seen.add(key);
    deduped.push(r);
  }
  console.log(`Rows after dedup    : ${deduped.length} (dropped ${dropped})`);
  const rowsAfterIntraDedup = deduped.length;

  // ── 7.5. Promise mobile de-dupe pass ───────────────────────────────
  // The intra-family dedup above only collapses on (family, subProduct,
  // baseColour). Mobile /order shows one section for all PROMISE rows,
  // so a Promise SKU that exists under TWO different desktop families
  // (e.g. "PROMISE EXT PRIMER" both in PRIMER and in PROMISE EXTERIOR)
  // would still appear twice on mobile. This pass keeps one row per
  // (subProduct, baseColour) WITHIN mobileFamily="PROMISE".
  //
  // Tie-break: prefer rows whose desktop family is in
  // PROMISE_FUNCTIONAL_PRIORITY (PRIMER / DISTEMPER) — their classification
  // matches what the parser / email pipeline calls them. Otherwise keep the
  // lowest sortOrder. Dropped rows' searchTokens merge into the kept row
  // (case-insensitive de-dup) so no aliases are lost from mobile search.
  type PromiseCollapseEntry = {
    subProduct:      string;
    baseColour:      string | null;
    keptFamily:      string;
    droppedFamilies: string[];
  };
  const promiseMobileCollapses: PromiseCollapseEntry[] = [];
  const promiseGroupMap = new Map<string, TransformedRow[]>();
  for (const r of deduped) {
    if (r.mobileFamily !== PROMISE_UMBRELLA) continue;
    const key = `${r.subProduct}|${r.baseColour ?? ""}`;
    let bucket = promiseGroupMap.get(key);
    if (!bucket) { bucket = []; promiseGroupMap.set(key, bucket); }
    bucket.push(r);
  }
  const promiseDroppedRows = new Set<TransformedRow>();
  for (const rows of Array.from(promiseGroupMap.values())) {
    if (rows.length < 2) continue;
    const functional = rows.filter((r) => PROMISE_FUNCTIONAL_PRIORITY.has(r.family));
    const candidates = functional.length > 0 ? functional : rows;
    const sortedCandidates = candidates.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const kept = sortedCandidates[0];
    const droppedRows = rows.filter((r) => r !== kept);
    for (const d of droppedRows) {
      kept.searchTokens = mergeSearchTokens(kept.searchTokens, d.searchTokens);
      promiseDroppedRows.add(d);
    }
    promiseMobileCollapses.push({
      subProduct:      kept.subProduct,
      baseColour:      kept.baseColour,
      keptFamily:      kept.family,
      droppedFamilies: droppedRows.map((d) => d.family),
    });
  }
  deduped = deduped.filter((r) => !promiseDroppedRows.has(r));
  console.log(`Promise mobile de-dupe: ${promiseMobileCollapses.length} collapse(s), ` +
              `dropped ${promiseDroppedRows.size} row(s) from /order view`);

  // ── 7.6. Product name-map fill (broken-row fix) ─────────────────────
  // Populate `product` (SAP-clean stock name) so /api/order/data's pack
  // join resolves. Applied per row in order:
  //   Rule 1: CONFIRMED_SUBPRODUCT_MAP by subProduct (baseColour untouched).
  //   Rule 2: else HIGH_PRODUCT_MAP by natural key (family, subProduct,
  //           baseColour) — inlined from the reviewed draft; when a future
  //           entry carries baseColour, the base spelling is repaired too.
  //   Else:   product stays NULL (deferred oddballs).
  // No other field is altered.
  let filledRule1 = 0;
  let filledRule2 = 0;
  for (const r of deduped) {
    const sp = r.subProduct.trim().toUpperCase();
    // TOOLS: identity join-key — subProduct already IS the uppercase stock
    // product name, so fill product = subProduct (byte-matches mo_sku_lookup_v2).
    if (r.family === "TOOLS") { r.product = r.subProduct; filledRule1++; continue; }
    const confirmed = CONFIRMED_SUBPRODUCT_MAP[sp];
    if (confirmed) {
      r.product = confirmed;
      filledRule1++;
      continue;
    }
    const hit = HIGH_PRODUCT_MAP[`${r.family}|||${r.subProduct}|||${r.baseColour ?? ""}`];
    if (hit) {
      r.product = hit.product;
      if (hit.baseColour) r.baseColour = hit.baseColour;
      filledRule2++;
    }
  }
  console.log(`Product name-map fill: rule1(subProduct)=${filledRule1}, ` +
              `rule2(inline HIGH)=${filledRule2}, total=${filledRule1 + filledRule2}`);

  // ── Interior WBC baseColour align (2026-06-14) ──────────────────────────────
  // Stock carries baseColour "" (empty) for INTERIOR WBC; the menu preview row
  // carries null, so the product+baseColour join would miss. Rule 1 sets only
  // product, so align baseColour → "" here. Scoped to the single renamed row.
  let interiorWbcAligned = 0;
  for (const r of deduped) {
    if (r.product === "INTERIOR WBC") { r.baseColour = ""; interiorWbcAligned++; }
  }
  console.log(`Interior WBC baseColour align: ${interiorWbcAligned} row(s) → ""`);

  // ── 7.65. WS Max base removal (durable; approved 2026-06-01) ────────
  // Drop 5 WS Max menu bases entirely, PRE-grouping (rows are still
  // family=MAX here). Count-safe: taxonomy-preview.json still has 512 rows
  // so the EXPECTED_TOTAL_NEW_ROWS=512 guard (step 2) is unaffected — this
  // only trims the final inserted set. The matching stock rows are excluded
  // in v2-sku-seed-from-legacy.ts.
  const MENU_REMOVE_WSMAX = new Set<string>([
    "PASTEL BASE", "YELLOW BASE", "YELLOW OXIDE", "ROX", "RED OXIDE",
  ]);
  const beforeMenuRemove = deduped.length;
  deduped = deduped.filter((r) => !(
    r.family === "MAX" && r.subProduct === "MAX" &&
    MENU_REMOVE_WSMAX.has((r.baseColour ?? "").trim().toUpperCase())
  ));
  console.log(`WS Max base removal: dropped ${beforeMenuRemove - deduped.length} menu row(s)`);

  // ── 7.7. Durable grouping transform (approved map 2026-05-31) ───────
  // Applied ON TOP of the flat output. Promise dedup, Phase-1 product fill,
  // and searchTokens are all preserved. Changes ONLY family / subProduct /
  // uiGroup — EXCEPT the few "restructured" rows (ROOF COAT fold + the two
  // rescued DUSTPROOF rows) which are set to EXACTLY match the known-good
  // backup mo_order_form_index_v2_bak_20260530 (incl. product/baseColour),
  // reproducing its representation. Encoded inline (no CSV read at runtime),
  // mirroring the Phase-1 inline pattern. Source: docs/prompts/drafts/
  // grouping-restore-map-2026-05-31.csv (approved).
  //
  // Snapshot pre-grouping join identity for the dry-run pack-regression check.
  const preGroupKey = new Map<TransformedRow, string>();
  for (const r of deduped) preGroupKey.set(r, `${r.product ?? r.subProduct}|||${r.baseColour ?? ""}`);

  const WS_CONSOLIDATE = new Set<string>(["MAX", "POWERFLEXX", "PROTECT", "RAINPROOF", "HISHEEN"]);
  // Desktop tab label per WS sub-product (uiGroup ?? subProduct drives the tab).
  // Plain "PROTECT" is intentionally absent — those rows are dropped in 7.75.
  const WS_TAB_LABEL: Record<string, string> = {
    "MAX":        "Max",
    "POWERFLEXX": "Powerflexx",
    "DUSTPROOF":  "Protect Dustproof",
    "RAINPROOF":  "Protect Rainproof",
    "HI-SHEEN":   "Protect Hi-Sheen",
  };
  const SATIN_UI: Record<string, string> = {
    "SATIN STAY BRIGHT": "Satin Stay Bright",
    "SUPER SATIN":       "Satin Finish",
  };
  const STAINER_UI: Record<string, string> = {
    "UNIVERSAL STAINER": "UNIVERSAL STAINER",
    "MACHINE TINTER":    "MACHINE TINTER",
    "ACOTONE TINTER":    "ACOTONE",
    "PU STAINER":        "GVA / PU",
    "HP COLORANT":       "HP",
  };
  // PRIMER renders as ONE FLAT LIST (2026-06-08): every PRIMER row gets a single
  // shared uiGroup ("Primers") in the assign loop below — one tab, no per-product
  // tab-switching (was WOOD / METAL / CEMENT / ACRYLIC / ALKALI BLOC tabs).
  // AQUATECH rebuilt 2026-06-04 to 20 products / 4 tabs. Keyed by the EXACT
  // stock product name (= subProduct in the rebuilt preview rows), so uiGroup
  // assigns cleanly and the (product ?? subProduct) join hydrates each row.
  const AQUA_UI: Record<string, string> = {
    // Ext / Int Coat
    "DAMP PROTECT BASECOAT": "Ext / Int Coat",
    "DAMP PROTECT 2IN1":     "Ext / Int Coat",
    "FBC ADVANCE":           "Ext / Int Coat",
    "FBC NEO":               "Ext / Int Coat",
    "INTERIOR BASECOAT":     "Ext / Int Coat",
    "IBC ADVANCE":           "Ext / Int Coat",
    "ROOF COAT WHITE":       "Ext / Int Coat",
    "ROOF COAT GREY":        "Ext / Int Coat",
    "ROOF COAT TERACOTTA":   "Ext / Int Coat",
    "AQUATECH PU COAT":      "Ext / Int Coat",
    // Crack Filler
    "CRACKFILLER 5MM":       "Crack Filler",
    "CRACKFILLER 10MM":      "Crack Filler",
    "CRACKFILLER 20MM":      "Crack Filler",
    // Additives
    "WRP":                   "Additives",
    "LW PLUS":               "Additives",
    "RP LATEX":              "Additives",
    "PRETREATMENT COAT":     "Additives",
    "TG COTTON WOOL":        "Additives",
    "WATERBLOCK 2K":         "Additives",
    // Putty
    "WATERPROOF PUTTY":      "Putty",
  };
  // SADOLIN: one family (merged 7 ex-Woodcare brands, 2026-06-04), 6 finish
  // tabs. Keyed by the brand-scoped subProduct (= proposedProduct, uppercase);
  // product→tab is 1:1. uiGroup = proposedTab; subProduct stays the pack-join
  // key (matches the brand-scoped stock product from step 1).
  const SADOLIN_UI: Record<string, string> = {
    "1K PU GLOSS": "Gloss",
    "2K PU GLOSS": "Gloss",
    "HYDRO PU GLOSS": "Gloss",
    "PU PRIME GLOSS": "Gloss",
    "LUXURIO GLOSS": "Gloss",
    "MELAMINE GLOSS": "Gloss",
    "2K PU MATT": "Matt",
    "HYDRO PU DEAD MATT": "Matt",
    "HYDRO PU MATT": "Matt",
    "PU PRIME MATT": "Matt",
    "LUXURIO MATT": "Matt",
    "MELAMINE MATT": "Matt",
    "2K PU PRIMER SURFACER": "Sealer",
    "2K PU SEALER": "Sealer",
    "HYDRO PU SEALER": "Sealer",
    "PU PRIME SEALER": "Sealer",
    "LUXURIO SEALER": "Sealer",
    "MELAMINE SEALER": "Sealer",
    "NC SANDING SEALER": "Sealer",
    "2K PU THINNER": "Thinner",
    "PU PRIME THINNER": "Thinner",
    "MELAMINE THINNER": "Thinner",
    "NC NECOL THINNER": "Thinner",
    "NC WOOD THINNER": "Thinner",
    "NC CLEAR LACQUER": "Lacquer / Varnish",
    "NC NECOL": "Lacquer / Varnish",
    "NC NECOL CLEAR": "Lacquer / Varnish",
    "NC OPAQUE": "Lacquer / Varnish",
    "SYNTHETIC VARNISH": "Lacquer / Varnish",
    "WOOD FILLER": "Filler / Stain",
    "WOOD STAIN": "Filler / Stain",
  };
  // VELVET TOUCH: one family (merged VT GLO + VT ETERNA, 2026-06-03), 6 tabs.
  // uiGroup = short tab label; subProduct stays the pack-join key (unchanged).
  // ETERNA BASECOAT kept for completeness (0 rows today → renders no tab).
  const VELVET_TOUCH_UI: Record<string, string> = {
    "PEARL GLO": "Pearl", "PLATINUM GLO": "Platinum", "DIAMOND GLO": "Diamond",
    "ETERNA": "Eterna", "ETERNA MATT": "Eterna Matt", "ETERNA HI-SHEEN": "Eterna Hi-Sheen",
    "ETERNA BASECOAT": "Eterna Basecoat",
  };
  const glossBase = (base: string | null): boolean => {
    const b = (base ?? "").trim().toUpperCase();
    return b === "BRILLIANT WHITE" || /\bBASE$/.test(b);
  };
  // Restructured rows — match the backup EXACTLY. Keyed by PRE-grouping
  // `${family}|${subProduct}|${baseColour ?? ""}`.
  const RESTRUCTURED: Record<string, { family: string; subProduct: string; baseColour: string | null; product: string; uiGroup: string }> = {
    // AQUATECH ROOF COAT restructure removed 2026-06-04: the rebuilt preview
    // now ships ROOF COAT WHITE/GREY/TERACOTTA as discrete subProducts (blank
    // baseColour), so no pre-grouping rewrite is needed.
    "PROTECT|PROTECT DUSTPROOF|ROX":         { family: "WS", subProduct: "PROTECT", baseColour: "ROX",         product: "WS PROTECT", uiGroup: "PROTECT" },
    "PROTECT|PROTECT DUSTPROOF|YELLOW BASE": { family: "WS", subProduct: "PROTECT", baseColour: "YELLOW BASE", product: "WS PROTECT", uiGroup: "PROTECT" },
  };

  // Native FLOOR PLUS keys (subProduct|baseColour) — used to drop the
  // AQUATECH FLOOR PLUS duplicates rather than collide with these on move.
  const nativeFloorPlus = new Set<string>(
    deduped.filter((r) => r.family === "FLOOR PLUS").map((r) => `${r.subProduct}|${r.baseColour ?? ""}`),
  );
  const floorPlusDropped = new Set<TransformedRow>();

  let wsCount = 0, floorPlusMoved = 0, floorPlusDroppedCount = 0, uiAssigned = 0, restructuredCount = 0;
  for (const r of deduped) {
    const preKey = `${r.family}|${r.subProduct}|${r.baseColour ?? ""}`;
    const rs = RESTRUCTURED[preKey];
    if (rs) {
      r.family = rs.family; r.subProduct = rs.subProduct; r.baseColour = rs.baseColour;
      r.product = rs.product; r.uiGroup = rs.uiGroup;
      restructuredCount++;
      continue;
    }
    const sub = r.subProduct.trim().toUpperCase();
    // WS consolidation
    if (WS_CONSOLIDATE.has(r.family)) {
      if (r.family === "PROTECT" && sub === "PROTECT DUSTPROOF") r.subProduct = "DUSTPROOF";
      if (r.family === "HISHEEN" && sub === "HISHEEN")           r.subProduct = "HI-SHEEN";
      r.family  = "WS";
      r.uiGroup = WS_TAB_LABEL[r.subProduct] ?? r.subProduct;   // desktop tab label
      wsCount++;
      continue;
    }
    // FLOOR PLUS extraction from AQUATECH — drop rows that duplicate a
    // native FLOOR PLUS row on (subProduct, baseColour); move the rest.
    if (r.family === "AQUATECH" && sub === "FLOOR PLUS") {
      if (nativeFloorPlus.has(`${r.subProduct}|${r.baseColour ?? ""}`)) {
        floorPlusDropped.add(r);
        floorPlusDroppedCount++;
        continue;
      }
      r.family = "FLOOR PLUS";
      floorPlusMoved++;
      continue;
    }
    // uiGroup assignment (subProduct UNCHANGED → pack join key preserved)
    // GLOSS: BASE/COLOUR split — GREEN BASE moves to COLOUR (locked 2026-06-02)
    // despite ending in "BASE", so it groups with the named colours.
    // M900 GLOSS (2026-06-14) is a 3rd sub-product folded into GLOSS — one FLAT
    // tab "M900" (no base/colour split); routed before the BASE/COLOUR split.
    // 5IN1 GLOSS (2026-06-15) is a 4th sub-product — one FLAT tab "5IN1".
    if (r.family === "GLOSS")    {
      if (r.subProduct === "M900 GLOSS") { r.uiGroup = "M900"; uiAssigned++; continue; }
      if (r.subProduct === "5IN1 GLOSS") { r.uiGroup = "5IN1"; uiAssigned++; continue; }
      r.uiGroup = (glossBase(r.baseColour) && (r.baseColour ?? "").toUpperCase() !== "GREEN BASE") ? "BASE" : "COLOUR"; uiAssigned++; continue;
    }
    // PU ENAMEL (2026-06-13): one flat tab "PU Enamel" (was a GLOSS-style
    // BASE/COLOUR split) so it forms a single tab when folded into tile 2.
    // subProduct stays "PU ENAMEL" (the stock pack-join key); product set via
    // CONFIRMED_SUBPRODUCT_MAP so base aliases (90/92/94) render.
    if (r.family === "PU ENAMEL") { r.uiGroup = "PU Enamel"; uiAssigned++; continue; }
    // PROMISE: one family, 6 tabs (uiGroup short label; subProduct = tab = pack-join key).
    if (r.family === "PROMISE" && PROMISE_TAB_LABEL[r.subProduct]) { r.uiGroup = PROMISE_TAB_LABEL[r.subProduct]; uiAssigned++; continue; }
    if (r.family === "VELVET TOUCH" && VELVET_TOUCH_UI[sub]) { r.uiGroup = VELVET_TOUCH_UI[sub]; uiAssigned++; continue; }
    // SUPERCOVER: one family, 2 tabs (SuperCover / SuperCover Sheen). uiGroup =
    // tab label; subProduct stays the pack-join key. Display/tab-label only.
    if (r.family === "SUPERCOVER") { r.uiGroup = sub === "SUPERCOVER SHEEN" ? "SuperCover Sheen" : "SuperCover"; uiAssigned++; continue; }
    // SUPERCLEAN: one family, 2 tabs (SuperClean / SuperClean 3in1). Display-only.
    if (r.family === "SUPERCLEAN") { r.uiGroup = sub === "SUPERCLEAN 3IN1" ? "SuperClean 3in1" : "SuperClean"; uiAssigned++; continue; }
    if (r.family === "SATIN"   && SATIN_UI[sub])   { r.uiGroup = SATIN_UI[sub];   uiAssigned++; continue; }
    if (r.family === "STAINER" && STAINER_UI[sub]) { r.uiGroup = STAINER_UI[sub]; uiAssigned++; continue; }
    if (r.family === "PRIMER")  { r.uiGroup = "Primers";  uiAssigned++; continue; }
    // DISTEMPER (2026-06-12): one flat tab like PRIMER. uiGroup="Distemper" on all
    // rows; product stays null and baseColour is KEPT so the two Magik rows stay
    // separate (MAGIK|||90 BASE vs MAGIK|||BRILLIANT WHITE).
    if (r.family === "DISTEMPER") { r.uiGroup = "Distemper"; uiAssigned++; continue; }
    // PUTTY + TEXTURE (2026-06-12): two families share ONE flat tab "Texture & Putty"
    // (like Distemper's flat branch). Renders as 6 rows — Acrylic/Poly Putty +
    // Texture 90/94 + Texture 2MM/3MM — under one tab on tile 8.
    if (r.family === "PUTTY" || r.family === "TEXTURE") { r.uiGroup = "Texture & Putty"; uiAssigned++; continue; }
    // VT SPECIALTY (2026-06-13): one flat tab "VT Specialty" — 11 visible rows
    // (VAF ×6, VT Concrete Finish, Velvetino ×2, VT Marble, VT Clear Coat).
    if (r.family === "VT SPECIALTY") { r.uiGroup = "VT Specialty"; uiAssigned++; continue; }
    // REMAINING-5 (2026-06-14): one flat tab per family (folded onto tile 4 WS /
    // tile 2 Satin&PU / search-only). uiGroup matches remaining5-final.csv.
    if (r.family === "TILE")       { r.uiGroup = "WS Tile";     uiAssigned++; continue; }
    if (r.family === "METALLIC")   { r.uiGroup = "WS Metallic"; uiAssigned++; continue; }
    if (r.family === "LUSTRE")     { r.uiGroup = "Lustre";      uiAssigned++; continue; }
    if (r.family === "SMOOTHOVER") { r.uiGroup = "Smoothover";  uiAssigned++; continue; }
    if (r.family === "FLOOR PLUS") { r.uiGroup = "Floor Plus";  uiAssigned++; continue; }
    if (r.family === "AQUATECH" && AQUA_UI[sub])   { r.uiGroup = AQUA_UI[sub];    uiAssigned++; continue; }
    if (r.family === "SADOLIN"  && SADOLIN_UI[sub]) { r.uiGroup = SADOLIN_UI[sub]; uiAssigned++; continue; }
    // TOOLS — two tabs derived from the product name (Rollers / Brushes).
    if (r.family === "TOOLS")   { r.uiGroup = /ROLLER/i.test(r.product ?? r.subProduct) ? "Rollers" : "Brushes"; uiAssigned++; continue; }
    // SPRAY PAINT — single flat uiGroup (no tabs; one product, colour variants).
    if (r.family === "SPRAY PAINT") { r.uiGroup = "Spray Paint"; uiAssigned++; continue; }
  }
  if (floorPlusDropped.size > 0) deduped = deduped.filter((r) => !floorPlusDropped.has(r));
  console.log(`Grouping transform: WS consolidated=${wsCount}, FLOOR PLUS moved=${floorPlusMoved}, ` +
              `FLOOR PLUS dropped(dup)=${floorPlusDroppedCount}, uiGroup assigned=${uiAssigned}, restructured=${restructuredCount}`);

  // ── 7.75. Drop the wrong plain "WS PROTECT" sub-product ─────────────
  // Post-grouping (subProduct is final here): removes all WS/subProduct=PROTECT
  // rows — the 16 plain Protect bases AND the 2 RESTRUCTURED rescues (ROX /
  // YELLOW BASE). All hydrate to 0 packs now that the SKU side removed product
  // "WS PROTECT", so the tab is dropped. subProduct="DUSTPROOF" is untouched.
  const beforeProtectDrop = deduped.length;
  deduped = deduped.filter((r) => !(r.family === "WS" && r.subProduct === "PROTECT"));
  console.log(`WS plain-PROTECT drop: removed ${beforeProtectDrop - deduped.length} menu row(s)`);

  // ── 7.8. Base-alias search words (any product in BASE_ALIASES) ──────
  // Bake the friendly base-alias words from lib/place-order/base-aliases.ts
  // into searchTokens so "accent"/"deep"/"rox"/"vibrant red" etc. find the
  // row on BOTH mobile (haystack already includes searchTokens) and desktop
  // (queries.ts now includes searchTokens). DISPLAY-ONLY fields (baseColour,
  // displayName) and the order email are untouched. Applies to every row
  // whose `product` has a BASE_ALIASES block (WS MAX + WS PROTECT DUSTPROOF /
  // RAINPROOF / POWERFLEXX); bases with no mapped alias (93, Brilliant White,
  // colours) are skipped.
  let aliasTokenRows = 0;
  for (const r of deduped) {
    if (!r.product || !r.baseColour) continue;
    const alias = BASE_ALIASES[r.product]?.[r.baseColour];
    if (!alias || alias.search.length === 0) continue;
    const before = r.searchTokens;
    r.searchTokens = mergeSearchTokens(r.searchTokens, alias.search.join(", "));
    if (r.searchTokens !== before) {
      aliasTokenRows++;
      if (DRY_RUN) console.log(`  [alias] ${r.product} ${r.baseColour}: "${before}" -> "${r.searchTokens}"`);
    }
  }
  console.log(`Base-alias search words appended: ${aliasTokenRows} row(s)`);

  // ── 7.85. WS search-token tweaks (2026-06-01) ───────────────────────
  // (a) Dustproof gains a WEAK "RAINPROOF" sibling token so a "rainproof"
  //     query also surfaces Dustproof. The scorers' sub-product-name prefix
  //     boost keeps Rainproof (subProduct RAINPROOF) ranked above Dustproof
  //     (token-only match), so order stays Rainproof-first → Dustproof.
  //     Rainproof KEEPS its "PROTECT RAINPROOF" token — "protect" ranking
  //     (Dustproof → Rainproof → Damp) falls out of scoring, no surgery.
  // (HISHEEN protect-strip removed 2026-06-02: Hi-Sheen is now a WS Protect
  //  sibling — its "PROTECT HI-SHEEN" / "WS PROTECT HI-SHEEN" tokens are
  //  legitimate, and by this point the rows are family=WS anyway.)
  let dustproofSiblingTokens = 0;
  for (const r of deduped) {
    if (r.family === "WS" && r.subProduct === "DUSTPROOF") {
      const before = r.searchTokens;
      r.searchTokens = mergeSearchTokens(r.searchTokens, "RAINPROOF");
      if (r.searchTokens !== before) dustproofSiblingTokens++;
    }
  }
  console.log(`WS token tweaks: Dustproof +RAINPROOF=${dustproofSiblingTokens}`);

  // ── 8. DRY-RUN exit — print summary instead of touching the DB ──────
  if (DRY_RUN) {
    console.log("");
    console.log("════════════════ DRY-RUN SUMMARY ════════════════");
    console.log(`Rows in (JSON)                       : ${flat.length}`);
    console.log(`Rows after umbrella collapse         : ${collapsed.length}`);
    console.log(`Rows after final dedup               : ${rowsAfterIntraDedup}`);
    console.log(`Rows after Promise mobile de-dupe    : ${deduped.length}`);

    // Count per mobileFamily
    const byMobile = new Map<string, number>();
    for (const r of deduped) byMobile.set(r.mobileFamily, (byMobile.get(r.mobileFamily) ?? 0) + 1);
    console.log("");
    console.log(`── Count per mobileFamily (${byMobile.size} mobile families) ──`);
    for (const [k, v] of Array.from(byMobile.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${k.padEnd(24)} ${v}`);
    }

    // Count per desktop family
    const byDesktop = new Map<string, number>();
    for (const r of deduped) byDesktop.set(r.family, (byDesktop.get(r.family) ?? 0) + 1);
    console.log("");
    console.log(`── Count per desktop family (${byDesktop.size} desktop families) ──`);
    for (const [k, v] of Array.from(byDesktop.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${k.padEnd(24)} ${v}`);
    }

    // Phantom reassignments
    console.log("");
    console.log(`── Phantom Promise reassignments (${phantomReassignments.length}) ──`);
    for (const p of phantomReassignments) {
      console.log(`  PROMISE → ${p.assignedTo.padEnd(18)} ` +
                  `subProduct=${p.subProduct} baseColour=${p.baseColour ?? "null"}`);
    }
    console.log("");
    console.log(`── UNHANDLED phantoms (still family=PROMISE) (${unhandledPhantoms.length}) ──`);
    for (const u of unhandledPhantoms) {
      console.log(`  subProduct=${u.subProduct} baseColour=${u.baseColour ?? "null"} ` +
                  `mobileFamily=${u.mobileFamily}`);
    }

    // Final-set collision check (must be 0)
    const collisionSeen = new Map<string, number>();
    for (const r of deduped) {
      const key = `${r.family}|||${r.subProduct}|||${r.baseColour ?? ""}`;
      collisionSeen.set(key, (collisionSeen.get(key) ?? 0) + 1);
    }
    const collisions = Array.from(collisionSeen.entries()).filter(([, c]) => c > 1);
    console.log("");
    console.log(`── Final-set (family,subProduct,baseColour) collisions: ${collisions.length} ──`);
    for (const [k, c] of collisions) console.log(`  ${k} x${c}`);

    // Promise mobile de-dupe collapses (new pass)
    console.log("");
    console.log(`── Promise mobile de-dupe collapses (${promiseMobileCollapses.length}) ──`);
    for (const c of promiseMobileCollapses) {
      console.log(`  subProduct=${c.subProduct} baseColour=${c.baseColour ?? "null"} ` +
                  `kept=${c.keptFamily} dropped=[${c.droppedFamilies.join(", ")}]`);
    }

    // SmartChoice primer merges (Step 3.5)
    console.log("");
    console.log(`── SmartChoice primer merges (${smartchoicePrimerMerges.length}) ──`);
    for (const m of smartchoicePrimerMerges) {
      console.log(`  ${m.oldName}  ->  ${m.keptName}`);
    }

    // Within-PROMISE duplicate re-assertion (must be 0)
    const withinPromiseSeen = new Map<string, number>();
    for (const r of deduped) {
      if (r.mobileFamily !== PROMISE_UMBRELLA) continue;
      const key = `${r.subProduct}|${r.baseColour ?? ""}`;
      withinPromiseSeen.set(key, (withinPromiseSeen.get(key) ?? 0) + 1);
    }
    const withinPromiseDups = Array.from(withinPromiseSeen.entries()).filter(([, c]) => c > 1);
    console.log("");
    console.log(`── (subProduct, baseColour) duplicates WITHIN mobileFamily=PROMISE: ${withinPromiseDups.length} ──`);
    for (const [k, c] of withinPromiseDups) console.log(`  ${k} x${c}`);

    // Desktop home for SmartChoice / primer / distemper — distinct
    // (subProduct, desktopFamily, mobileFamily) combinations.
    const smartcheckSeen = new Set<string>();
    type SmartcheckEntry = { subProduct: string; family: string; mobileFamily: string };
    const smartcheckRows: SmartcheckEntry[] = [];
    for (const r of deduped) {
      const sp = r.subProduct.toUpperCase();
      if (!sp.includes("SMARTCHOICE") && !sp.includes("PRIMER") && !sp.includes("DISTEMPER")) continue;
      const key = `${r.subProduct}|${r.family}|${r.mobileFamily}`;
      if (smartcheckSeen.has(key)) continue;
      smartcheckSeen.add(key);
      smartcheckRows.push({ subProduct: r.subProduct, family: r.family, mobileFamily: r.mobileFamily });
    }
    smartcheckRows.sort((a, b) =>
      a.family.localeCompare(b.family) || a.subProduct.localeCompare(b.subProduct));
    console.log("");
    console.log(`── Desktop home for SmartChoice / primer / distemper (${smartcheckRows.length}) ──`);
    for (const r of smartcheckRows) {
      console.log(`  ${r.subProduct}  |  desktopFamily=${r.family}  |  mobileFamily=${r.mobileFamily}`);
    }

    // 5 sample collapsed Promise products
    console.log("");
    console.log(`── 5 sample collapsed Promise products (post-merge searchTokens) ──`);
    for (const s of mergedSpecifics.slice(0, 5)) {
      console.log(`  family=${s.family} mobileFamily=${s.mobileFamily} ` +
                  `subProduct=${s.subProduct} baseColour=${s.baseColour ?? "null"}`);
      console.log(`    searchTokens: ${s.searchTokens}`);
    }

    // ── 8b. Name-map verification (read-only) ─────────────────────────
    // Replicate the app/api/order/data pack join over the final (deduped)
    // set with `product` filled, and report A–E. Reads mo_sku_lookup_v2
    // (isPrimary) — no writes. "before" = product NULL (current live
    // behaviour, join falls back to subProduct); "after" = product filled.
    const skuV2 = await prisma.mo_sku_lookup_v2.findMany({
      where:  { isPrimary: true },
      select: { product: true, baseColour: true, packCode: true, unit: true },
    });
    const vPackMap = new Map<string, number>();
    const vSeen    = new Set<string>();
    const vAdd = (key: string, packCode: string, unit: string | null): void => {
      const d = `${key}|||${packCode}|${unit ?? ""}`;
      if (vSeen.has(d)) return;
      vSeen.add(d);
      vPackMap.set(key, (vPackMap.get(key) ?? 0) + 1);
    };
    for (const s of skuV2) {
      if (!s.product || !s.packCode) continue;
      vAdd(s.product, String(s.packCode), s.unit ?? null);
      if (s.baseColour) vAdd(`${s.product}|||${s.baseColour}`, String(s.packCode), s.unit ?? null);
    }
    const afterKey  = (r: TransformedRow): string => {
      const j = r.product ?? r.subProduct;
      return r.baseColour ? `${j}|||${r.baseColour}` : j;
    };
    const beforeKey = (r: TransformedRow): string =>
      r.baseColour ? `${r.subProduct}|||${r.baseColour}` : r.subProduct;
    const afterPacks  = (r: TransformedRow): number => vPackMap.get(afterKey(r))  ?? 0;
    const beforePacks = (r: TransformedRow): number => vPackMap.get(beforeKey(r)) ?? 0;

    const productSet  = deduped.filter((r) => r.product != null).length;
    const zeroAfter   = deduped.filter((r) => afterPacks(r) === 0);
    const regressions = deduped.filter((r) => beforePacks(r) >= 1 && afterPacks(r) === 0);

    console.log("");
    console.log("════════════ NAME-MAP VERIFICATION (A–E) ════════════");
    console.log(`A. Total rows produced            : ${deduped.length}`);
    console.log(`B. Rows with product set          : ${productSet}`);
    console.log(`C. Rows hydrating to ZERO packs   : ${zeroAfter.length}`);
    for (const r of zeroAfter) {
      console.log(`     ${r.family} | ${r.subProduct} | ${r.baseColour ?? "null"}`);
    }
    const spot = (sp: string, base: string | null): void => {
      const row = deduped.find((r) => r.subProduct === sp && (r.baseColour ?? null) === base);
      console.log(`     ${sp} | ${base ?? "null"} -> product=${row?.product ?? "(none)"} ` +
                  `packs=${row ? afterPacks(row) : "ROW NOT FOUND"}`);
    };
    console.log(`D. Spot-checks (expect packs > 0):`);
    spot("MACHINE TINTER", "OXR");
    spot("PU STAINER", "YELLOW OXIDE");
    spot("PROTECT", "BRILLIANT WHITE");
    console.log(`E. Regressions (had packs before, zero after): ${regressions.length}`);
    for (const r of regressions) {
      console.log(`     REGRESSION ${r.family} | ${r.subProduct} | ${r.baseColour ?? "null"}`);
    }

    // ── 8b-aqua. AQUATECH rebuild verification (2026-06-04, dry-run only) ──
    // Uses vPackMap (built from live mo_sku_lookup_v2 isPrimary) above. Every
    // rebuilt AQUATECH row carries the exact stock product name as subProduct
    // (product stays null), so afterKey() = subProduct and must hydrate.
    const aqua = deduped
      .filter((r) => r.family === "AQUATECH")
      .sort((a, b) => a.sortOrder - b.sortOrder);
    console.log("");
    console.log(`════════════ AQUATECH REBUILD (${aqua.length} rows) ════════════`);
    for (const r of aqua) {
      console.log(`  sort=${r.sortOrder} tab="${r.uiGroup ?? "(none)"}" ` +
                  `sub="${r.subProduct}" join="${r.product ?? r.subProduct}" packs=${afterPacks(r)}`);
    }
    const aquaTabs = Array.from(new Set(aqua.map((r) => r.uiGroup ?? "(none)")));
    console.log(`  tabs in sortOrder sequence : ${JSON.stringify(aquaTabs)}`);
    console.log(`  rows hydrating 0 packs     : ${aqua.filter((r) => afterPacks(r) === 0).length}`);
    console.log(`  rows resolving to ETERNA   : ${aqua.filter((r) => (r.product ?? r.subProduct) === "ETERNA").length}`);

    // ── 8b-sadolin. SADOLIN menu verification (2026-06-04, dry-run only) ──
    // Live stock is NOT reseeded for SADOLIN yet, so hydration is cross-checked
    // against the sadolin CSV (= step-1 stock source of truth), NOT vPackMap.
    const sadCsvRaw = await fs.readFile(
      path.join("docs", "SKU", "review", "sadolin-review-final-20260604.csv"), "utf8");
    const splitSad = (line: string): string[] => {
      const out: string[] = []; let cur = ""; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
        else if (ch === '"') inQ = true;
        else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
      }
      out.push(cur); return out;
    };
    const sadStockPairs = new Set<string>();   // product|||base from CSV (step-1 stock)
    for (const line of sadCsvRaw.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const c = splitSad(line);
      sadStockPairs.add(`${c[5].trim()}|||${c[6].trim()}`);
    }
    const sadRows = deduped.filter((r) => r.family === "SADOLIN").sort((a, b) => a.sortOrder - b.sortOrder);
    console.log("");
    console.log(`════════════ SADOLIN MENU (${sadRows.length} rows) ════════════`);
    const sadTabSeq = Array.from(new Set(sadRows.map((r) => r.uiGroup ?? "(none)")));
    console.log(`  tabs in sortOrder sequence : ${JSON.stringify(sadTabSeq)}`);
    const perTab = new Map<string, number>();
    for (const r of sadRows) perTab.set(r.uiGroup ?? "(none)", (perTab.get(r.uiGroup ?? "(none)") ?? 0) + 1);
    console.log(`  per-tab counts             : ${JSON.stringify(Array.from(perTab.entries()))}`);
    // hydration vs CSV stock (join key = product ?? subProduct, base = baseColour)
    const noStock = sadRows.filter((r) => !sadStockPairs.has(`${r.product ?? r.subProduct}|||${r.baseColour ?? ""}`));
    console.log(`  rows with NO matching CSV stock (product,base): ${noStock.length}`);
    for (const r of noStock) console.log(`     MISS sub="${r.subProduct}" base="${r.baseColour ?? ""}"`);
    const BARE = new Set(["GLOSS", "MATT", "SEALER", "BASE", "COLOUR"]);
    console.log(`  rows on a bare GLOSS/MATT/SEALER/BASE/COLOUR join: ${sadRows.filter((r) => BARE.has(r.product ?? r.subProduct)).length}`);
    console.log(`  rows with product set non-null (expect 0; join via subProduct): ${sadRows.filter((r) => r.product != null).length}`);
    // brand order within first tab (Gloss)
    const gloss = sadRows.filter((r) => r.uiGroup === "Gloss");
    console.log(`  Gloss tab join keys in order: ${JSON.stringify(gloss.map((r) => r.subProduct))}`);
    // old 7-brand families gone
    const OLD = ["LUXURIO", "2K PU", "PU PRIME", "NC", "MELAMINE", "WOOD STAIN", "WOOD FILLER"];
    const oldLeft = deduped.filter((r) => OLD.includes(r.family));
    console.log(`  old 7-brand menu rows remaining: ${oldLeft.length} (expect 0)`);

    // ── 8c. GROUPING verification (approved map, A–E) ─────────────────
    console.log("");
    console.log("════════════ GROUPING VERIFICATION (A–E) ════════════");

    // A. total + non-null duplicate keys (Postgres treats NULL baseColour
    //    as DISTINCT in the unique index, so NULL-base rows can repeat).
    const dupSeen = new Map<string, number>();
    let nullBaseRows = 0;
    for (const r of deduped) {
      if (r.baseColour == null || r.baseColour === "") { nullBaseRows++; continue; }
      const k = `${r.family}|||${r.subProduct}|||${r.baseColour}`;
      dupSeen.set(k, (dupSeen.get(k) ?? 0) + 1);
    }
    const dups = Array.from(dupSeen.entries()).filter(([, c]) => c > 1);
    console.log(`A. Total rows: ${deduped.length}  |  non-null (family,subProduct,baseColour) duplicates: ${dups.length}` +
                `  |  NULL-baseColour rows (allowed-distinct): ${nullBaseRows}`);
    for (const [k, c] of dups) console.log(`     CLASH ${k} x${c}`);

    // B. per-family grouping
    const grp = (fam: string, by: "uiGroup" | "subProduct"): string => {
      const m = new Map<string, number>();
      for (const r of deduped) if (r.family === fam) {
        const key = by === "uiGroup" ? (r.uiGroup ?? "∅") : r.subProduct;
        m.set(key, (m.get(key) ?? 0) + 1);
      }
      return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}(${v})`).join(", ");
    };
    console.log("B. Per-family grouping:");
    console.log(`   WS         [${deduped.filter((r) => r.family === "WS").length}] subProducts: ${grp("WS", "subProduct")}`);
    console.log(`   GLOSS      uiGroups: ${grp("GLOSS", "uiGroup")}`);
    console.log(`   AQUATECH   uiGroups: ${grp("AQUATECH", "uiGroup")}`);
    console.log(`   PRIMER     uiGroups: ${grp("PRIMER", "uiGroup")}`);
    console.log(`   STAINER    uiGroups: ${grp("STAINER", "uiGroup")}`);
    console.log(`   SATIN      uiGroups: ${grp("SATIN", "uiGroup")}`);
    console.log(`   FLOOR PLUS [${deduped.filter((r) => r.family === "FLOOR PLUS").length}] (family)`);

    // C. pack regression — pre-grouping vs post-grouping join key.
    const keyOf = (product: string | null, sub: string, base: string | null): string => {
      const j = product ?? sub;
      return base ? `${j}|||${base}` : j;
    };
    let lost = 0; const lostList: string[] = [];
    for (const r of deduped) {
      const before = vPackMap.get(preGroupKey.get(r)!) ?? 0;
      const after  = vPackMap.get(keyOf(r.product, r.subProduct, r.baseColour)) ?? 0;
      if (before >= 1 && after === 0) { lost++; lostList.push(`${r.family} | ${r.subProduct} | ${r.baseColour ?? "null"} (had ${before})`); }
    }
    console.log(`C. Pack regression (had packs before grouping, 0 after): ${lost}`);
    for (const x of lostList) console.log(`     LOST ${x}`);
    console.log(`   ROOF COAT rows:`);
    for (const r of deduped.filter((r) => (r.product ?? "").startsWith("ROOF COAT"))) {
      console.log(`     product=${r.product} base=${r.baseColour ?? "null"} ui=${r.uiGroup} packs=${vPackMap.get(keyOf(r.product, r.subProduct, r.baseColour)) ?? 0}`);
    }
    console.log(`   WS sample (MAX/DUSTPROOF + rescued):`);
    for (const r of deduped.filter((r) => r.family === "WS" && (["ROX", "YELLOW BASE"].includes(r.baseColour ?? "") || (r.subProduct === "DUSTPROOF")))) {
      console.log(`     sub=${r.subProduct} base=${r.baseColour ?? "null"} prod=${r.product ?? "∅"} ui=${r.uiGroup} packs=${vPackMap.get(keyOf(r.product, r.subProduct, r.baseColour)) ?? 0}`);
    }

    // D. preserved fields
    const prodSet = deduped.filter((r) => r.product != null).length;
    console.log(`D. product set on ${prodSet} rows (≥92 expected).`);
    console.log(`   DISTEMPER / ACRYLIC DISTEMPER searchTokens (must NOT contain SMARTCHOICE):`);
    for (const r of deduped.filter((r) => r.family === "DISTEMPER" && r.subProduct === "ACRYLIC DISTEMPER")) {
      console.log(`     base=${r.baseColour ?? "null"} hasSMARTCHOICE=${/smartchoice/i.test(r.searchTokens)} | "${r.searchTokens}"`);
    }

    // E. the 4 decisions
    const find = (pred: (r: TransformedRow) => boolean): TransformedRow | undefined => deduped.find(pred);
    const dpb  = find((r) => r.family === "AQUATECH" && r.subProduct.toUpperCase() === "DAMP PROTECT BASECOAT");
    const iwbc = find((r) => r.subProduct.toUpperCase() === "INTERIOR WBC");
    const p2   = find((r) => r.subProduct.toUpperCase() === "2IN1 INTERIOR-EXTERIOR PRIMER");
    const hp   = deduped.filter((r) => r.subProduct.toUpperCase() === "HP COLORANT");
    console.log("E. Decisions:");
    console.log(`   Damp Protect Basecoat → uiGroup=${dpb?.uiGroup ?? "(missing)"} (expect BASECOAT)`);
    console.log(`   Interior WBC          → uiGroup=${iwbc?.uiGroup ?? "(missing)"} (expect BASECOAT)`);
    console.log(`   2in1 Int-Ext Primer   → uiGroup=${p2?.uiGroup ?? "(missing)"} (expect PROMISE)`);
    console.log(`   HP Colorant           → ${hp.length} row(s) (expect 0 — menu row removed 2026-06-08; stock kept but isPrimary=false)`);

    console.log("");
    console.log("DRY_RUN exit — no DB ops performed.");
    /* eslint-enable no-console */
    return;
  }

  // ── 9. Wipe v2 table ────────────────────────────────────────────────
  // Idempotent: deleteMany on empty table is a no-op.
  const wipeResult = await prisma.mo_order_form_index_v2.deleteMany({});
  console.log(`Rows wiped from v2  : ${wipeResult.count}`);

  // ── 10. Insert in batches of 100 via createMany ─────────────────────
  // Sequential awaits per CLAUDE_CORE §3 — no prisma.$transaction array.
  // Strip preview-only `skuCount` via whitelist destructure before insert.
  let inserted = 0;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const slice = deduped.slice(i, i + BATCH_SIZE);
    const data  = slice.map((r) => ({
      family:       r.family,
      subProduct:   r.subProduct,
      product:      r.product ?? null,
      uiGroup:      r.uiGroup ?? null,
      baseColour:   r.baseColour,
      displayName:  r.displayName,
      searchTokens: r.searchTokens,
      tinterType:   r.tinterType,
      productType:  r.productType,
      sortOrder:    r.sortOrder,
      isActive:     r.isActive,
      section:      FAMILY_TO_SECTION[r.family]!,
      subgroup:     FAMILY_TO_SUBGROUP[r.family]!,
      mobileFamily: r.mobileFamily,
      region:       r.region ?? null,
    }));
    const result = await prisma.mo_order_form_index_v2.createMany({
      data,
      skipDuplicates: false,
    });
    inserted += result.count;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1} inserted ${result.count} rows ` +
                `(running total: ${inserted})`);
  }

  // ── 11. Verify + family breakdown ───────────────────────────────────
  const finalCount = await prisma.mo_order_form_index_v2.count();
  const matches    = finalCount === inserted;

  const byFamily = await prisma.mo_order_form_index_v2.groupBy({
    by: ["family"],
    _count: { _all: true },
    orderBy: { family: "asc" },
  });

  console.log("─── v2 catalog seed result ───");
  console.log(`Source preview file : ${PREVIEW_PATH}`);
  console.log(`Rows read from JSON : ${flat.length}`);
  console.log(`Dedups removed      : ${dropped}`);
  console.log(`Rows inserted       : ${inserted}`);
  console.log(`Verification count  : ${finalCount} (matches inserted: ${matches ? "✓" : "✗"})`);
  console.log(`Families produced   : ${byFamily.length}`);
  console.log("─── Family → row count breakdown ───");
  for (const f of byFamily) {
    console.log(`  ${f.family.padEnd(24)} ${f._count._all}`);
  }

  if (!matches) {
    throw new Error(
      `Verification failed: count() returned ${finalCount} but ${inserted} rows were inserted.`,
    );
  }

  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("✗ v2 seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
