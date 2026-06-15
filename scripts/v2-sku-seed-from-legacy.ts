// v2 SKU lookup seed — wipes mo_sku_lookup_v2 and inserts a translated copy
// of every legacy mo_sku_lookup row by driving each legacy
// (category, product, baseColour) tuple through
// lib/mail-orders/taxonomy-mapping.ts mapLegacyToNew().
//
// Per locked decisions in this prompt:
//   - First v2 row from each legacy row keeps the original `material` value.
//   - 2nd/3rd v2 rows (cross-listed Promise primers, etc.) get a synthetic
//     suffix: `${material}-${family.replace(/\s+/g, '_')}`.
//   - Hidden families (AUTO/DUCO/M900/SPRAY PAINT/5IN1/TOOLS) and 4 single-
//     row orphans skip when mapLegacyToNew returns null.
//   - newRow.baseColour ?? legacy.baseColour — fall back to legacy when v2
//     translator returns null (PLAIN sub-products with no colour variant).
//   - product = newRow.subProduct, category = newRow.family.
//   - Other columns unchanged from legacy (description, packCode, unit, …).
//
// Per CLAUDE_CORE.md §3:
//   - sequential awaits, no prisma.$transaction([...])
//   - no prisma db push / no prisma migrate (table created via Supabase
//     SQL Editor with scripts/v2-sku-create-table.sql)
//
// Run with: npx tsx scripts/v2-sku-seed-from-legacy.ts
//
// Idempotent on re-run: deleteMany({}) on empty table is a no-op.

import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { mapLegacyToNew, type LegacyKey } from "@/lib/mail-orders/taxonomy-mapping";
import { formatPack, packToMl } from "@/lib/place-order/pack";
import nameOverridesJson from "./data/sku-name-overrides.json";

// DATABASE_URL (transaction pooler, port 6543) — depot network blocks direct port 5432 connections per CLAUDE_CORE.md §3.
const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in environment.");
}
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
  log: ["error"],
});

const BATCH_SIZE = 100;
// Mirror v2-catalog-seed-from-preview.ts: DRY_RUN=1 computes everything and
// prints a projected summary, then returns BEFORE the unconditional wipe —
// no deletes, no inserts.
const DRY_RUN    = process.env.DRY_RUN === "1";

// ── WS Max durable cleanup (2026-06-01) ─────────────────────────────────
// mo_sku_lookup_v2 regenerates from legacy on every reseed, so these
// removals + the isPrimary flags MUST live here (CORE durable-source rule),
// not as DB-only edits. Match on the TRANSLATED v2 baseColour so it aligns
// with the menu's base names.
// Post-override base set (see NAME_OVERRIDES). The 4 removed WS Max bases as
// they appear in the LIVE names; "YELLOW BASE" is intentionally absent — its
// single legacy row is corrected to "YELLOW OXIDE" by the override, so the
// YELLOW OXIDE entry covers it.
const EXCLUDE_BASE_WSMAX = new Set<string>([
  "PASTEL BASE", "YELLOW OXIDE", "ROX", "RED OXIDE",
]);
const EXCLUDE_MATERIALS = new Set<string>(["IN46350082"]);

// ── Per-material name override (May-13 renames, baked durable 2026-06-01) ─
// mapLegacyToNew emits the flat pre-May-13 names (e.g. MAX, PROTECT, GLOSS);
// the live catalogue's correct names (WS MAX, GVA, ROOF COAT WHITE, …) were
// set by manual SQL never put in the seed. This snapshot (411 materials,
// keyed on the stable SAP `material`) reproduces the live names EXACTLY on
// every reseed, so a wipe-and-reseed no longer breaks the pack join. Keyed
// on material because some recipe names split into several live products
// (PROTECT → WS PROTECT / WS PROTECT DUSTPROOF / WS PROTECT CLEAR).
const NAME_OVERRIDES = nameOverridesJson as Record<
  string,
  { product: string; category: string; baseColour: string }
>;

// Durable isPrimary home. The table default is `true` and the seed re-inserts
// every row, so the May-30 dedup (130 twins → false) + the 94 BASE 3.6L
// alternate (IN46359471) are re-applied on each reseed from this set.
// Snapshot of the live isPrimary=false set (130) captured 2026-06-01, plus
// IN46359471. Entries that belong to excluded rows are harmless (never inserted).
const SET_FALSE = new Set<string>([
  "5554795", "5554798", "5554802", "5554803", "5554804", "5554805", "5554816",
  "5577377-PROMISE", "5577380-PROMISE", "5577383-PROMISE", "5577386-PROMISE",
  "5580410-PROMISE", "5580412-PROMISE", "5769799", "5771981", "5771985",
  "5771989", "5771990", "5771991", "5771992", "5771993", "5771994", "5771995",
  "5771996", "5771998", "5772002", "5772004", "5772006", "5772007", "5772008",
  "5772017", "5772018", "5772019", "5834786", "5834787", "5834798",
  "5834799", "5834800", "5834802", "5834804", "5834827", "5838853-PROMISE",
  "5838854-PROMISE", "5838855-PROMISE", "5838857-PROMISE", "5838858-PROMISE",
  "5838859-PROMISE", "5838860-PROMISE", "5838861-PROMISE", "5838862-PROMISE",
  "5838863-PROMISE", "5838865-PROMISE", "5838872-PROMISE", "5838873-PROMISE",
  "5838874-PROMISE", "5838875-PROMISE", "5838876-PROMISE", "5838877-PROMISE",
  "5838878-PROMISE", "5838879-PROMISE", "5838880-PROMISE", "5838881-PROMISE",
  "5838882-PROMISE", "5838883-PROMISE", "5838885-PROMISE", "5838886-PROMISE",
  "5838887-PROMISE", "5851766", "5853599", "5853599-PROMISE", "5853600-PROMISE",
  "5853604-PROMISE", "5853606", "5853606-PROMISE", "5853607-PROMISE",
  "5867110-PROMISE", "5867111-PROMISE", "5867112-PROMISE", "5867113-PROMISE",
  "5867117-PROMISE", "5867141-PROMISE", "5867142-PROMISE", "5867143-PROMISE",
  "5915413", "5994750-PROMISE_INTERIOR", "5994751-PROMISE_INTERIOR",
  "5994752-PROMISE_INTERIOR", "5994753-PROMISE_INTERIOR", "IN23820023",
  "IN23820081", "IN23820082", "IN23829023", "IN23829071", "IN23829223",
  "IN28085071", "IN28085072", "IN28085081", "IN28085082", "IN30700023",
  "IN30709223", "IN32316823", "IN46309872",
  "IN46350049", "IN46350071", "IN46350072", "IN46350082", "IN46359071",
  "IN46359072", "IN46359223", "IN46359271", "IN46359281", "IN46359282",
  "IN46359582", "IN46359671", "IN46359771", "IN46359772", "IN46359781",
  "IN46359782", "IN46359871", "IN46359881", "IN46359882", "IN55009071",
  "IN55009072", "IN84500023-PROMISE", "IN84500023-PROMISE_INTERIOR",
  "IN84500072", "IN84500072-PROMISE_INTERIOR",
  // 94 BASE 3.6L alternate — hide so only the real 4L (5948221) shows.
  "IN46359471",
  // 94/95 BASE leftover fractional twins still rendering on mobile (each has
  // a primary standard-bucket sibling that stays): 94 0.9L, 95 0.9L/3.6L/18L.
  "IN46359423", "IN46359572", "IN46359571", "IN46359581",
  // GLOSS / PU-Enamel review (2026-06-02): the BW→90 BASE reclassified 20L
  // (IN28009081) stays hidden. NOTE: 5802250 was REMOVED from the snapshot above
  // — its old isPrimary=false was a GLOSS-context dedup vs IN28301072 (DN GLOSS
  // BRILLIANT WHITE 1L), which stays in GLOSS; within its new PU ENAMEL home
  // 5802250 is the only Brilliant White 1L, so it must remain primary.
  "IN28009081",
  // New Interior WBC (2026-06-04): unified to product "INTERIOR BASECOAT"
  // (same as old 5688020-23) via sku-name-overrides.json. Old WBC stays
  // primary; these NEW packs are hidden until promoted, so the route shows
  // one Interior Basecoat pack set.
  "9075187", "9075189", "9075190", "9075191",
  // HP Colorant hidden (2026-06-08): the HP COLORANT menu row was removed from
  // taxonomy-preview.json (its synthetic "COLORANT" base matched no stock base,
  // so it rendered with no packs). Keep the 3 stock SKUs (Yellow/Red/Green) but
  // mark them non-primary so they drop off the mobile route without deleting them.
  "IN68011072", "IN68011172", "IN68011372",
  // PRIMER review (2026-06-08): hidden alternates per primer-review-final.csv.
  //  - Red Oxide merge: the 2 IP DUWEL packs demoted; the 5 ex-ROM packs
  //    (re-keyed to RED OXIDE METAL PRIMER via sku-name-overrides.json) are the
  //    visible set.
  //  - Cement SB 20L: the IP/ICI DUWEL brand twins hidden (DN stays primary).
  //  - Alkali 1L + Cement-WB 1L: the CSV picks the OPPOSITE 1L twin as primary
  //    vs the old live state, so IN32600072 + IN32076823 were REMOVED from this
  //    set above and their siblings (IN32600023 / IN32076872) are hidden here.
  //  - Interior Acrylic 1L: IN32316823 stays hidden (kept above, CSV agrees).
  "IN34010071", "IN34010082",
  "IN34020081", "IN34120081",
  "IN32600023", "IN32076872",
]);

// ── CSV-as-source for the 3 WS targets (2026-06-01) ─────────────────────
// The reviewed CSVs in docs/SKU/review/ are the authoritative PRODUCT
// MEMBERSHIP + KEEP/HIDE for these products. Keyed on `material` (unique);
// baseColour / packCode / unit / description / category still come from the
// legacy→v2 translation (authoritative) — so the multi-base collision
// listings auto-collapse and the "Brillant White" typo is irrelevant. A
// material a CSV references but legacy never produces cannot be built —
// collected + reported (rule 5), never fabricated.
const CSV_TARGETS: Array<{ file: string; product: string }> = [
  { file: path.join("docs", "SKU", "review", "ws-Protect_Dustproof-review.csv"), product: "WS PROTECT DUSTPROOF" },
  { file: path.join("docs", "SKU", "review", "ws-Protect_Rainproof-review.csv"), product: "WS PROTECT RAINPROOF" },
  { file: path.join("docs", "SKU", "review", "ws-PowerFlexx-review.csv"),        product: "WS POWERFLEXX" },
];

// Group-B leftovers — DELETE (exclude, never regenerate). The wrong plain
// "WS PROTECT" product is removed entirely: 13 of its materials fold into the
// Dustproof CSV (→ hidden), 10 colours are re-homed via the Dustproof CSV
// (→ KEEP), and these 9 are dropped here → 0 "WS PROTECT" rows remain.
const PROTECT_DELETE = new Set<string>([
  "IN36209274", "IN36209474", "IN36309723", "IN36309771", "IN36209772",
  "IN36309881", "IN36309672", "IN36309671", "IN36309682",
]);

// Powerflexx leftover present only in live (no CSV row) — drop it.
const POWERFLEXX_DROP = new Set<string>(["IN76109271"]);

// Promise review (2026-06-03): REMOVE ×2 + DELETE ×1 per the marked CSV
// (5883561 "comes in 20L too"; 5838876 "wrong map, is 90 BASE"; IN86309472
// "duplicate"). Dropped entirely from v2.
const PROMISE_REMOVE = new Set<string>(["5883561", "5838876", "IN86309472"]);

// KEEP materials with NO legacy source — build the v2 row from the CSV
// instead of skipping (rule: KEEP-only; HIDE-missing stay absent).
const BUILD_FROM_CSV = new Set<string>([
  "IN36409923", // Dustproof 99 BASE 1L
  "IN36409971", // Dustproof 99 BASE 4L
  "5880419",    // Dustproof 95 BASE 1L
  "5769796",    // Powerflexx 93 BASE 4L
]);

// CSV columns: 0 Base · 1 Pack(on screen) · 2 SAP size · 3 material ·
// 4 on-screen · 5 Decision · 6 Notes · 7 isPrimary · 8 SKU Description.
// `pack` (nominal, every row) drives sibling lookup for build-from-CSV;
// base/desc are captured from the KEEP row (the authoritative shown row).
type CsvProductEntry = {
  product: string; isPrimary: boolean; products: Set<string>;
  pack: string; base: string; desc: string;
};

async function loadCsvProductMap(): Promise<Map<string, CsvProductEntry>> {
  const map = new Map<string, CsvProductEntry>();
  for (const t of CSV_TARGETS) {
    const raw = await fs.readFile(t.file, "utf8");
    for (const line of raw.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const c = line.split(",");
      const material = (c[3] ?? "").trim();        // SAP code column
      if (!material) continue;
      const keep = (c[5] ?? "").trim().toUpperCase() === "KEEP";  // Decision column
      let e = map.get(material);
      if (!e) { e = { product: t.product, isPrimary: false, products: new Set(), pack: (c[1] ?? "").trim(), base: (c[0] ?? "").trim(), desc: (c[8] ?? "").trim() }; map.set(material, e); }
      e.products.add(t.product);
      if (keep) { e.isPrimary = true; e.base = (c[0] ?? "").trim(); e.pack = (c[1] ?? "").trim(); e.desc = (c[8] ?? "").trim(); }
    }
  }
  return map;
}

