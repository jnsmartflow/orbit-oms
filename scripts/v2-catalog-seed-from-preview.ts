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
const EXPECTED_TOTAL_NEW_ROWS    = 512;
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
type TransformedRow = PreviewRow & { mobileFamily: string };

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
