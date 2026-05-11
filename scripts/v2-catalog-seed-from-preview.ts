// v2 catalog seed — wipes mo_order_form_index_v2 and reinserts every row
// from docs/prompts/drafts/taxonomy-preview.json (512 rows, 0 warnings,
// 34 families produced by the May 6 33-family taxonomy translator).
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
// Run with: npx tsx scripts/v2-catalog-seed-from-preview.ts
//
// Idempotent on re-run: deleteMany({}) on an empty table is a no-op,
// and createMany on a wiped table re-inserts cleanly.

import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// DATABASE_URL (transaction pooler, port 6543) — depot network blocks direct port 5432 connections per CLAUDE_CORE.md §3.
const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in environment.");
}
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: ["error"],
});

const PREVIEW_PATH = path.join("docs", "prompts", "drafts", "taxonomy-preview.json");
const BATCH_SIZE   = 100;

// Locked expectations from the May 6 preview run. If the JSON drifts from
// these the script refuses to seed — better to fail loudly than to ship
// surprise data into v2.
const EXPECTED_TOTAL_NEW_ROWS    = 512;
const EXPECTED_WARNINGS          = 0;

// Family → section mapping for /place-order grid grouping (6 sections).
// Locked decisions in the section-grouping prompt: 33 functional families +
// PROMISE umbrella mapped to INTERIORS / EXTERIORS / ENAMELS / WOODCARE /
// UTILITY / MULTI-USE. No fallback — any new family must be added here
// before seeding will succeed (validated in step 4.5 of main()).
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
// be added here before seeding will succeed (validated in step 4.5).
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

  // ── 4.5. Validate every distinct family has FAMILY_TO_SECTION + FAMILY_TO_SUBGROUP ─
  // Combined coverage check across BOTH maps. No fallback — schema drift
  // must fail loudly, not silently insert NULL into either column. Reports
  // missing entries in both maps if either or both have gaps.
  const distinctFamilies = Array.from(new Set(flat.map((r) => r.family))).sort();
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

  // ── 5. Sort by sortOrder ASC so dedup keeps the lowest-order winner ─
  // For convergent rows (e.g. WS/MAX + WEATHERCOAT/MAX both producing
  // MAX|MAX|<base>), the byte-identical output property means it doesn't
  // matter which one wins — but sorting first makes the choice
  // deterministic and the dedup log meaningful.
  flat.sort((a, b) => a.sortOrder - b.sortOrder);

  // ── 6. Dedup on (family, subProduct, baseColour ?? '') ──────────────
  // Same convergence pattern as scripts/phase1-seed-mo-order-form-index.ts
  // §B.2.5. Expected ~57 dedups based on May 6 Phase 1 deploy run.
  const seen    = new Set<string>();
  const deduped: PreviewRow[] = [];
  let   dropped = 0;
  for (const r of flat) {
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

  // ── 7. Wipe v2 table ────────────────────────────────────────────────
  // Idempotent: deleteMany on empty table is a no-op.
  const wipeResult = await prisma.mo_order_form_index_v2.deleteMany({});
  console.log(`Rows wiped from v2  : ${wipeResult.count}`);

  // ── 8. Insert in batches of 100 via createMany ──────────────────────
  // Sequential awaits per CLAUDE_CORE §3 — no prisma.$transaction array.
  // Strip preview-only `skuCount` via whitelist destructure before insert.
  let inserted = 0;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const slice = deduped.slice(i, i + BATCH_SIZE);
    const data  = slice.map((r) => ({
      family:       r.family,
      subProduct:   r.subProduct,
      baseColour:   r.baseColour,
      displayName:  r.displayName,
      searchTokens: r.searchTokens,
      tinterType:   r.tinterType,
      productType:  r.productType,
      sortOrder:    r.sortOrder,
      isActive:     r.isActive,
      section:      FAMILY_TO_SECTION[r.family]!,
      subgroup:     FAMILY_TO_SUBGROUP[r.family]!,
    }));
    const result = await prisma.mo_order_form_index_v2.createMany({
      data,
      skipDuplicates: false,
    });
    inserted += result.count;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1} inserted ${result.count} rows ` +
                `(running total: ${inserted})`);
  }

  // ── 9. Verify + family breakdown ────────────────────────────────────
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