// ── CSV-as-source for the SADOLIN (woodcare) rebuild (2026-06-04) ───────
// docs/SKU/review/sadolin-review-final-20260604.csv is the source of truth.
// Each row carries a brand-scoped proposedProduct (e.g. "2K PU GLOSS",
// "HYDRO PU SEALER", "1K PU GLOSS", "SYNTHETIC VARNISH") + proposedBase;
// category is forced to "SADOLIN" (the stock-side family grouping — the menu
// family is set separately in v2-catalog-seed-from-preview.ts; the menu↔stock
// join is by product+baseColour, not category). 146 existing materials are
// re-keyed in the main loop; the Hydro PU rows have no legacy source and are
// built in step 2f. Data fixes (CSV `note` column) are encoded below.
const SADOLIN_CSV      = path.join("docs", "SKU", "review", "sadolin-review-final-20260604.csv");
const SADOLIN_CATEGORY = "SADOLIN";
// material → {packCode, unit} hard fixes (CSV `note`): 500ML stored as unit L;
// Wood Filler Walnut 1L that is really 1KG. The 3L thinner is left as 3L.
const SADOLIN_PACK_FIX: Record<string, { packCode: string; unit: string }> = {
  "IN20109673": { packCode: "500", unit: "ML" },  // 1K PU Gloss 500ML (was unit L)
  "IN20109173": { packCode: "500", unit: "ML" },  // Synthetic Varnish 500ML (was unit L)
  "IN35203203": { packCode: "1",   unit: "KG" },  // Wood Filler Walnut 1L → 1KG
};
// Duplicate White 1KG wood filler — keep IN35202003 primary, demote IN35203003.
const SADOLIN_DEMOTE = new Set<string>(["IN35203003"]);

type SadolinEntry = { product: string; baseColour: string; isPrimary: boolean; pack: string; description: string };

// Minimal CSV field splitter that honours "double-quoted, comma-bearing" cells
// (the sadolin CSV's searchTokens column contains commas).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Parse a display pack label ("1L","4L","500ML","1KG","500GM") → packCode+unit.
function parsePackLabel(label: string): { packCode: string; unit: string } | null {
  const m = label.trim().match(/^(\d+(?:\.\d+)?)\s*(ML|GM|KG|LTR|LT|L)$/i);
  if (!m) return null;
  let unit = m[2].toUpperCase();
  if (unit === "LTR" || unit === "LT") unit = "L";
  return { packCode: m[1], unit };
}

// Columns: 0 family · 1 tab · 2 tabSeq · 3 brandLine · 4 brandSeq ·
// 5 proposedProduct · 6 proposedBase · 7 displayName · 8 searchTokens ·
// 9 material · 10 description · 11 pack · 12 isPrimary · 13 hydration · 14 note.
async function loadSadolinMap(): Promise<Map<string, SadolinEntry>> {
  const map = new Map<string, SadolinEntry>();
  const raw = await fs.readFile(SADOLIN_CSV, "utf8");
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const material = (c[9] ?? "").trim();
    if (!material) continue;
    map.set(material, {
      product:     (c[5] ?? "").trim(),
      baseColour:  (c[6] ?? "").trim(),
      isPrimary:   (c[12] ?? "").trim().toUpperCase() === "TRUE",
      pack:        (c[11] ?? "").trim(),
      description: (c[10] ?? "").trim(),
    });
  }
  return map;
}

// ── CSV-as-source for the TOOLS injection (2026-06-08) ─────────────────
// docs/SKU/review/tools-catalog-source.csv = 25 brand-new tool SKUs (rollers /
// brushes), none in legacy. STOCK needs only columns 0-9 (material..isPrimary);
// the lone comma-bearing/quoted column is searchTokens (11, a MENU concern). We
// split on PLAIN commas because every column we read is comma-free — including
// the inch-mark `"` in description, which is literal data, not a CSV quote, so
// splitCsvLine (quote-aware) would mis-parse it. category forced "TOOLS",
// baseColour forced "" on every tool row.
const TOOLS_CSV      = path.join("docs", "SKU", "review", "tools-catalog-source.csv");
const TOOLS_CATEGORY = "TOOLS";
type ToolsEntry = { material: string; description: string; product: string; packCode: string; unit: string; isPrimary: boolean };

// Columns: 0 material · 1 description · 2 product · 3 displayName · 4 region ·
// 5 baseColour · 6 category · 7 packCode · 8 unit · 9 isPrimary · 10 uiGroup ·
// 11 searchTokens · 12 sortOrder.
async function loadToolsMap(): Promise<Map<string, ToolsEntry>> {
  const map = new Map<string, ToolsEntry>();
  const raw = await fs.readFile(TOOLS_CSV, "utf8");
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(",");                 // stock columns (0-9) are comma-free
    const material = (c[0] ?? "").trim();
    if (!material) continue;
    map.set(material, {
      material,
      description: (c[1] ?? "").trim(),
      product:     (c[2] ?? "").trim(),
      packCode:    (c[7] ?? "").trim(),
      unit:        (c[8] ?? "").trim() || "PC",
      isPrimary:   (c[9] ?? "").trim().toUpperCase() === "TRUE",
    });
  }
  return map;
}

// ── CSV-as-source for the SUPERCOVER + SUPERCOVER SHEEN rebuild (2026-06-09) ──
// docs/SKU/review/supercover-final.csv is the source of truth for both products'
// stock (membership + KEEP/HIDE + base re-homes). Mirrors the Sadolin/Tools drill:
// 34 existing materials are re-keyed in the main loop; 56 absent-from-legacy
// materials are built in step 2h. CSV wins over the legacy→v2 translation, scoped
// to these two products only. category forced "SUPERCOVER" (the family); product =
// CSV MapToProduct ("SUPERCOVER" | "SUPERCOVER SHEEN"); baseColour = CSV Base
// (re-homes YELLOW BASE → 96 BASE for IN27309672 / IN27309671); packCode/unit
// derived from the CSV Pack column ("1L"→1/L, "250ML"→250/ML — formatPack renders both).
const SUPERCOVER_CSV      = path.join("docs", "SKU", "review", "supercover-final.csv");
const SUPERCOVER_CATEGORY = "SUPERCOVER";
type SuperCoverEntry = { product: string; baseColour: string; packCode: string; unit: string; isPrimary: boolean; description: string };

// Columns: 0 Tab · 1 Base · 2 Alias · 3 Pack · 4 Unit · 5 SAP · 6 isPrimary ·
// 7 MapToProduct · 8 Description · 9 Carton · 10 Notes. Quote-aware split (mirrors
// loadSadolinMap) in case a Description ever carries a comma.
async function loadSuperCoverMap(): Promise<Map<string, SuperCoverEntry>> {
  const map = new Map<string, SuperCoverEntry>();
  const raw = await fs.readFile(SUPERCOVER_CSV, "utf8");
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const material = (c[5] ?? "").trim();           // SAP column
    if (!material) continue;
    const pk = parsePackLabel((c[3] ?? "").trim()); // Pack column "1L" / "250ML"
    if (!pk) { console.log(`[supercover] bad pack "${c[3]}" for ${material} — skipped`); continue; }
    map.set(material, {
      product:     (c[7] ?? "").trim(),   // MapToProduct
      baseColour:  (c[1] ?? "").trim(),   // Base
      packCode:    pk.packCode,
      unit:        pk.unit,
      isPrimary:   (c[6] ?? "").trim().toUpperCase() === "TRUE",
      description: (c[8] ?? "").trim(),
    });
  }
  return map;
}

// ── CSV-as-source for the SUPERCLEAN + SUPERCLEAN 3IN1 rebuild (2026-06-09) ──
// docs/SKU/review/superclean-final.csv is the source of truth for both products'
// stock. Mirrors the SuperCover drill: 80 existing materials are re-keyed in the
// main loop; 31 absent-from-legacy materials are built in step 2i. CSV wins over
// the legacy→v2 translation, scoped to these two products only. category forced
// "SUPERCLEAN" (the family); product = CSV MapToProduct ("SUPERCLEAN" | "SUPERCLEAN
// 3IN1"); baseColour = CSV Base; packCode/unit from the CSV Pack column (all litres
// here: 1L/4L/10L/20L → 1/4/10/20 + L, no 250ML).
const SUPERCLEAN_CSV      = path.join("docs", "SKU", "review", "superclean-final.csv");
const SUPERCLEAN_CATEGORY = "SUPERCLEAN";
type SuperCleanEntry = { product: string; baseColour: string; packCode: string; unit: string; isPrimary: boolean; description: string };

// Columns: 0 Tab · 1 Base · 2 Alias · 3 Pack · 4 Unit · 5 SAP · 6 isPrimary ·
// 7 MapToProduct · 8 Description · 9 Carton · 10 Notes. Quote-aware split (mirrors
// loadSuperCoverMap).
async function loadSuperCleanMap(): Promise<Map<string, SuperCleanEntry>> {
  const map = new Map<string, SuperCleanEntry>();
  const raw = await fs.readFile(SUPERCLEAN_CSV, "utf8");
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const material = (c[5] ?? "").trim();           // SAP column
    if (!material) continue;
    const pk = parsePackLabel((c[3] ?? "").trim()); // Pack column "1L" / "4L" / "10L" / "20L"
    if (!pk) { console.log(`[superclean] bad pack "${c[3]}" for ${material} — skipped`); continue; }
    map.set(material, {
      product:     (c[7] ?? "").trim(),   // MapToProduct
      baseColour:  (c[1] ?? "").trim(),   // Base
      packCode:    pk.packCode,
      unit:        pk.unit,
      isPrimary:   (c[6] ?? "").trim().toUpperCase() === "TRUE",
      description: (c[8] ?? "").trim(),
    });
  }
  return map;
}

// ── CSV-as-source for the DISTEMPER allowlist (2026-06-12) ──────────────────
// docs/SKU/review/distemper-final.csv is the COMPLETE allowlist for the
// DISTEMPER family stock. Unlike SuperCover/SuperClean (which HIDE non-CSV
// rows via isPrimary=false), here non-CSV DISTEMPER rows are DROPPED entirely
// (see the category-scoped drop in the main loop). The 13 listed materials
// keep their existing legacy product/baseColour (ACRYLIC DISTEMPER / MAGIK,
// which already resolve their packs) — the CSV only enforces (a) the allowlist
// and (b) isPrimary. Columns: 0 Family · 1 Row · 2 Pack · 3 Unit · 4 SAP ·
// 5 isPrimary · 6 Description · 7 Notes. Quote-aware split (mirrors the others).
const DISTEMPER_CSV      = path.join("docs", "SKU", "review", "distemper-final.csv");
const DISTEMPER_CATEGORY = "DISTEMPER";
type DistemperEntry = { isPrimary: boolean };

async function loadDistemperMap(): Promise<Map<string, DistemperEntry>> {
  const map = new Map<string, DistemperEntry>();
  const raw = await fs.readFile(DISTEMPER_CSV, "utf8");
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const material = (c[4] ?? "").trim();           // SAP column
    if (!material) continue;
    map.set(material, {
      isPrimary: (c[5] ?? "").trim().toUpperCase() === "TRUE",
    });
  }
  return map;
}

// ── CSV-as-source for the TEXTURE + PUTTY rebuild (2026-06-12) ──────────────
// docs/SKU/review/texture-putty-review.csv is the source of truth for BOTH the
// PUTTY and TEXTURE families' stock. Mirrors the Sadolin/SuperCover drill: the
// 11 existing materials are re-keyed in the main loop (CSV wins on product/
// baseColour/isPrimary/pack/unit AND description — Path-B precedent), and the 3
// new TEXTURE materials (5857610/11/12, absent from legacy) are built in step 2j.
// category = CSV family ("PUTTY" | "TEXTURE"); packCode/unit parsed from the CSV
// Pack column ("1KG"/"40KG"/"18L"/"25KG"/"30KG"). Scoped strictly to these two
// families; any PUTTY/TEXTURE stock material NOT in the CSV is REPORTED (never
// dropped). Columns: 0 material · 1 family · 2 product · 3 baseColour ·
// 4 displayName · 5 pack · 6 unit · 7 isPrimary · 8 searchTokens · 9 description ·
// 10 uiGroup · 11 decisionNote. Quote-aware split (searchTokens carries commas).
const TEXTURE_PUTTY_CSV = path.join("docs", "SKU", "review", "texture-putty-review.csv");
type TexturePuttyEntry = { family: string; product: string; baseColour: string; isPrimary: boolean; packCode: string; unit: string; description: string };

async function loadTexturePuttyMap(): Promise<Map<string, TexturePuttyEntry>> {
  const map = new Map<string, TexturePuttyEntry>();
  const raw = await fs.readFile(TEXTURE_PUTTY_CSV, "utf8");
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const material = (c[0] ?? "").trim();
    if (!material) continue;
    const pk = parsePackLabel((c[5] ?? "").trim());   // Pack column "1KG" / "40KG" / "18L"
    if (!pk) { console.log(`[texture-putty] bad pack "${c[5]}" for ${material} — skipped`); continue; }
    map.set(material, {
      family:      (c[1] ?? "").trim(),
      product:     (c[2] ?? "").trim(),
      baseColour:  (c[3] ?? "").trim(),
      isPrimary:   (c[7] ?? "").trim().toUpperCase() === "TRUE",
      packCode:    pk.packCode,
      unit:        pk.unit,
      description: (c[9] ?? "").trim(),
    });
  }
  return map;
}

