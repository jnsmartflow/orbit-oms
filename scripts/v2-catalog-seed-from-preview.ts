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
const EXPECTED_TOTAL_NEW_ROWS    = 521;  // 518 + 3 Dustproof base-gap rows (90 BASE + 96 BASE + BRILLIANT WHITE) added 2026-06-01
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
  "VT GLO":           "INTERIORS",
  "VT ETERNA":        "INTERIORS",
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
  "SATIN":            "ENAMELS",
  "LUSTRE":           "ENAMELS",
  "PROMISE ENAMEL":   "ENAMELS",
  // WOODCARE
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
  // MULTI-USE
  "PROMISE":          "MULTI-USE",
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
  // INTERIORS
  "PROMISE INTERIOR": "Promise (use-case interior)",
  "VT GLO":           "VT (Dulux Velvet Touch)",
  "VT ETERNA":        "VT (Dulux Velvet Touch)",
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
  // ENAMELS
  "GLOSS":            "Enamel finish (gloss)",
  "SATIN":            "Enamel finish (satin)",
  "PROMISE ENAMEL":   "Promise (use-case enamel)",
  "LUSTRE":           "Enamel finish (lustre)",
  // WOODCARE
  "LUXURIO":          "Sadolin Premium PU",
  "2K PU":            "Sadolin Premium PU",
  "PU PRIME":         "Sadolin Premium PU",
  "NC":               "Sadolin Standard Woodcare",
  "MELAMINE":         "Sadolin Standard Woodcare",
  "WOOD FILLER":      "Wood finishing",
  "WOOD STAIN":       "Wood finishing",
  // MULTI-USE
  "PROMISE":          "Promise umbrella",
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
  "PU STAINER":        "GVA",
  "MACHINE TINTER":    "MACHINE STAINER",
};

// Rule 2: HIGH-confidence rows from the reviewed name-map draft
// (docs/prompts/drafts/v2-name-map-broken-2026-05-31.csv, 2026-05-31),
// inlined here so the seed carries no runtime file dependency. Keyed by
// natural key `${family}|||${subProduct}|||${baseColour ?? ""}`. All 17
// HIGH rows had baseColourChanged=N, so only `product` is set; the
// optional `baseColour` field is kept for future entries that repair a
// base spelling.
const HIGH_PRODUCT_MAP: Record<string, { product: string; baseColour?: string }> = {
  "2K PU|||GLOSS|||93 BASE CLR":                 { product: "BASE" },
  "AQUATECH|||PU COAT|||":                       { product: "AQUATECH PU COAT" },
  "AQUATECH|||DAMP PROTECT BASECOAT|||BASECOAT": { product: "ETERNA" },
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

  const WS_CONSOLIDATE = new Set<string>(["MAX", "POWERFLEXX", "PROTECT", "RAINPROOF"]);
  // Desktop tab label per WS sub-product (uiGroup ?? subProduct drives the tab).
  // Plain "PROTECT" is intentionally absent — those rows are dropped in 7.75.
  const WS_TAB_LABEL: Record<string, string> = {
    "MAX":        "Max",
    "POWERFLEXX": "Powerflexx",
    "DUSTPROOF":  "Protect Dustproof",
    "RAINPROOF":  "Protect Rainproof",
  };
  const SATIN_UI: Record<string, string> = {
    "SATIN STAY BRIGHT": "SATIN STAY BRIGHT (WB)",
    "SUPER SATIN":       "SUPER SATIN (Oil)",
  };
  const STAINER_UI: Record<string, string> = {
    "UNIVERSAL STAINER": "UNIVERSAL STAINER",
    "MACHINE TINTER":    "MACHINE STAINER",
    "ACOTONE TINTER":    "ACOTONE",
    "PU STAINER":        "GVA / PU",
    "HP COLORANT":       "HP",
  };
  const PRIMER_UI: Record<string, string> = {
    "WOOD PRIMER":               "WOOD",
    "RED OXIDE METAL PRIMER":    "METAL",
    "ZINC YELLOW METAL PRIMER":  "METAL",
    "EPOXY PRIMER":              "METAL",
    "QUICK DRYING PRIMER":       "METAL",
    "CEMENT PRIMER WB":          "CEMENT",
    "CEMENT PRIMER SB":          "CEMENT",
    "INTERIOR ACRYLIC PRIMER":   "ACRYLIC",
    "EXTERIOR ACRYLIC PRIMER":   "ACRYLIC",
    "ALKALI BLOC PRIMER":        "ALKALI BLOC",
    "2IN1 INTERIOR-EXTERIOR PRIMER": "PROMISE",  // approved decision
    "PROMISE PRIMER":            "PROMISE",
  };
  const AQUA_UI: Record<string, string> = {
    "CRACKFILLER":           "PREP",
    "PRETREATMENT COAT":     "PREP",
    "WRP":                   "ADDITIVES",
    "TG COTTON WOOL":        "ADDITIVES",
    "LW PLUS":               "ADDITIVES",
    "RP LATEX":              "ADDITIVES",
    "FLEXIBLE COAT":         "BASECOAT",
    "IBC ADVANCE":           "BASECOAT",
    "INTERIOR WBC":          "BASECOAT",  // approved decision
    "DAMP PROTECT BASECOAT": "BASECOAT",  // approved decision (backup had TOPCOAT)
    "PU COAT":               "TOPCOAT",
    "WATERBLOCK 2K":         "TOPCOAT",
    "DAMP PROTECT 2IN1":     "TOPCOAT",
  };
  const glossBase = (base: string | null): boolean => {
    const b = (base ?? "").trim().toUpperCase();
    return b === "BRILLIANT WHITE" || /\bBASE$/.test(b);
  };
  // Restructured rows — match the backup EXACTLY. Keyed by PRE-grouping
  // `${family}|${subProduct}|${baseColour ?? ""}`.
  const RESTRUCTURED: Record<string, { family: string; subProduct: string; baseColour: string | null; product: string; uiGroup: string }> = {
    "AQUATECH|ROOF COAT|BRILLIANT WHITE": { family: "AQUATECH", subProduct: "TOPCOAT", baseColour: null, product: "ROOF COAT WHITE",     uiGroup: "TOPCOAT" },
    "AQUATECH|ROOF COAT|GREY":            { family: "AQUATECH", subProduct: "TOPCOAT", baseColour: null, product: "ROOF COAT GREY",      uiGroup: "TOPCOAT" },
    "AQUATECH|ROOF COAT|TERACOTTA":       { family: "AQUATECH", subProduct: "TOPCOAT", baseColour: null, product: "ROOF COAT TERACOTTA", uiGroup: "TOPCOAT" },
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
    if (r.family === "GLOSS")    { r.uiGroup = glossBase(r.baseColour) ? "BASE" : "COLOUR"; uiAssigned++; continue; }
    if (r.family === "SATIN"   && SATIN_UI[sub])   { r.uiGroup = SATIN_UI[sub];   uiAssigned++; continue; }
    if (r.family === "STAINER" && STAINER_UI[sub]) { r.uiGroup = STAINER_UI[sub]; uiAssigned++; continue; }
    if (r.family === "PRIMER"  && PRIMER_UI[sub])  { r.uiGroup = PRIMER_UI[sub];  uiAssigned++; continue; }
    if (r.family === "AQUATECH" && AQUA_UI[sub])   { r.uiGroup = AQUA_UI[sub];    uiAssigned++; continue; }
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
    console.log(`   HP Colorant           → ${hp.length} row(s), uiGroup=${hp[0]?.uiGroup ?? "(missing)"} (expect 1 row, HP — not split)`);

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