// ── CSV-as-source for the VT SPECIALTY rebuild (2026-06-13) ─────────────────
// docs/SKU/review/velvet-touch-specialty-review.csv is the source of truth for
// the VT SPECIALTY family stock. Mirrors loadTexturePuttyMap exactly: existing
// materials are re-keyed in the main loop (CSV wins on product/baseColour/
// isPrimary/pack/unit AND description), and the 3 new VAF materials (Trends
// Glitter Silver/Gold, Marble — absent from legacy) are built in step 2k. The
// 14 VISIBLE rows are isPrimary=TRUE; the 18 HIDDEN rows (VT Fin/Metallics/
// Ambiance/Luxury Finishes) are isPrimary=FALSE (demoted, kept in DB). category
// forced "VT SPECIALTY"; packCode/unit parsed from the CSV Pack column
// ("1L"/"500ML"/"1KG"/"5KG"…). Scoped strictly to VT SPECIALTY; any VT SPECIALTY
// stock material NOT in the CSV is REPORTED (never dropped). Columns: same shape
// as texture-putty (0 material · 1 family · 2 product · 3 baseColour · 5 pack ·
// 7 isPrimary · 9 description). Quote-aware split (searchTokens carries commas).
const VT_SPECIALTY_CSV = path.join("docs", "SKU", "review", "velvet-touch-specialty-review.csv");
const VT_SPECIALTY_CATEGORY = "VT SPECIALTY";
type VtSpecialtyEntry = { family: string; product: string; baseColour: string; isPrimary: boolean; packCode: string; unit: string; description: string };

async function loadVtSpecialtyMap(): Promise<Map<string, VtSpecialtyEntry>> {
  const map = new Map<string, VtSpecialtyEntry>();
  const raw = await fs.readFile(VT_SPECIALTY_CSV, "utf8");
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const material = (c[0] ?? "").trim();
    if (!material) continue;
    const pk = parsePackLabel((c[5] ?? "").trim());   // Pack column "1L" / "500ML" / "1KG"
    if (!pk) { console.log(`[vt-specialty] bad pack "${c[5]}" for ${material} — skipped`); continue; }
    map.set(material, {
      family:      (c[1] ?? "").trim(),
      product:     (c[2] ?? "").trim(),
      baseColour:  (c[3] ?? "").trim(),
      isPrimary:   (c[7] ?? "").trim().toUpperCase() === "TRUE",
      packCode:    pk.packCode,
      unit:        pk.unit,
      description: (c[9] ?? "").trim(),
    });
  }
  return map;
}

// ── CSV-as-source for the REMAINING-5 rebuild (2026-06-14) ──────────────────
// docs/SKU/review/remaining5-final.csv is the COMPLETE source of truth for the
// TILE / METALLIC / LUSTRE / SMOOTHOVER / FLOOR PLUS family stock (73 existing +
// 7 net-new = 80 rows). Mirrors loadVtSpecialtyMap: existing materials are
// re-keyed in the main loop (CSV wins on product/baseColour/isPrimary/pack/unit
// AND description — applies the TILE empty→WHITE BASE re-key, LUSTRE 96 re-key,
// FLOOR PLUS TOPCOAT→FLOOR PLUS merge, BRILLIANT WHITE→WHITE, and all demotions),
// and the 7 new codes (IN55009272/282/471/482/481, 5727751, 5727757) are built in
// step 2l. category = CSV family. Unlike VT, pack and unit are SEPARATE CSV
// columns (4 + 5), so packCode/unit are read directly (no parsePackLabel).
// Columns: 0 material · 1 family · 2 product · 3 baseColour · 4 pack · 5 unit ·
// 6 isPrimary · 7 displayName · 8 uiGroup · 9 description · 10 note. Quote-aware
// split (the note column carries commas). Any legacy SKU in these 5 families NOT
// in the CSV is a HARD STOP (CSV is complete coverage).
const REMAINING5_CSV = path.join("docs", "SKU", "review", "remaining5-final.csv");
const REMAINING5_FAMILIES = new Set<string>(["TILE", "METALLIC", "LUSTRE", "SMOOTHOVER", "FLOOR PLUS"]);
type Remaining5Entry = { family: string; product: string; baseColour: string; isPrimary: boolean; packCode: string; unit: string; description: string };

// ── VELVET TOUCH product → "VT …" rename (2026-06-14) ───────────────────────
// Brands the 6 VT ranges' stock product like WS Tile/Metallic, so email +
// last-order + search read "VT PEARL GLO …". Applied gated to category
// "VELVET TOUCH" in the main loop (see finalProduct). Mirrored on the menu side
// by CONFIRMED_SUBPRODUCT_MAP + base-aliases keys (join + alias key follow).
const VT_PRODUCT_RENAME: Record<string, string> = {
  "PEARL GLO":       "VT PEARL GLO",
  "PLATINUM GLO":    "VT PLATINUM GLO",
  "DIAMOND GLO":     "VT DIAMOND GLO",
  "ETERNA":          "VT ETERNA",
  "ETERNA MATT":     "VT ETERNA MATT",
  "ETERNA HI-SHEEN": "VT ETERNA HI-SHEEN",
};

// ── STAINER product rename (2026-06-14) ─────────────────────────────────────
// Machine's stock product is "MACHINE STAINER" (via sku-name-overrides.json);
// rebrand → "MACHINE TINTER" so both join sides match the menu (CONFIRMED_
// SUBPRODUCT_MAP) and the email/grid/tab read "Machine Tinter". Gated to
// category STAINER (VT pattern); baseColours untouched.
const STAINER_PRODUCT_RENAME: Record<string, string> = {
  "MACHINE STAINER": "MACHINE TINTER",
};

// ── AQUATECH product rename (2026-06-14) ────────────────────────────────────
// "INTERIOR BASECOAT" is a taxonomy label; the real SAP product is "INTERIOR
// WBC" (every description reads "AQUATECH INTERIOR WBC …"). Rename so the email
// reads "INTERIOR WBC" and the menu→stock join (paired CONFIRMED_SUBPRODUCT_MAP
// entry) hydrates its 4 packs. Gated to category AQUATECH; baseColours untouched.
const AQUATECH_PRODUCT_RENAME: Record<string, string> = {
  "INTERIOR BASECOAT": "INTERIOR WBC",
};

async function loadRemaining5Map(): Promise<Map<string, Remaining5Entry>> {
  const map = new Map<string, Remaining5Entry>();
  const raw = await fs.readFile(REMAINING5_CSV, "utf8");
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = splitCsvLine(line);
    const material = (c[0] ?? "").trim();
    if (!material) continue;
    map.set(material, {
      family:      (c[1] ?? "").trim(),
      product:     (c[2] ?? "").trim(),
      baseColour:  (c[3] ?? "").trim(),
      packCode:    (c[4] ?? "").trim(),
      unit:        (c[5] ?? "").trim(),
      isPrimary:   (c[6] ?? "").trim().toUpperCase() === "TRUE",
      description: (c[9] ?? "").trim(),
    });
  }
  return map;
}

// Shape of one row to be inserted into mo_sku_lookup_v2.
type V2Row = {
  material:        string;
  description:     string;
  category:        string;
  product:         string;
  baseColour:      string;
  packCode:        string;
  unit:            string | null;
  refMaterial:     string | null;
  refDescription:  string | null;
  paintType:       string | null;
  materialType:    string | null;
  piecesPerCarton: number | null;
  isPrimary:       boolean;
};

function familySuffix(family: string): string {
  return family.replace(/\s+/g, "_");
}

// ── Root-cause pack/unit normalization (2026-06-03) ─────────────────────
// Three independent legacy-data defects that the route's old packCode|unit
// dedup let leak through as duplicate / alien / stray pack columns. Fixed
// here in the durable source so a wipe-and-reseed keeps them fixed.
//
// 1. Catalog-wide litre unit token "LT"/"LTR" → "L". formatPack/packToMl render
//    "L" and "LT" identically, so on-screen display is unchanged; this collapses
//    the L-vs-LT split that made one nominal size appear as two pack columns
//    (e.g. Promise Exterior 94 BASE "two 1L", 98 BASE "two 20L"). KG/GM/ML/PC
//    untouched.
function normalizeUnit(unit: string | null): string | null {
  if (unit == null) return unit;
  const u = unit.trim().toUpperCase();
  return u === "LT" || u === "LTR" ? "L" : unit;
}

// 2. Mis-keyed packCode 22 → 20 for Promise litre rows (RULE, not a material list).
//    Some legacy Promise emulsion SKUs carry a "22" fill code where the real pack
//    is the 20L standard (promise-review.csv: "IT IS 20l STANDARD NOT 22L"). The
//    rule catches every such row (5882951, 5883496, 5883497, …) regardless of base.
//    The 22KG distemper bag (unit KG, non-Promise) is left untouched.
// 3. Promise 93-BASE fractional litre fills → nominal pack, per the CSV
//    "Pack (on screen)" column (0.925→1, 3.7→4, 9.25→10, 18.5→20). Gated to
//    Promise rows so no non-Promise SKU with a genuine fractional pack is touched.
//    Affects 93 BASE across all four emulsion tabs. description left as the true fill.
const PROMISE_FRACTIONAL_TO_NOMINAL: Record<string, string> = {
  "0.925": "1", "3.7": "4", "9.25": "10", "18.5": "20",
};
function normalizePackCode(
  packCode: string, unit: string | null, category: string, product: string,
): string {
  const isPromise = category === "PROMISE" || product.toUpperCase().startsWith("PROMISE");
  const u = (unit ?? "").trim().toUpperCase();
  const isLitre = u === "" || u === "L" || u === "LT" || u === "LTR";
  if (isPromise && isLitre && packCode === "22") return "20";
  if (isPromise && isLitre && PROMISE_FRACTIONAL_TO_NOMINAL[packCode]) {
    return PROMISE_FRACTIONAL_TO_NOMINAL[packCode];
  }
  return packCode;
}

async function main(): Promise<void> {
  /* eslint-disable no-console */

  // ── 1. Read legacy SKU rows ─────────────────────────────────────────
  const legacyRows = await prisma.mo_sku_lookup.findMany({
    select: {
      material:        true,
      description:     true,
      category:        true,
      product:         true,
      baseColour:      true,
      packCode:        true,
      unit:            true,
      refMaterial:     true,
      refDescription:  true,
      paintType:       true,
      materialType:    true,
      piecesPerCarton: true,
    },
  });
  console.log(`Legacy SKU rows read: ${legacyRows.length}`);

  // CSV-as-source product membership for the 3 WS targets.
  const csvProduct = await loadCsvProductMap();
  console.log(`CSV product map: ${csvProduct.size} distinct materials across 3 target CSVs`);

  // CSV-as-source for the SADOLIN woodcare rebuild (154 rows).
  const sadolin = await loadSadolinMap();
  console.log(`SADOLIN CSV map: ${sadolin.size} materials (source of truth)`);

  // CSV-as-source for the TOOLS injection (25 new rollers/brushes).
  const tools = await loadToolsMap();
  console.log(`TOOLS CSV map: ${tools.size} materials (source of truth)`);

  // CSV-as-source for the SUPERCOVER + SUPERCOVER SHEEN rebuild (90 materials).
  const superCover = await loadSuperCoverMap();
  console.log(`SUPERCOVER CSV map: ${superCover.size} materials (source of truth)`);

  // CSV-as-source for the SUPERCLEAN + SUPERCLEAN 3IN1 rebuild (111 materials).
  const superClean = await loadSuperCleanMap();
  console.log(`SUPERCLEAN CSV map: ${superClean.size} materials (source of truth)`);

  // CSV-as-source ALLOWLIST for the DISTEMPER family (13 materials).
  const distemper = await loadDistemperMap();
  console.log(`DISTEMPER CSV allowlist: ${distemper.size} materials (drop any DISTEMPER stock not listed)`);

  // CSV-as-source for the TEXTURE + PUTTY rebuild (14 materials: 11 re-key + 3 new).
  const texturePutty = await loadTexturePuttyMap();
  console.log(`TEXTURE/PUTTY CSV map: ${texturePutty.size} materials (source of truth for PUTTY + TEXTURE)`);

  // CSV-as-source for the VT SPECIALTY rebuild (32 materials: 14 visible + 18 hidden; 3 new VAF).
  const vtSpecialty = await loadVtSpecialtyMap();
  console.log(`VT SPECIALTY CSV map: ${vtSpecialty.size} materials (source of truth for VT SPECIALTY)`);

  // CSV-as-source for the REMAINING-5 rebuild (80 materials: 73 re-key + 7 new).
  const remaining5 = await loadRemaining5Map();
  console.log(`REMAINING5 CSV map: ${remaining5.size} materials (TILE/METALLIC/LUSTRE/SMOOTHOVER/FLOOR PLUS)`);

  // ── 2. Translate each legacy row via mapLegacyToNew ─────────────────
  let skippedNull = 0;
  let crossListed = 0;  // source rows producing >1 v2 row
  let excludedByBase = 0;      // WS Max removed bases
  let excludedByMaterial = 0;  // stray material removals (EXCLUDE_MATERIALS + PROTECT_DELETE)
  let overridden = 0;          // rows whose names came from NAME_OVERRIDES
  let csvAssigned = 0;         // rows whose product came from a target CSV
  let droppedUmbrella = 0;     // Promise "-PROMISE" umbrella cross-list stock dupes dropped
  let unitsNormalized = 0;     // litre unit "LT"/"LTR" → "L"
  let fractionalNormalized = 0;// Promise fractional packCode → nominal
  let miskeyedFixed = 0;       // packCode 22 → 20
  let sadAssigned = 0;         // existing materials re-keyed by the SADOLIN CSV
  let scAssigned = 0;          // existing materials re-keyed by the SUPERCOVER CSV
  let sclAssigned = 0;         // existing materials re-keyed by the SUPERCLEAN CSV
  let droppedDistemper = 0;    // DISTEMPER stock rows dropped (not in the CSV allowlist)
  let tpAssigned = 0;          // existing materials re-keyed by the TEXTURE/PUTTY CSV
  const texturePuttyNotInCsv: string[] = [];  // PUTTY/TEXTURE natives absent from the CSV (report, never drop)
  let vtAssigned = 0;          // existing materials re-keyed by the VT SPECIALTY CSV
  const vtSpecialtyNotInCsv: string[] = [];   // VT SPECIALTY natives absent from the CSV (report, never drop)
  let rem5Assigned = 0;        // existing materials re-keyed by the REMAINING-5 CSV
  const remaining5NotInCsv: string[] = [];    // legacy SKU in the 5 families absent from the CSV (HARD STOP)
  const seenMaterials = new Set<string>();  // every material legacy produced (for rule-5 report)
  const v2Rows: V2Row[] = [];

  for (const legacy of legacyRows) {
    const key: LegacyKey = {
      category:   legacy.category,
      product:    legacy.product,
      baseColour: legacy.baseColour,
    };
    const newRows = mapLegacyToNew(key);
    if (newRows === null) {
      skippedNull++;
      continue;
    }
    if (newRows.length > 1) crossListed++;

    for (let i = 0; i < newRows.length; i++) {
      const newRow = newRows[i];
      const material =
        i === 0
          ? legacy.material
          : `${legacy.material}-${familySuffix(newRow.family)}`;
      seenMaterials.add(material);

      // ── Drop the umbrella "<mat>-PROMISE" stock dupes (2026-06-03) ──
      // Promise is one consolidated family now; the cross-list row under the
      // "PROMISE" umbrella duplicates the dedicated-family row (same product/
      // base/pack) and is the only reason removed junk resurfaces (e.g. the
      // bare 5883561/5838876 are removed but their -PROMISE twins escaped).
      // seenMaterials already holds this material, so the PROMISE build
      // (step 2e) will NOT re-create it as a hidden alternate.
      if (newRow.family === "PROMISE") { droppedUmbrella++; continue; }

      // ── Name override (May-13 renames) — applied BEFORE exclusions so
      //    both the exclusions and the inserted rows use the LIVE names. ──
      const ov = NAME_OVERRIDES[material];
      if (ov) overridden++;

      // ── SADOLIN CSV (2026-06-04) WINS over NAME_OVERRIDES + WS CSV for its
      //    154 materials: brand-scoped product, proposedBase, category SADOLIN.
      const sad = sadolin.get(material);
      const csv = csvProduct.get(material);
      // SUPERCOVER CSV (2026-06-09) WINS over everything for its 34 existing
      // materials: category SUPERCOVER, MapToProduct, CSV Base, CSV pack.
      const sc = superCover.get(material);
      // SUPERCLEAN CSV (2026-06-09) WINS the same way for its 80 existing materials.
      const scl = superClean.get(material);
      // DISTEMPER allowlist (2026-06-12): membership + isPrimary only; product/
      // baseColour are left as the legacy values (they already resolve).
      const dist = distemper.get(material);
      // TEXTURE/PUTTY CSV (2026-06-12) WINS over everything for its 14 materials:
      // category = CSV family, product, baseColour, isPrimary, pack/unit, description.
      const tp = texturePutty.get(material);
      // VT SPECIALTY CSV (2026-06-13) WINS over everything for its 32 materials:
      // category = "VT SPECIALTY", product, baseColour, isPrimary, pack/unit, description.
      const vt = vtSpecialty.get(material);
      // REMAINING-5 CSV (2026-06-14) WINS over everything for its 80 materials:
      // category = CSV family, product, baseColour, isPrimary, pack/unit, description.
      const rem5 = remaining5.get(material);
      if (sad) sadAssigned++;
      if (csv) csvAssigned++;
      if (sc) scAssigned++;
      if (scl) sclAssigned++;
      if (tp) tpAssigned++;
      if (vt) vtAssigned++;
      if (rem5) rem5Assigned++;

      const category =
        rem5 ? rem5.family
        : vt ? vt.family
        : tp ? tp.family
        : scl ? SUPERCLEAN_CATEGORY
        : sc ? SUPERCOVER_CATEGORY
        : sad ? SADOLIN_CATEGORY
        : ov ? ov.category
        : newRow.family;
      const product =
        rem5 ? rem5.product
        : vt ? vt.product
        : tp ? tp.product
        : scl ? scl.product
        : sc ? sc.product
        : sad ? sad.product
        : csv ? csv.product
        : ov ? ov.product
        : newRow.subProduct;
      const baseColour =
        rem5 ? rem5.baseColour
        : vt ? vt.baseColour
        : tp ? tp.baseColour
        : scl ? scl.baseColour
        : sc ? sc.baseColour
        : sad ? sad.baseColour
        : ov ? ov.baseColour
        : (newRow.baseColour ?? legacy.baseColour);

      // ── VELVET TOUCH product → "VT …" (2026-06-14, email + last-order + search
      //    consistency, like WS Tile/Metallic). Gated to category VELVET TOUCH so
      //    no other family's product (incl any "ETERNA" elsewhere) is touched.
      //    Only the WRITTEN product is renamed; the exclusion / pack-norm / isPrimary
      //    checks above keep using the un-renamed `product`. baseColour unchanged.
      const finalProduct =
        category === "VELVET TOUCH" && VT_PRODUCT_RENAME[product] ? VT_PRODUCT_RENAME[product]
        : category === "STAINER" && STAINER_PRODUCT_RENAME[product] ? STAINER_PRODUCT_RENAME[product]
        : category === "AQUATECH" && AQUATECH_PRODUCT_RENAME[product] ? AQUATECH_PRODUCT_RENAME[product]
        : product;

      // ── Exclusions (post-override keys, 2026-06-01) ──
      //   EXCLUDE_MATERIALS + PROTECT_DELETE (9 group-B) + POWERFLEXX_DROP (IN76109271).
      if (EXCLUDE_MATERIALS.has(material) || PROTECT_DELETE.has(material) || POWERFLEXX_DROP.has(material) || PROMISE_REMOVE.has(material)) { excludedByMaterial++; continue; }
      if (
        product === "WS MAX" &&
        EXCLUDE_BASE_WSMAX.has((baseColour ?? "").trim().toUpperCase())
      ) { excludedByBase++; continue; }

      // ── DISTEMPER allowlist drop (2026-06-12) ──
      // distemper-final.csv is the COMPLETE allowlist for the DISTEMPER family.
      // Any DISTEMPER-category stock row whose material is NOT in the CSV is
      // DROPPED (not hidden) — removes IN87109011 (11KG), IN87109022 (22KG),
      // 5862521 (Interior). Scoped strictly to category DISTEMPER; no other
      // family is affected (the Promise SmartChoice acrylic-distemper rows are
      // category PROMISE, so they pass through untouched).
      if (category === DISTEMPER_CATEGORY && !distemper.has(material)) { droppedDistemper++; continue; }

      // ── Root-cause pack/unit normalization (2026-06-03) ──
      let normUnit = normalizeUnit(legacy.unit);
      let normPack = normalizePackCode(legacy.packCode, legacy.unit, category, product);
      if (normUnit !== legacy.unit) unitsNormalized++;
      if (normPack !== legacy.packCode) {
        if (legacy.packCode === "22") miskeyedFixed++; else fractionalNormalized++;
      }
      // SADOLIN hard pack/unit fixes (CSV note column) win last.
      const pf = SADOLIN_PACK_FIX[material];
      if (pf) { normPack = pf.packCode; normUnit = pf.unit; }
      // SUPERCOVER CSV is authoritative on pack/unit for its materials (last win).
      if (sc) { normPack = sc.packCode; normUnit = sc.unit; }
      // SUPERCLEAN CSV likewise authoritative on pack/unit (last win).
      if (scl) { normPack = scl.packCode; normUnit = scl.unit; }
      // TEXTURE/PUTTY CSV authoritative on pack/unit (last win).
      if (tp) { normPack = tp.packCode; normUnit = tp.unit; }
      // VT SPECIALTY CSV authoritative on pack/unit (last win).
      if (vt) { normPack = vt.packCode; normUnit = vt.unit; }
      // REMAINING-5 CSV authoritative on pack/unit (last win).
      if (rem5) { normPack = rem5.packCode; normUnit = rem5.unit; }

      // ── REMAINING-5 not-in-CSV report (2026-06-14) ── HARD STOP (see step 2l).
      if (REMAINING5_FAMILIES.has(category) && !rem5) remaining5NotInCsv.push(material);

      // ── PUTTY/TEXTURE not-in-CSV report (2026-06-12) ──
      // texture-putty-review.csv is the source of truth for both families. Any
      // PUTTY/TEXTURE-category native NOT in the CSV is flagged for review and
      // kept (legacy resolution) — never silently dropped.
      if ((category === "PUTTY" || category === "TEXTURE") && !tp) texturePuttyNotInCsv.push(material);
      // ── VT SPECIALTY not-in-CSV report (2026-06-13) ── same rule: report, never drop.
      if (category === VT_SPECIALTY_CATEGORY && !vt) vtSpecialtyNotInCsv.push(material);

      v2Rows.push({
        material,
        // SADOLIN/TEXTURE-PUTTY CSV is the single source for its rows (product/
        // base/pack/isPrimary), so honour its description too — Path-B precedent
        // (fixes legacy-description drift). Verified no-op for the other 151
        // Sadolin rows: every CSV description already equals the live/legacy one.
        description:     rem5 ? rem5.description : vt ? vt.description : tp ? tp.description : sad ? sad.description : legacy.description,
        category,
        product:         finalProduct,
        baseColour,
        packCode:        normPack,
        unit:            normUnit,
        refMaterial:     legacy.refMaterial,
        refDescription:  legacy.refDescription,
        paintType:       legacy.paintType,
        materialType:    legacy.materialType,
        piecesPerCarton: legacy.piecesPerCarton,
        // SUPERCOVER CSV isPrimary wins for its materials; any SuperCover stock
        // row NOT in that CSV (e.g. the stray Sheen IN27909223) is demoted — the
        // CSV is the authoritative primary list. Then SADOLIN CSV (with White-1KG
        // demote); then WS CSV KEEP/HIDE; else the SET_FALSE rule.
        isPrimary:
          rem5 ? rem5.isPrimary
          : vt ? vt.isPrimary
          : tp ? tp.isPrimary
          : dist ? dist.isPrimary
          : scl ? scl.isPrimary
          : (product === "SUPERCLEAN" || product === "SUPERCLEAN 3IN1") ? false
          : sc ? sc.isPrimary
          : (product === "SUPERCOVER" || product === "SUPERCOVER SHEEN") ? false
          : sad ? (SADOLIN_DEMOTE.has(material) ? false : sad.isPrimary)
          : csv ? csv.isPrimary
          : (SET_FALSE.has(material) ? false : true),
      });
    }
  }

  // ── 2b. Build-from-CSV: KEEP materials with NO legacy source ────────
  // Construct the v2 row from CSV fields; copy packCode/unit/category from a
  // sibling of the SAME product + SAME nominal pack so it buckets correctly
  // (exact-match: we copy a real sibling's packCode verbatim — no rounding).
  // KEEP-only — HIDE-missing materials stay absent.
  type BuiltInfo = { material: string; product: string; baseColour: string; packCode: string; unit: string | null; category: string; sibling: string };
  const builtMaterials = new Set<string>();
  const builtRows: BuiltInfo[] = [];
  for (const m of Array.from(BUILD_FROM_CSV)) {
    if (seenMaterials.has(m)) continue;             // produced by legacy after all
    const e = csvProduct.get(m);
    if (!e || !e.isPrimary) continue;               // build only CSV KEEP materials
    const sibling = v2Rows.find((r) => r.product === e.product && csvProduct.get(r.material)?.pack === e.pack);
    if (!sibling) { console.log(`[build] NO SIBLING for ${m} (${e.product} pack "${e.pack}") — cannot build`); continue; }
    v2Rows.push({
      material:        m,
      description:     e.desc,
      category:        sibling.category,
      product:         e.product,
      baseColour:      e.base,
      packCode:        sibling.packCode,
      unit:            sibling.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       true,
    });
    builtMaterials.add(m);
    builtRows.push({ material: m, product: e.product, baseColour: e.base, packCode: sibling.packCode, unit: sibling.unit, category: sibling.category, sibling: sibling.material });
  }
  console.log(`Built-from-CSV rows (KEEP, no legacy)   : ${builtRows.length}`);

  // ── 2c. Build the 5 alternate Brilliant White GLOSS SKUs (IN28401 series) ──
  // KEEP per the gloss/PU review but ABSENT from legacy AND v2. Built the same
  // way WS built its no-legacy alternates: copy packCode/unit/category from the
  // primary Brilliant White sibling (IN28301 series) of the SAME nominal pack;
  // product=GLOSS, baseColour="BRILLIANT WHITE", isPrimary=false (hidden alt).
  const GLOSS_BW_ALT: Array<{ material: string; pack: string; description: string }> = [
    { material: "IN28401073", pack: "500ML", description: "DN GLOSS BRILLIANT WHITE 500ML" },
    { material: "IN28401072", pack: "1L",    description: "DN GLOSS BRILLIANT WHITE 1L" },
    { material: "IN28401071", pack: "4L",    description: "DN GLOSS BRILLIANT WHITE 4L" },
    { material: "IN28401082", pack: "10L",   description: "DN GLOSS BRILLIANT WHITE 10L" },
    { material: "IN28401081", pack: "20L",   description: "DN GLOSS BRILLIANT WHITE 20L" },
  ];
  let glossAltBuilt = 0;
  for (const alt of GLOSS_BW_ALT) {
    if (seenMaterials.has(alt.material)) continue;          // produced after all → skip
    const sibling = v2Rows.find((r) => r.product === "GLOSS" && r.baseColour === "BRILLIANT WHITE" && formatPack(r.packCode, r.unit) === alt.pack);
    if (!sibling) { console.log(`[gloss-alt] NO SIBLING for ${alt.material} (GLOSS BRILLIANT WHITE ${alt.pack}) — cannot build`); continue; }
    v2Rows.push({
      material:        alt.material,
      description:     alt.description,
      category:        sibling.category,
      product:         "GLOSS",
      baseColour:      "BRILLIANT WHITE",
      packCode:        sibling.packCode,
      unit:            sibling.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       false,
    });
    glossAltBuilt++;
  }
  console.log(`Built GLOSS BW alternates (no legacy, hidden): ${glossAltBuilt}`);

  // ── 2d. SATIN re-key collision guard (2026-06-02) ───────────────────
  // IN28809772 (97 BASE) + 5867120 (93 BASE) move STAY BRIGHT → SUPER SATIN
  // via NAME_OVERRIDES above. If a moved SKU lands on a (baseColour, pack) an
  // existing SUPER SATIN primary already holds, keep the live primary and
  // demote the moved SKU. Scoped to these 2 materials only.
  const SATIN_REKEYS = ["IN28809772", "5867120"];
  for (const m of SATIN_REKEYS) {
    const moved = v2Rows.find((r) => r.material === m);
    if (!moved || !moved.isPrimary) continue;
    const clash = v2Rows.find((r) =>
      r.material !== m && r.product === moved.product && r.baseColour === moved.baseColour &&
      formatPack(r.packCode, r.unit) === formatPack(moved.packCode, moved.unit) && r.isPrimary);
    if (clash) {
      moved.isPrimary = false;
      console.log(`[satin-rekey] ${m} collides with primary ${clash.material} at ${moved.product}/${moved.baseColour}/${formatPack(moved.packCode, moved.unit)} → ${m} set non-primary`);
    } else {
      console.log(`[satin-rekey] ${m} -> ${moved.product}/${moved.baseColour}/${formatPack(moved.packCode, moved.unit)} (no collision, stays primary)`);
    }
  }

  // ── 2e. PROMISE build-from-CSV (2026-06-03) ─────────────────────────
  // The promise-review.csv adds ~85 alternate Promise SKUs absent from legacy
  // (hidden, isPrimary=false). They carry a PROMISE override (product=tab,
  // baseColour) but legacy never produces them. Build each by copying
  // packCode/unit/category from a same-(product,baseColour) primary sibling
  // already in v2Rows; pack matched via the CSV's on-screen pack label.
  const promiseCsvRaw = await fs.readFile(path.join("docs", "SKU", "review", "promise-review.csv"), "utf8");
  const promisePack = new Map<string, string>();   // material -> pack label
  for (const line of promiseCsvRaw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(",");
    const mat = (c[3] ?? "").trim();
    if (mat) promisePack.set(mat, (c[1] ?? "").trim());
  }
  let promiseBuilt = 0, promiseNoSibling = 0;
  for (const [mat, ov] of Object.entries(NAME_OVERRIDES)) {
    if (ov.category !== "PROMISE") continue;
    if (seenMaterials.has(mat) || PROMISE_REMOVE.has(mat)) continue;   // produced by legacy / removed
    const wantPack = promisePack.get(mat);
    const sibling = v2Rows.find((r) =>
      r.product === ov.product && r.baseColour === ov.baseColour &&
      (!wantPack || formatPack(r.packCode, r.unit) === wantPack));
    if (!sibling) { promiseNoSibling++; console.log(`[promise-build] NO SIBLING ${mat} (${ov.product}/${ov.baseColour}/${wantPack ?? "?"})`); continue; }
    v2Rows.push({
      material: mat, description: sibling.description, category: "PROMISE",
      product: ov.product, baseColour: ov.baseColour, packCode: sibling.packCode, unit: sibling.unit,
      refMaterial: null, refDescription: null, paintType: null, materialType: null, piecesPerCarton: null,
      isPrimary: false,
    });
    promiseBuilt++;
  }
  console.log(`Built PROMISE alternates (no legacy, hidden): ${promiseBuilt} (no-sibling: ${promiseNoSibling})`);

  // ── 2f. SADOLIN new-SKU build (Hydro PU — no legacy source) ─────────
  // Any SADOLIN-CSV material the legacy translation did NOT produce is a new
  // insert (today: the 8 Hydro PU rows). Built with full fields from the CSV
  // (packCode/unit parsed from the display pack). Guarded by seenMaterials so a
  // material legacy already produced is re-keyed in the loop, never doubled.
  const sadolinBuilt: string[] = [];
  const sadolinPreexisting: string[] = [];
  for (const [mat, e] of Array.from(sadolin.entries())) {
    if (seenMaterials.has(mat)) { sadolinPreexisting.push(mat); continue; }
    const pk = parsePackLabel(e.pack);
    if (!pk) { console.log(`[sadolin-build] bad pack "${e.pack}" for ${mat} — skipped`); continue; }
    v2Rows.push({
      material:        mat,
      description:     e.description,
      category:        SADOLIN_CATEGORY,
      product:         e.product,
      baseColour:      e.baseColour,
      packCode:        pk.packCode,
      unit:            pk.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       SADOLIN_DEMOTE.has(mat) ? false : e.isPrimary,
    });
    seenMaterials.add(mat);
    sadolinBuilt.push(mat);
  }
  console.log(`SADOLIN: re-keyed ${sadAssigned} existing, built ${sadolinBuilt.length} new [${sadolinBuilt.join(", ")}], ${sadolinPreexisting.length} pre-existing`);

  // ── 2g. TOOLS new-SKU build (no legacy source) ──────────────────────
  // 25 brand-new tool SKUs (rollers packCode "25" / brushes packCode "12",
  // unit "PC"), never in legacy. category "TOOLS", baseColour "". Guarded by
  // seenMaterials (additive — no paint/legacy row touched). piecesPerCarton
  // stays null: carton size rides packCode and the box-step comes from
  // packStepForPack() at render time.
  const toolsBuilt: string[] = [];
  for (const [mat, e] of Array.from(tools.entries())) {
    if (seenMaterials.has(mat)) continue;   // brand-new — never expected in legacy
    v2Rows.push({
      material:        mat,
      description:     e.description,
      category:        TOOLS_CATEGORY,
      product:         e.product,
      baseColour:      "",
      packCode:        e.packCode,
      unit:            e.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       e.isPrimary,
    });
    seenMaterials.add(mat);
    toolsBuilt.push(mat);
  }
  console.log(`TOOLS: built ${toolsBuilt.length} new SKUs [${toolsBuilt.join(", ")}]`);

  // ── 2g.5IN1. PHIROZA inject (no legacy / SAP source) ────────────────
  // 5IN1 Phiroza has only the 1L in legacy (IN56000472, mapped). The 500ML + 4L
  // below are SAP-unverified codes, owner-approved; need SAP creation to bill.
  // Built like Tools 2g; guarded by seenMaterials. category "GLOSS" (= family),
  // product "5IN1 GLOSS", baseColour "PHIROZA".
  const fiveInOnePhirozaInject = [
    { material: "IN56000473", description: "DN 5IN1 PHIROZA 500ML", packCode: "500", unit: "ML" },
    { material: "IN56000471", description: "DN 5IN1 PHIROZA 4L",    packCode: "4",   unit: "L"  },
  ];
  const fiveInOneBuilt: string[] = [];
  for (const e of fiveInOnePhirozaInject) {
    if (seenMaterials.has(e.material)) continue;   // brand-new — never expected in legacy
    v2Rows.push({
      material:        e.material,
      description:     e.description,
      category:        "GLOSS",
      product:         "5IN1 GLOSS",
      baseColour:      "PHIROZA",
      packCode:        e.packCode,
      unit:            e.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       true,
    });
    seenMaterials.add(e.material);
    fiveInOneBuilt.push(e.material);
  }
  console.log(`5IN1 PHIROZA: built ${fiveInOneBuilt.length} new SKUs [${fiveInOneBuilt.join(", ")}]`);

  // ── 2h. SUPERCOVER build-from-CSV (no legacy source) ────────────────
  // 56 of supercover-final.csv's materials are absent from the legacy
  // translation (incl. all four 93 BASE codes 5766355-58, which exist in
  // neither legacy nor v2). Build each from CSV fields (mirrors Sadolin 2f /
  // Tools 2g). Guarded by seenMaterials so a re-keyed material is never
  // doubled. KEEP→isPrimary true, HIDE→isPrimary false (per CSV).
  const superCoverBuilt: string[] = [];
  for (const [mat, e] of Array.from(superCover.entries())) {
    if (seenMaterials.has(mat)) continue;   // produced/re-keyed by legacy after all
    v2Rows.push({
      material:        mat,
      description:     e.description,
      category:        SUPERCOVER_CATEGORY,
      product:         e.product,
      baseColour:      e.baseColour,
      packCode:        e.packCode,
      unit:            e.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       e.isPrimary,
    });
    seenMaterials.add(mat);
    superCoverBuilt.push(mat);
  }
  console.log(`SUPERCOVER: re-keyed ${scAssigned} existing, built ${superCoverBuilt.length} new (expect 34 re-key / 56 build)`);

  // ── 2i. SUPERCLEAN build-from-CSV (no legacy source) ────────────────
  // 31 of superclean-final.csv's materials are absent from legacy (3 KEEP:
  // 5906725 / 5832493 / 5832500; 28 HIDE). Build each from CSV fields (mirrors
  // 2h). seenMaterials-guarded. KEEP→isPrimary true, HIDE→isPrimary false.
  const superCleanBuilt: string[] = [];
  for (const [mat, e] of Array.from(superClean.entries())) {
    if (seenMaterials.has(mat)) continue;   // produced/re-keyed by legacy after all
    v2Rows.push({
      material:        mat,
      description:     e.description,
      category:        SUPERCLEAN_CATEGORY,
      product:         e.product,
      baseColour:      e.baseColour,
      packCode:        e.packCode,
      unit:            e.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       e.isPrimary,
    });
    seenMaterials.add(mat);
    superCleanBuilt.push(mat);
  }
  console.log(`SUPERCLEAN: re-keyed ${sclAssigned} existing, built ${superCleanBuilt.length} new (expect 81 re-key / 31 build)`);

  // ── 2j. TEXTURE/PUTTY build-from-CSV (3 new TEXTURE, no legacy source) ──
  // The 3 new TEXTURE codes (5857610/11/12) are absent from legacy → built here
  // from CSV fields (mirrors Sadolin 2f / SuperCover 2h). The 11 existing PUTTY/
  // TEXTURE materials are re-keyed in the main loop, so seenMaterials guards them
  // out of the build (re-key, never doubled). category = CSV family.
  const texturePuttyBuilt: string[] = [];
  const texturePuttyReKeyed: string[] = [];
  for (const [mat, e] of Array.from(texturePutty.entries())) {
    if (seenMaterials.has(mat)) { texturePuttyReKeyed.push(mat); continue; }
    v2Rows.push({
      material:        mat,
      description:     e.description,
      category:        e.family,
      product:         e.product,
      baseColour:      e.baseColour,
      packCode:        e.packCode,
      unit:            e.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       e.isPrimary,
    });
    seenMaterials.add(mat);
    texturePuttyBuilt.push(mat);
  }
  console.log(`TEXTURE/PUTTY: re-keyed ${texturePuttyReKeyed.length} existing, built ${texturePuttyBuilt.length} new [${texturePuttyBuilt.join(", ")}]`);

  // ── 2k. VT SPECIALTY build-from-CSV (3 new VAF, no legacy source) ──
  // The 3 new VAF codes (IN73509672/772 Trends Glitter Silver/Gold, IN73539303
  // Marble 1KG) are absent from legacy → built here from CSV fields (mirrors the
  // TEXTURE/PUTTY 2j build). Existing VT SPECIALTY materials are re-keyed in the
  // main loop, so seenMaterials guards them out of the build (re-key, never
  // doubled). category = CSV family ("VT SPECIALTY").
  const vtSpecialtyBuilt: string[] = [];
  const vtSpecialtyReKeyed: string[] = [];
  for (const [mat, e] of Array.from(vtSpecialty.entries())) {
    if (seenMaterials.has(mat)) { vtSpecialtyReKeyed.push(mat); continue; }
    v2Rows.push({
      material:        mat,
      description:     e.description,
      category:        e.family,
      product:         e.product,
      baseColour:      e.baseColour,
      packCode:        e.packCode,
      unit:            e.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       e.isPrimary,
    });
    seenMaterials.add(mat);
    vtSpecialtyBuilt.push(mat);
  }
  console.log(`VT SPECIALTY: re-keyed ${vtSpecialtyReKeyed.length} existing, built ${vtSpecialtyBuilt.length} new [${vtSpecialtyBuilt.join(", ")}]`);

  // ── 2l. REMAINING-5 build-from-CSV (7 new codes, no legacy source) ──
  // IN55009272/282/471/482/481 (LUSTRE 92/94 BASE) + 5727751 (FP SIGNAL RED PLUS
  // 10L) + 5727757 (FP FOREST GREEN 10L) are absent from legacy → built here from
  // CSV fields (mirrors the VT 2k build). The 73 existing materials are re-keyed
  // in the main loop, so seenMaterials guards them out (re-key, never doubled).
  const remaining5Built: string[] = [];
  const remaining5ReKeyed: string[] = [];
  for (const [mat, e] of Array.from(remaining5.entries())) {
    if (seenMaterials.has(mat)) { remaining5ReKeyed.push(mat); continue; }
    v2Rows.push({
      material:        mat,
      description:     e.description,
      category:        e.family,
      product:         e.product,
      baseColour:      e.baseColour,
      packCode:        e.packCode,
      unit:            e.unit,
      refMaterial:     null,
      refDescription:  null,
      paintType:       null,
      materialType:    null,
      piecesPerCarton: null,
      isPrimary:       e.isPrimary,
    });
    seenMaterials.add(mat);
    remaining5Built.push(mat);
  }
  console.log(`REMAINING5: re-keyed ${remaining5ReKeyed.length} existing, built ${remaining5Built.length} new [${remaining5Built.join(", ")}]`);
  // HARD STOP: the CSV is complete coverage for these 5 families. Any legacy SKU
  // in TILE/METALLIC/LUSTRE/SMOOTHOVER/FLOOR PLUS not present in the CSV is a bug.
  if (remaining5NotInCsv.length > 0) {
    console.error(`[remaining5] ${remaining5NotInCsv.length} legacy SKU(s) in the 5 families NOT in the CSV — STOPPING: ${remaining5NotInCsv.join(", ")}`);
    throw new Error("remaining5 coverage gap — legacy SKU not in CSV");
  }

  console.log(`Skipped (mapLegacyToNew → null)         : ${skippedNull}`);
  console.log(`Source rows expanded into multiple v2  : ${crossListed}`);
  console.log(`Name-override rows (live names applied) : ${overridden}`);
  console.log(`Excluded — WS Max removed bases         : ${excludedByBase}`);
  console.log(`Excluded — stray material list          : ${excludedByMaterial}`);
  console.log(`Dropped — DISTEMPER not in allowlist     : ${droppedDistemper} (expect 3: 11KG/22KG/Interior)`);
  console.log(`v2 rows after translation              : ${v2Rows.length}`);
  console.log(`isPrimary=false rows (SET_FALSE applied): ${v2Rows.filter((r) => !r.isPrimary).length}`);
  console.log(`CSV-assigned rows (product from CSV)    : ${csvAssigned}`);

  // Rule 5: CSV materials with no legacy source AND not built-from-CSV.
  // HIDE-missing are expected (already absent = hidden); KEEP-missing should be 0
  // after build-from-CSV.
  const csvMissing     = Array.from(csvProduct.keys()).filter((m) => !seenMaterials.has(m) && !builtMaterials.has(m) && !PROTECT_DELETE.has(m) && !POWERFLEXX_DROP.has(m));
  const csvMissingKeep = csvMissing.filter((m) => csvProduct.get(m)!.isPrimary);
  const csvMultiProduct = Array.from(csvProduct.entries()).filter(([, e]) => e.products.size > 1);
  console.log(`CSV materials with NO legacy source     : ${csvMissing.length} (KEEP=${csvMissingKeep.length}, HIDE=${csvMissing.length - csvMissingKeep.length})`);
  console.log(`CSV materials in >1 target CSV          : ${csvMultiProduct.length}`);

  // ── 3. Dedup on (material, category, product, baseColour, packCode) ─
  // Defensive — the suffix scheme makes material globally unique per
  // (legacy.material, family), so duplicates here would indicate a
  // translator quirk worth surfacing.
  const seen    = new Set<string>();
  const deduped: V2Row[] = [];
  let   dropped = 0;
  for (const row of v2Rows) {
    const key = `${row.material}|||${row.category}|||${row.product}|||${row.baseColour}|||${row.packCode}`;
    if (seen.has(key)) {
      dropped++;
      console.log(`[dedup] ${row.material} | ${row.category} | ${row.product} | ${row.baseColour} | ${row.packCode} (kept first)`);
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  console.log(`v2 rows after dedup                    : ${deduped.length} (dropped ${dropped})`);

  // ── 3.5. DRY-RUN exit — projected summary, NO wipe / NO insert ──────
  // Mirrors the MENU seed (v2-catalog-seed-from-preview.ts): everything is
  // computed above; here we print the projection and RETURN *before* the
  // unconditional wipe + insert below. DRY_RUN=1 → zero DB writes.
  if (DRY_RUN) {
    const falseCount = deduped.filter((r) => !r.isPrimary).length;
    const wsMax      = deduped.filter((r) => r.product === "WS MAX");
    const wsBases    = Array.from(new Set(wsMax.map((r) => r.baseColour))).sort();
    const flip       = deduped.find((r) => r.material === "IN46359471");
    const stray      = deduped.find((r) => r.material === "IN46350082");
    console.log("");
    console.log("════════════════ SKU DRY-RUN SUMMARY ════════════════");
    console.log(`Legacy rows read              : ${legacyRows.length}`);
    console.log(`Skipped (mapLegacyToNew null) : ${skippedNull}`);
    console.log(`Excluded — WS Max bases       : ${excludedByBase}`);
    console.log(`Excluded — stray material     : ${excludedByMaterial} (IN46350082)`);
    console.log(`Excluded — total              : ${excludedByBase + excludedByMaterial}`);
    console.log(`Rows that WOULD be inserted   : ${deduped.length}`);
    console.log(`isPrimary=false (projected)   : ${falseCount}`);
    console.log("");
    console.log(`WS MAX bases kept (${wsBases.length}): ${wsBases.join(", ")}`);
    console.log(`IN46359471 (94 BASE 3.6L)     : ${flip ? `present, isPrimary=${flip.isPrimary}` : "ABSENT"} (expect: present, false)`);
    console.log(`IN46350082 (BW 10L stray)     : ${stray ? "STILL PRESENT (unexpected!)" : "excluded ✓"}`);

    // ── WS RESTRUCTURE REHEARSAL (before vs after) ──────────────────
    const liveRows = await prisma.mo_sku_lookup_v2.findMany({ select: { product: true, isPrimary: true, material: true, category: true } });
    const agg = (rows: { product: string; isPrimary: boolean }[], prod: string) => {
      const r = rows.filter((x) => x.product === prod);
      return { n: r.length, pri: r.filter((x) => x.isPrimary).length };
    };
    const TARGETS = ["WS PROTECT DUSTPROOF", "WS PROTECT RAINPROOF", "WS POWERFLEXX", "WS PROTECT HI-SHEEN", "GLOSS", "PU ENAMEL", "SUPER SATIN", "SATIN STAY BRIGHT", "PROMISE INTERIOR", "PROMISE SHEEN INTERIOR", "PROMISE EXTERIOR", "PROMISE SHEEN EXTERIOR", "PROMISE PRIMER", "PROMISE SMARTCHOICE", "SUPERCOVER", "SUPERCOVER SHEEN", "SUPERCLEAN", "SUPERCLEAN 3IN1", "ACRYLIC DISTEMPER", "MAGIK", "ACRYLIC PUTTY", "POLYPUTTY", "TEXTURE", "TEXTURE 2MM", "TEXTURE 3MM", "MATT", "VAF", "VT CONCRETE FINISH", "VELVETINO", "VT MARBLE", "VT CLEAR COAT", "VT FIN", "VT METALLICS", "AMBIANCE", "LUXURY FINISHES"];
    console.log("");
    console.log("════════════ WS RESTRUCTURE REHEARSAL (before → after) ════════════");
    for (const t of TARGETS) {
      const b = agg(liveRows, t); const a = agg(deduped, t);
      console.log(`  ${t.padEnd(22)} before n=${b.n} (pri ${b.pri}/hid ${b.n - b.pri})  ->  after n=${a.n} (pri ${a.pri}/hid ${a.n - a.pri})`);
    }
    console.log(`  ${"WS PROTECT (plain WRONG)".padEnd(22)} before n=${agg(liveRows, "WS PROTECT").n}  ->  after n=${agg(deduped, "WS PROTECT").n}  (expect 0)`);
    console.log(`  ${"WS PROTECT CLEAR".padEnd(22)} before n=${agg(liveRows, "WS PROTECT CLEAR").n}  ->  after n=${agg(deduped, "WS PROTECT CLEAR").n}  (untouched)`);
    const COLOURS = ["5819365", "5819366", "5819257", "5819358", "5819369", "5819370", "5819361", "5819362", "5819373", "5819374"];
    const colourRows = deduped.filter((r) => COLOURS.includes(r.material));
    const colourOk = colourRows.filter((r) => r.product === "WS PROTECT DUSTPROOF" && r.isPrimary).length;
    console.log(`  Re-homed colours → DUSTPROOF primary: ${colourOk}/10 (present ${colourRows.length}/10)`);
    const bPresent = deduped.filter((r) => PROTECT_DELETE.has(r.material)).length;
    console.log(`  Group-B (9 deletes) present after: ${bPresent} (expect 0)`);
    const pf = deduped.find((r) => r.material === "IN76109271");
    console.log(`  IN76109271 (Powerflexx, only-in-live): ${pf ? `PRESENT product=${pf.product} isPrimary=${pf.isPrimary}` : "DROPPED"}`);
    console.log(`  Rule-5 CSV materials with no legacy source: ${csvMissing.length} (KEEP=${csvMissingKeep.length}, expect KEEP=0)`);
    if (csvMissingKeep.length) console.log(`     KEEP-but-missing: ${csvMissingKeep.join(", ")}`);
    console.log(`  Built-from-CSV (${builtRows.length}):`);
    for (const b of builtRows) console.log(`     ${b.material} -> ${b.product} | ${b.baseColour} | packCode=${b.packCode}${b.unit ?? ""} | cat=${b.category} | sibling=${b.sibling}`);
    const has = (mat: string) => { const r = deduped.find((x) => x.material === mat); return r ? `present (product=${r.product}, base=${r.baseColour}, primary=${r.isPrimary})` : "ABSENT"; };
    const vred = deduped.filter((r) => r.product === "WS PROTECT DUSTPROOF" && r.baseColour === "99 BASE");
    console.log(`  99 BASE (Vibrant Red) under DUSTPROOF: ${vred.length} rows, primary ${vred.filter((r) => r.isPrimary).length}`);
    console.log(`  5880419 (Dustproof 95 BASE 1L): ${has("5880419")}`);
    console.log(`  5769796 (Powerflexx 93 BASE 4L): ${has("5769796")}`);

    // Dustproof per-base primary breakdown + the 4 rescued 93-Base SKUs.
    const dp = deduped.filter((r) => r.product === "WS PROTECT DUSTPROOF");
    const byBase = new Map<string, { n: number; pri: number }>();
    for (const r of dp) {
      const e = byBase.get(r.baseColour) ?? { n: 0, pri: 0 };
      e.n++; if (r.isPrimary) e.pri++; byBase.set(r.baseColour, e);
    }
    console.log(`  DUSTPROOF per-base (base: primary/total):`);
    for (const b of Array.from(byBase.keys()).sort()) {
      const e = byBase.get(b)!;
      console.log(`     ${b.padEnd(20)} ${e.pri}/${e.n}`);
    }
    const RESCUE93 = ["5880417", "5880390", "5880393", "5880392"];
    console.log(`  Rescued 93-Base SKUs:`);
    for (const m of RESCUE93) console.log(`     ${m}: ${has(m)}`);
    const maxB = agg(liveRows, "WS MAX"); const maxA = agg(deduped, "WS MAX");
    console.log(`  Total rows: before ${liveRows.length}  ->  after ${deduped.length}`);
    console.log(`  WS MAX: before n=${maxB.n}  ->  after n=${maxA.n}  (expect steady)`);

    // ── PROMISE root-cause rehearsal (2026-06-03) ──────────────────────
    // Simulate the route's NEW display-size dedup (formatPack), the same key
    // both /api/order/data and /api/place-order/data now use.
    const routePacks = (prod: string, base: string): string[] => {
      const rows = deduped.filter((r) => r.product === prod && r.baseColour === base);
      const seenSz = new Set<string>();
      const out: Array<{ lbl: string; ml: number }> = [];
      for (const r of rows) {
        const lbl = formatPack(r.packCode, r.unit);
        if (seenSz.has(lbl)) continue;
        seenSz.add(lbl);
        out.push({ lbl, ml: packToMl(r.packCode, r.unit) });
      }
      return out.sort((a, b) => a.ml - b.ml).map((x) => x.lbl);
    };
    console.log("");
    console.log("════════════ PROMISE ROOT-CAUSE FIXES (DRY-RUN) ════════════");
    console.log(`  Units "LT"/"LTR" → "L" normalized (catalog-wide): ${unitsNormalized}`);
    console.log(`  Promise fractional → nominal pack (0.925/3.7/9.25/18.5): ${fractionalNormalized}`);
    console.log(`  Mis-keyed 22 → 20 (Promise litre rule): ${miskeyedFixed}`);
    console.log(`  Umbrella -PROMISE stock dupes dropped: ${droppedUmbrella}`);
    const promiseSuffix = deduped.filter((r) => r.material.endsWith("-PROMISE")).length;
    const has61 = deduped.some((r) => r.material === "5883561-PROMISE");
    const has76 = deduped.some((r) => r.material === "5838876-PROMISE");
    console.log(`  Remaining "-PROMISE" stock rows: ${promiseSuffix} (5883561-PROMISE: ${has61}, 5838876-PROMISE: ${has76}) [expect 0 / false / false]`);
    console.log(`  Stock rows after fixes: ${deduped.length} (was 1712 live)`);
    console.log(`  93 BASE across 4 emulsion tabs (expect 1L, 4L, 10L, 20L):`);
    for (const p of ["PROMISE INTERIOR", "PROMISE SHEEN INTERIOR", "PROMISE EXTERIOR", "PROMISE SHEEN EXTERIOR"]) {
      console.log(`     ${p.padEnd(24)} ${routePacks(p, "93 BASE").join(", ")}`);
    }
    console.log(`  Focus bases — route display-size dedup (expect one column per size, no dup/alien/22L):`);
    const FOCUS: Array<[string, string]> = [
      ["PROMISE INTERIOR", "92 BASE"], ["PROMISE INTERIOR", "93 BASE"],
      ["PROMISE EXTERIOR", "BRILLIANT WHITE"], ["PROMISE EXTERIOR", "93 BASE"],
      ["PROMISE EXTERIOR", "94 BASE"], ["PROMISE EXTERIOR", "96 BASE"], ["PROMISE EXTERIOR", "98 BASE"],
    ];
    for (const [p, b] of FOCUS) console.log(`     ${`${p} | ${b}`.padEnd(34)} ${routePacks(p, b).join(", ")}`);
    console.log(`  Other-family spot-check (display-size dedup; expect clean standard sets, nothing real lost):`);
    for (const [p, b] of [["WS MAX", "90 BASE"], ["GLOSS", "BRILLIANT WHITE"], ["SUPER SATIN", "BRILLIANT WHITE"]] as Array<[string, string]>) {
      console.log(`     ${`${p} | ${b}`.padEnd(34)} ${routePacks(p, b).join(", ")}`);
    }

    // ── AQUATECH rebuild stock verification (2026-06-04) ──
    const aquaStock = deduped.filter((r) => r.category === "AQUATECH");
    console.log("");
    console.log("════════════ AQUATECH STOCK REBUILD ════════════");
    console.log(`  AQUATECH category SKUs (after): ${aquaStock.length} (expect 63)`);
    const byProd = new Map<string, { n: number; pri: number }>();
    for (const r of aquaStock) {
      const e = byProd.get(r.product) ?? { n: 0, pri: 0 };
      e.n++; if (r.isPrimary) e.pri++; byProd.set(r.product, e);
    }
    console.log(`  AQUATECH per-product (product: primary/total), ${byProd.size} products:`);
    for (const p of Array.from(byProd.keys()).sort()) {
      const e = byProd.get(p)!;
      console.log(`     ${p.padEnd(26)} ${e.pri}/${e.n}`);
    }
    const wp = deduped.find((r) => r.material === "5576088");
    console.log(`  5576088 Waterproof Putty: ${wp ? `product="${wp.product}" category="${wp.category}" pri=${wp.isPrimary}` : "ABSENT"} (expect category AQUATECH)`);
    const puCoat = deduped.filter((r) => r.material === "5748677" || r.material === "5748708");
    console.log(`  PU Coat present: ${puCoat.length}/2 -> ${JSON.stringify(puCoat.map((r) => `${r.material}:${r.product}`))}`);
    const ibOld = deduped.filter((r) => ["5688020", "5688021", "5688022", "5688023"].includes(r.material));
    const ibNew = deduped.filter((r) => ["9075187", "9075189", "9075190", "9075191"].includes(r.material));
    console.log(`  Interior Basecoat OLD (5688020-23): product(s)=${JSON.stringify(Array.from(new Set(ibOld.map((r) => r.product))))} primary=${ibOld.filter((r) => r.isPrimary).length}/${ibOld.length}`);
    console.log(`  Interior Basecoat NEW (9075187/89/90/91): product(s)=${JSON.stringify(Array.from(new Set(ibNew.map((r) => r.product))))} primary=${ibNew.filter((r) => r.isPrimary).length}/${ibNew.length} (expect 0/4)`);
    const eternaAfter = deduped.filter((r) => r.product === "ETERNA").length;
    const eternaLive  = liveRows.filter((r) => r.product === "ETERNA").length;
    console.log(`  ETERNA product SKUs: before ${eternaLive} -> after ${eternaAfter} (expect unchanged)`);
    const wpInPutty = deduped.filter((r) => r.category === "PUTTY").length;
    const wpInPuttyLive = "(n/a — live lacks category in this select)";
    console.log(`  PUTTY category SKUs (after): ${wpInPutty} ${wpInPuttyLive}`);

    // ── SADOLIN rebuild verification (2026-06-04) ──
    const sad = deduped.filter((r) => r.category === "SADOLIN");
    console.log("");
    console.log("════════════ SADOLIN STOCK REBUILD ════════════");
    console.log(`  SADOLIN category SKUs (after): ${sad.length} (expect 154)`);
    const sadByProd = new Map<string, { n: number; pri: number }>();
    for (const r of sad) { const e = sadByProd.get(r.product) ?? { n: 0, pri: 0 }; e.n++; if (r.isPrimary) e.pri++; sadByProd.set(r.product, e); }
    console.log(`  SADOLIN per-product (product: primary/total), ${sadByProd.size} products:`);
    for (const p of Array.from(sadByProd.keys()).sort()) { const e = sadByProd.get(p)!; console.log(`     ${p.padEnd(26)} ${e.pri}/${e.n}`); }
    // bare finish-label products must be GONE
    const BARE = new Set(["GLOSS", "MATT", "SEALER", "BASE", "COLOUR"]);
    const bareLeft = sad.filter((r) => BARE.has(r.product));
    console.log(`  Sadolin rows on a bare GLOSS/MATT/SEALER/BASE/COLOUR product: ${bareLeft.length} (expect 0)`);
    for (const r of bareLeft) console.log(`     LEFTOVER ${r.material} product="${r.product}"`);
    // none may resolve to the enamel GLOSS family product
    console.log(`  Any Sadolin row with product exactly "GLOSS" (enamel family): ${sad.filter((r) => r.product === "GLOSS").length} (expect 0)`);
    // spot-checks
    const spot = (prod: string, base: string) => {
      const rs = sad.filter((r) => r.product === prod && (base === "*" || r.baseColour === base));
      console.log(`     ${prod} ${base === "*" ? "" : `/ ${base}`} -> ${rs.length} rows [${rs.map((r) => `${r.material}:${r.packCode}${r.unit ?? ""}`).join(", ")}]`);
    };
    console.log("  Spot-checks:");
    spot("2K PU GLOSS", "90 Base"); spot("HYDRO PU GLOSS", "Int Clear"); spot("HYDRO PU DEAD MATT", "Int Clear");
    spot("HYDRO PU SEALER", "Clear"); spot("LUXURIO MATT", "Clear"); spot("1K PU GLOSS", "Clear");
    spot("SYNTHETIC VARNISH", "Clear"); spot("NC CLEAR LACQUER", "Clear"); spot("WOOD FILLER", "*");
    // Hydro built vs pre-existing
    console.log(`  Hydro PU built (new inserts): ${sadolinBuilt.length} -> [${sadolinBuilt.join(", ")}]`);
    console.log(`  Sadolin pre-existing (re-keyed from legacy): ${sadolinPreexisting.length}`);
    // data fixes
    const showFix = (m: string) => { const r = deduped.find((x) => x.material === m); console.log(`     ${m}: ${r ? `product="${r.product}" base="${r.baseColour}" ${r.packCode}${r.unit ?? ""} pri=${r.isPrimary}` : "ABSENT"}`); };
    console.log("  Data fixes:");
    showFix("IN20109673"); showFix("IN20109173"); showFix("IN35203203"); showFix("IN35202003"); showFix("IN35203003"); showFix("IN35521429");
    // (product, baseColour, pack) collisions with >1 primary (CSV-driven; report only)
    const collide = new Map<string, string[]>();
    for (const r of sad) { if (!r.isPrimary) continue; const k = `${r.product}|${r.baseColour}|${r.packCode}${r.unit ?? ""}`; (collide.get(k) ?? collide.set(k, []).get(k)!).push(r.material); }
    const dupPrimary = Array.from(collide.entries()).filter(([, m]) => m.length > 1);
    console.log(`  (product,base,pack) with >1 primary (CSV-as-source; report only): ${dupPrimary.length}`);
    for (const [k, m] of dupPrimary) console.log(`     ${k} -> ${JSON.stringify(m)}`);
    // totals
    // ── SUPERCOVER rebuild verification (2026-06-09) ──
    const scRows = deduped.filter((r) => r.category === "SUPERCOVER");
    const scBuiltSet = new Set(superCoverBuilt);
    const scReKey = Array.from(superCover.keys()).filter((m) => !scBuiltSet.has(m));
    const scInjVisible = superCoverBuilt.filter((m) => superCover.get(m)!.isPrimary).length;
    const scInjHidden  = superCoverBuilt.length - scInjVisible;
    const scBefore = liveRows.filter((r) => r.product === "SUPERCOVER" || r.product === "SUPERCOVER SHEEN").length;
    console.log("");
    console.log("════════════ SUPERCOVER STOCK REBUILD ════════════");
    console.log(`  SUPERCOVER category SKUs: before ${scBefore} -> after ${scRows.length} (delta +${scRows.length - scBefore})`);
    console.log(`  Re-key (existing CSV codes touched): ${scReKey.length} (expect 34)`);
    console.log(`  Inject (build-from-CSV): ${superCoverBuilt.length} (expect 56) — visible ${scInjVisible} / hidden ${scInjHidden}`);
    const scShow = (m: string) => { const r = deduped.find((x) => x.material === m); return r ? `base=${r.baseColour} ${r.packCode}${r.unit ?? ""} pri=${r.isPrimary}` : "ABSENT"; };
    console.log(`  YELLOW BASE → 96 BASE re-home (2 codes):`);
    console.log(`     IN27309672: ${scShow("IN27309672")} (expect base 96 BASE)`);
    console.log(`     IN27309671: ${scShow("IN27309671")} (expect base 96 BASE)`);
    console.log(`  isPrimary flips — 92 BASE 1L:`);
    console.log(`     5853018    ${scShow("5853018")} (expect pri=true)`);
    console.log(`     5853033    ${scShow("5853033")} (expect pri=false)`);
    console.log(`     IN27309223 ${scShow("IN27309223")} (expect pri=false)`);
    console.log(`  isPrimary flips — Sheen 92 BASE 1L:`);
    console.log(`     IN27909272 ${scShow("IN27909272")} (expect pri=true)`);
    console.log(`     IN27909223 ${scShow("IN27909223")} (stray, expect pri=false)`);
    for (const prod of ["SUPERCOVER", "SUPERCOVER SHEEN"]) {
      const rs = scRows.filter((r) => r.product === prod);
      const byBase = new Map<string, { n: number; pri: number }>();
      for (const r of rs) { const e = byBase.get(r.baseColour) ?? { n: 0, pri: 0 }; e.n++; if (r.isPrimary) e.pri++; byBase.set(r.baseColour, e); }
      console.log(`  ${prod} per-base (base: primary/total), ${rs.length} rows:`);
      for (const b of Array.from(byBase.keys()).sort()) { const e = byBase.get(b)!; console.log(`     ${b.padEnd(18)} ${e.pri}/${e.n}`); }
    }
    const scUnresolved = Array.from(superCover.keys()).filter((m) => !deduped.some((r) => r.material === m));
    console.log(`  CSV SAP unresolved (not in final set): ${scUnresolved.length} (expect 0)${scUnresolved.length ? " -> " + scUnresolved.join(", ") : ""}`);

    // ── SUPERCLEAN rebuild verification (2026-06-09) ──
    const sclRows = deduped.filter((r) => r.category === "SUPERCLEAN");
    const sclBuiltSet = new Set(superCleanBuilt);
    const sclReKey = Array.from(superClean.keys()).filter((m) => !sclBuiltSet.has(m));
    const sclInjVisible = superCleanBuilt.filter((m) => superClean.get(m)!.isPrimary).length;
    const sclInjHidden  = superCleanBuilt.length - sclInjVisible;
    const sclBefore = liveRows.filter((r) => r.product === "SUPERCLEAN" || r.product === "SUPERCLEAN 3IN1").length;
    console.log("");
    console.log("════════════ SUPERCLEAN STOCK REBUILD ════════════");
    console.log(`  SUPERCLEAN category SKUs: before ${sclBefore} -> after ${sclRows.length} (delta +${sclRows.length - sclBefore})`);
    console.log(`  Re-key (existing CSV codes touched): ${sclReKey.length} (expect 81)`);
    console.log(`  Inject (build-from-CSV): ${superCleanBuilt.length} (expect 31) — visible ${sclInjVisible} / hidden ${sclInjHidden}`);
    const sclShow = (m: string) => { const r = deduped.find((x) => x.material === m); return r ? `${r.product} base=${r.baseColour} ${r.packCode}${r.unit ?? ""} pri=${r.isPrimary}` : "ABSENT"; };
    console.log(`  KEEP injects (expect pri=true):`);
    console.log(`     5906725 ${sclShow("5906725")} (95 BASE 1L)`);
    console.log(`     5832493 ${sclShow("5832493")} (94 BASE 10L)`);
    console.log(`     5832500 ${sclShow("5832500")} (94 BASE 20L)`);
    console.log(`  Stray IN23809482 ${sclShow("IN23809482")} (expect pri=false)`);
    for (const prod of ["SUPERCLEAN", "SUPERCLEAN 3IN1"]) {
      const rs = sclRows.filter((r) => r.product === prod);
      const byBP = new Map<string, { n: number; pri: number }>();
      for (const r of rs) { const k = `${r.baseColour}|${r.packCode}${r.unit ?? ""}`; const e = byBP.get(k) ?? { n: 0, pri: 0 }; e.n++; if (r.isPrimary) e.pri++; byBP.set(k, e); }
      const doubles = Array.from(byBP.values()).filter((e) => e.pri !== 1).length;
      console.log(`  ${prod} per base+pack (pri/total), ${rs.length} rows, ${doubles} not-exactly-1-primary:`);
      for (const k of Array.from(byBP.keys()).sort()) { const e = byBP.get(k)!; const flag = e.pri !== 1 ? (e.pri === 0 ? " ZERO!" : " DOUBLE!") : ""; console.log(`     ${k.padEnd(26)} ${e.pri}/${e.n}${flag}`); }
    }
    const sclUnresolved = Array.from(superClean.keys()).filter((m) => !deduped.some((r) => r.material === m));
    console.log(`  CSV SAP unresolved (not in final set): ${sclUnresolved.length} (expect 0)${sclUnresolved.length ? " -> " + sclUnresolved.join(", ") : ""}`);

    // ── DISTEMPER allowlist rehearsal (2026-06-12) ──
    console.log("");
    console.log("════════════ DISTEMPER ALLOWLIST REHEARSAL ════════════");
    const distLive  = liveRows.filter((r) => r.category === "DISTEMPER");
    const distFinal = deduped.filter((r) => r.category === "DISTEMPER");
    console.log(`  DISTEMPER stock: before ${distLive.length} -> after ${distFinal.length} (expect 16 -> 13, -3)`);
    for (const m of ["IN87109011", "IN87109022", "5862521"]) {
      const present = deduped.some((r) => r.material === m);
      console.log(`  drop ${m.padEnd(12)}: ${present ? "STILL PRESENT (FAIL)" : "dropped (not hidden) OK"}`);
    }
    // Pack resolution per the 3 menu join keys (product|||baseColour).
    const resolve = (product: string, base: string): string => {
      const rows = distFinal.filter((r) => r.product === product && r.baseColour === base && r.isPrimary);
      const packs = rows.map((r) => formatPack(r.packCode, r.unit)).sort();
      return `${rows.length} primary [${packs.join(", ")}]`;
    };
    console.log(`  Duwell  (ACRYLIC DISTEMPER|||DUWEL ACRYLIC DISTEMPER): ${resolve("ACRYLIC DISTEMPER", "DUWEL ACRYLIC DISTEMPER")}`);
    console.log(`  Magik90 (MAGIK|||90 BASE)                            : ${resolve("MAGIK", "90 BASE")}`);
    console.log(`  MagikBW (MAGIK|||BRILLIANT WHITE)                    : ${resolve("MAGIK", "BRILLIANT WHITE")}`);
    const distPrimary = distFinal.filter((r) => r.isPrimary).length;
    console.log(`  isPrimary=true rows: ${distPrimary}/${distFinal.length} (expect 13/13)`);
    const distMatCounts = new Map<string, number>();
    for (const r of distFinal) distMatCounts.set(r.material, (distMatCounts.get(r.material) ?? 0) + 1);
    const distCrossList = Array.from(distMatCounts.values()).filter((n) => n > 1).length;
    console.log(`  Cross-list (SAP under >1 row): ${distCrossList} (expect 0)`);

    // ── TEXTURE / PUTTY rebuild rehearsal (2026-06-12) ──
    console.log("");
    console.log("════════════ TEXTURE / PUTTY REBUILD ════════════");
    const puttyFinal = deduped.filter((r) => r.category === "PUTTY");
    const texFinal   = deduped.filter((r) => r.category === "TEXTURE");
    const puttyLive  = liveRows.filter((r) => r.category === "PUTTY").length;
    const texLive    = liveRows.filter((r) => r.category === "TEXTURE").length;
    console.log(`  PUTTY  : before ${puttyLive} -> after ${puttyFinal.length} (expect 6 -> 6)`);
    console.log(`  TEXTURE: before ${texLive} -> after ${texFinal.length} (expect 5 -> 8, +3 new)`);
    console.log(`  Re-keyed existing (loop): ${tpAssigned} (expect 11) | built new: ${texturePuttyBuilt.length} (expect 3) [${texturePuttyBuilt.join(", ")}]`);
    console.log(`  New TEXTURE codes — path each took:`);
    for (const m of ["5857610", "5857611", "5857612"]) {
      const r = deduped.find((x) => x.material === m);
      const built = texturePuttyBuilt.includes(m);
      console.log(`     ${m}: ${r ? `product="${r.product}" base="${r.baseColour}" ${r.packCode}${r.unit ?? ""} pri=${r.isPrimary} [${built ? "CREATED (no legacy)" : "RE-KEYED from legacy"}]` : "ABSENT (FAIL)"}`);
    }
    const tpBreak = (cat: string) => {
      const rs = deduped.filter((r) => r.category === cat);
      const byk = new Map<string, { n: number; pri: number }>();
      for (const r of rs) { const k = `${r.product}|${r.baseColour}|${formatPack(r.packCode, r.unit)}`; const e = byk.get(k) ?? { n: 0, pri: 0 }; e.n++; if (r.isPrimary) e.pri++; byk.set(k, e); }
      for (const k of Array.from(byk.keys()).sort()) { const e = byk.get(k)!; console.log(`     ${k.padEnd(44)} ${e.pri}/${e.n}`); }
    };
    console.log(`  PUTTY (product|base|pack: primary/total):`); tpBreak("PUTTY");
    console.log(`  TEXTURE (product|base|pack: primary/total):`); tpBreak("TEXTURE");
    console.log(`  POLYPUTTY primaries: [${deduped.filter((r) => r.product === "POLYPUTTY" && r.isPrimary).map((r) => r.material).join(", ")}] (expect 5578774)`);
    console.log(`  MATT demoted (expect all false): ${["IN43109881", "IN43109981", "IN41250620"].map((m) => { const r = deduped.find((x) => x.material === m); return `${m}=${r ? r.isPrimary : "ABSENT"}`; }).join(", ")}`);
    console.log(`  PUTTY/TEXTURE natives NOT in CSV (report only, kept): ${texturePuttyNotInCsv.length}${texturePuttyNotInCsv.length ? " -> " + texturePuttyNotInCsv.join(", ") : ""} (expect 0)`);

    // ── VT SPECIALTY rebuild rehearsal (2026-06-13) ──
    console.log("");
    console.log("════════════ VT SPECIALTY REBUILD ════════════");
    const vtFinal = deduped.filter((r) => r.category === "VT SPECIALTY");
    const vtLive  = liveRows.filter((r) => r.category === "VT SPECIALTY").length;
    console.log(`  VT SPECIALTY: before ${vtLive} -> after ${vtFinal.length} (re-key ${vtAssigned} + build ${vtSpecialtyBuilt.length})`);
    console.log(`  3 new VAF codes — path each took:`);
    for (const m of ["IN73509672", "IN73509772", "IN73539303"]) {
      const r = deduped.find((x) => x.material === m);
      const built = vtSpecialtyBuilt.includes(m);
      console.log(`     ${m}: ${r ? `product="${r.product}" base="${r.baseColour}" ${r.packCode}${r.unit ?? ""} pri=${r.isPrimary} [${built ? "CREATED (no legacy)" : "RE-KEYED from legacy"}]` : "ABSENT (FAIL)"}`);
    }
    const vtVisible = vtFinal.filter((r) => r.isPrimary);
    const vtHidden  = vtFinal.filter((r) => !r.isPrimary);
    console.log(`  VISIBLE (isPrimary=true): ${vtVisible.length} (expect 14) | HIDDEN (isPrimary=false): ${vtHidden.length} (expect 18)`);
    const vtByProd = new Map<string, { n: number; pri: number }>();
    for (const r of vtFinal) { const e = vtByProd.get(r.product) ?? { n: 0, pri: 0 }; e.n++; if (r.isPrimary) e.pri++; vtByProd.set(r.product, e); }
    console.log(`  VT SPECIALTY per-product (product: primary/total), ${vtByProd.size} products:`);
    for (const p of Array.from(vtByProd.keys()).sort()) { const e = vtByProd.get(p)!; console.log(`     ${p.padEnd(20)} ${e.pri}/${e.n}`); }
    console.log(`  HIDDEN products demoted (expect all pri=false): VT FIN/VT METALLICS/AMBIANCE/LUXURY FINISHES`);
    for (const p of ["VT FIN", "VT METALLICS", "AMBIANCE", "LUXURY FINISHES"]) {
      const rs = vtFinal.filter((r) => r.product === p);
      const anyPri = rs.filter((r) => r.isPrimary).length;
      console.log(`     ${p.padEnd(20)} ${rs.length} rows, primary=${anyPri} (expect 0)`);
    }
    console.log(`  VT SPECIALTY natives NOT in CSV (report only, kept): ${vtSpecialtyNotInCsv.length}${vtSpecialtyNotInCsv.length ? " -> " + vtSpecialtyNotInCsv.join(", ") : ""}`);

    // ── REMAINING-5 rebuild rehearsal (2026-06-14) ──
    console.log("");
    console.log("════════════ REMAINING-5 REBUILD (TILE/METALLIC/LUSTRE/SMOOTHOVER/FLOOR PLUS) ════════════");
    console.log(`  Re-keyed existing: ${rem5Assigned} | built new: ${remaining5Built.length} (expect 73 / 7)`);
    console.log(`  7 new codes — path each took:`);
    for (const m of ["IN55009272", "IN55009282", "IN55009471", "IN55009482", "IN55009481", "5727751", "5727757"]) {
      const r = deduped.find((x) => x.material === m);
      const built = remaining5Built.includes(m);
      console.log(`     ${m}: ${r ? `${r.category}/${r.product}/${r.baseColour} ${r.packCode}${r.unit ?? ""} pri=${r.isPrimary} [${built ? "CREATED (no legacy)" : "RE-KEYED"}]` : "ABSENT (FAIL)"}`);
    }
    for (const fam of ["TILE", "METALLIC", "LUSTRE", "SMOOTHOVER", "FLOOR PLUS"]) {
      const rs = deduped.filter((r) => r.category === fam);
      const live = liveRows.filter((r) => r.category === fam).length;
      const pri = rs.filter((r) => r.isPrimary).length;
      const bases = Array.from(new Set(rs.filter((r) => r.isPrimary).map((r) => r.baseColour))).sort();
      console.log(`  ${fam.padEnd(11)} before ${live} -> after ${rs.length} (primary ${pri}/${rs.length}) | primary bases: [${bases.join(", ")}]`);
    }
    // demotions (CSV isPrimary=false)
    const demoted = deduped.filter((r) => REMAINING5_FAMILIES.has(r.category) && !r.isPrimary);
    console.log(`  Demotions (isPrimary=false, kept in DB): ${demoted.length} -> [${demoted.map((r) => r.material).join(", ")}]`);
    console.log(`  REMAINING-5 legacy NOT in CSV (HARD STOP if >0): ${remaining5NotInCsv.length}`);

    console.log("");
    console.log(`  TOTAL stock rows after rebuild: ${deduped.length} (expect ${1696 + vtSpecialtyBuilt.length + remaining5Built.length + fiveInOneBuilt.length} = 1696 [incl. SPRAY PAINT +11, M900 GLOSS +12, 5IN1 mapped +26] + ${vtSpecialtyBuilt.length} VtSpecialty + ${remaining5Built.length} Remaining5 + ${fiveInOneBuilt.length} 5in1Phiroza)`);

    console.log("");
    console.log("DRY_RUN=1 — NO wipe, NO insert performed.");
    return;
  }

  // ── 4. Wipe v2 SKU table ────────────────────────────────────────────
  const wipeResult = await prisma.mo_sku_lookup_v2.deleteMany({});
  console.log(`Rows wiped from mo_sku_lookup_v2       : ${wipeResult.count}`);

  // ── 5. Insert in batches of 100 via createMany ──────────────────────
  // Sequential awaits — no prisma.$transaction array.
  let inserted = 0;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const slice  = deduped.slice(i, i + BATCH_SIZE);
    const result = await prisma.mo_sku_lookup_v2.createMany({
      data:           slice,
      skipDuplicates: false,
    });
    inserted += result.count;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1} inserted ${result.count} rows (running total: ${inserted})`);
  }

  // ── 6. Verification ─────────────────────────────────────────────────
  const finalCount = await prisma.mo_sku_lookup_v2.count();
  const matches    = finalCount === inserted;

  const byFamily = await prisma.mo_sku_lookup_v2.groupBy({
    by:      ["category"],
    _count:  { _all: true },
    orderBy: { category: "asc" },
  });

  const stainerByProduct = await prisma.mo_sku_lookup_v2.groupBy({
    by:      ["product"],
    where:   { category: "STAINER" },
    _count:  { _all: true },
    orderBy: { product: "asc" },
  });

  console.log("\n─── v2 SKU seed result ───");
  console.log(`Legacy rows read       : ${legacyRows.length}`);
  console.log(`Skipped (null)         : ${skippedNull}`);
  console.log(`Source rows cross-listed: ${crossListed}`);
  console.log(`v2 rows after translate: ${v2Rows.length}`);
  console.log(`v2 rows after dedup    : ${deduped.length}`);
  console.log(`Rows inserted          : ${inserted}`);
  console.log(`Verification count     : ${finalCount} (matches inserted: ${matches ? "✓" : "✗"})`);
  console.log(`Families produced      : ${byFamily.length}`);

  console.log("\n─── Family → row count breakdown ───");
  for (const f of byFamily) {
    console.log(`  ${f.category.padEnd(24)} ${f._count._all}`);
  }

  console.log("\n─── STAINER family product breakdown (structural shape check) ───");
  if (stainerByProduct.length === 0) {
    console.log("  (no STAINER rows)");
  } else {
    for (const p of stainerByProduct) {
      console.log(`  ${p.product.padEnd(24)} ${p._count._all}`);
    }
  }

  // Sample translation checks — confirm the translator routed legacy SKUs
  // to the expected v2 (family, subProduct).
  console.log("\n─── Translation samples ───");
  const samples: Array<[string, string]> = [
    ["LUXURIO", "MATT"],
    ["LUXURIO", "GLOSS"],
    ["2K PU",   "MATT"],
    ["DISTEMPER", "MAGIK"],
  ];
  for (const [family, subProduct] of samples) {
    const rows = await prisma.mo_sku_lookup_v2.findMany({
      where: { category: family, product: subProduct },
      select: {
        material:    true,
        description: true,
        baseColour:  true,
        packCode:    true,
      },
      take:    5,
      orderBy: { material: "asc" },
    });
    console.log(`\n  ${family} / ${subProduct} (sample of ${rows.length}):`);
    if (rows.length === 0) {
      console.log("    (no rows)");
    } else {
      for (const r of rows) {
        console.log(`    ${r.material.padEnd(20)} ${r.baseColour.padEnd(20)} pack=${r.packCode.padEnd(6)} ${r.description.slice(0, 50)}`);
      }
    }
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
    console.error("✗ v2 SKU seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
