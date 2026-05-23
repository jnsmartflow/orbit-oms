// scripts/repair-sampling-import.ts
//
// REPAIR-1 script — fixes three data issues left over from the initial
// sampling library import (see scripts/import-sampling-library.ts):
//
//   1. sampling_register.createdAt was set to today's date. Repair sets it
//      to the earliest Excel usage date per samplingNo.
//   2. sampling_register.siteId + siteNameRaw were never populated. Repair
//      reads SITE NAME from the Excel, attempts an exact (case-insensitive,
//      trimmed) match against delivery_point_master, and either sets
//      siteId OR stores the raw text in siteNameRaw.
//   3. Usage history was collapsed at import. Repair re-explodes the
//      source Excel into sampling_usage_log — one row per IMPORT row.
//
// Two modes (env var REPAIR_MODE):
//   dry     → print plan only, NO database writes (default)
//   commit  → write to DB after 10-second countdown
//
// Engineering rules (CORE §3):
//   - NO prisma.$transaction. Sequential awaits only.
//   - NO createMany. Use create() per row so failures pinpoint exact row.
//   - NO prisma db push. Schema migrated via Supabase SQL Editor
//     (docs/plans/sampling-register/03-repair-schema.sql), then prisma
//     generate, then this script.
//
// Run:
//   $env:REPAIR_MODE="dry";    npx tsx scripts/repair-sampling-import.ts
//   $env:REPAIR_MODE="commit"; npx tsx scripts/repair-sampling-import.ts

import * as XLSX from "xlsx";
import * as fs from "fs";
import { PrismaClient, Prisma, PackCode } from "@prisma/client";
import {
  TINTER_CODES,
  loadStockMaster,
  loadSkuMaster,
  lookupSku,
  extractPackCode,
  buildColumnMap,
  toIntOrNull,
  toStrTrimmed,
  toDecimal,
} from "./lib/sampling-classifier";

void TINTER_CODES; // imported only to keep the classifier as a shared dep

const REVIEWED_PATH = "docs/plans/sampling-register/Tinting_data_Tracker_N_REVIEWED.xlsx";
// Original source — used ONLY for TIN QTY (col H), which the classifier
// dropped from REVIEWED.xlsx because that column has a BLANK header in the
// source. Spot-checks (REPAIR-1a) confirmed identical row ordering across
// the two files, so we can join by row index. Read TIN QTY by POSITION
// (column index 7) — header-based lookup will not find it.
const ORIGINAL_PATH       = "docs/plans/Tinting data Tracker_N.xlsx";
const ORIGINAL_TINQTY_COL = 7; // col H, 0-indexed

// Baseline counts from the original step-3b import. The dry-run will hard
// stop if reality drifts from these — protects against double-applying the
// repair script. Edit if the import baseline is genuinely different.
const EXPECTED_PARENTS_BASELINE   = 3566;
const EXPECTED_RECIPES_BASELINE   = 4052;
const EXPECTED_USAGE_LOG_BASELINE = 0;

// PackCode enum values from prisma/schema.prisma.
const VALID_PACK_CODES = new Set<string>([
  "ml_500", "L_0_9", "L_0_925", "L_1", "L_3_6", "L_3_7", "L_4",
  "L_9",    "L_9_25", "L_10",   "L_15", "L_18",  "L_18_5", "L_20",
  "L_22",   "L_30",   "L_40",
]);

type Mode = "dry" | "commit";

interface UsageRowPlan {
  samplingNo:     number;
  recipeKey:      string | null;       // `${samplingNo}|${skuCode}|${packCode}` for lookup
  usageDate:      Date | null;
  tinQty:         number;
  dealerNameRaw:  string | null;
  siteNameRaw:    string | null;
  skuCodeRaw:     string | null;
  packCode:       PackCode | null;
  sourceRowIndex: number;
}

interface ParentRepairPlan {
  samplingNo:  number;
  earliestAt:  Date | null;
  latestAt:    Date | null;
  siteId:      number | null;         // matched master id
  siteNameRaw: string | null;         // unmatched original text
  usageRows:   UsageRowPlan[];
}

const prisma = new PrismaClient();

// ── Helpers ────────────────────────────────────────────────────────────────

function findHeader(headers: string[], patterns: RegExp[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[\s_.\-/()]+/g, ""));
  for (let i = 0; i < norm.length; i++) {
    for (const re of patterns) {
      if (re.test(norm[i])) return i;
    }
  }
  return -1;
}

function excelDateToJsDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 1) return null;
    // 25569 = days between Excel epoch 1899-12-30 and Unix epoch 1970-01-01,
    // accounting for Excel's 1900 leap-year bug.
    const ms = (v - 25569) * 86400 * 1000;
    const d  = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    // dd/mm/yyyy or dd-mm-yyyy
    const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      const dd = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      let yy   = parseInt(m[3], 10);
      if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
      const d = new Date(Date.UTC(yy, mm - 1, dd));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatIsoDate(d: Date | null): string {
  if (!d) return "(none)";
  return d.toISOString().slice(0, 10);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const modeRaw = (process.env.REPAIR_MODE ?? "").toLowerCase();
  const mode: Mode = modeRaw === "commit" ? "commit" : "dry";

  if (!fs.existsSync(REVIEWED_PATH)) {
    console.error(`Input not found: ${REVIEWED_PATH}`);
    process.exit(1);
  }
  const mtime = fs.statSync(REVIEWED_PATH).mtime.toISOString();

  // ── Read REVIEWED.xlsx Data sheet ─────────────────────────────────────────
  const wb = XLSX.readFile(REVIEWED_PATH, { cellDates: false });
  const sheet = wb.Sheets["Data"];
  if (!sheet) {
    console.error("Data sheet not found in REVIEWED.xlsx");
    await prisma.$disconnect();
    process.exit(1);
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  if (raw.length === 0) {
    console.error("Data sheet is empty");
    await prisma.$disconnect();
    process.exit(1);
  }
  const headers: string[] = ((raw[0] ?? []) as unknown[]).map((c) => (c == null ? "" : String(c)));
  const cm = buildColumnMap(headers);
  const actionColIdx  = headers.findIndex((h) => h.trim().toLowerCase() === "action");
  const siteColIdx    = findHeader(headers, [/^(site(name)?)$/]);
  const operatorColIdx= findHeader(headers, [/^(operator(name)?|tinterby|tintedby|tinter|by)$/]);

  const missingCols: string[] = [];
  if (cm.samplingNo == null) missingCols.push("sampling no");
  if (cm.skuCode    == null) missingCols.push("sku code");
  if (cm.desc       == null) missingCols.push("desc");
  if (actionColIdx  < 0)     missingCols.push("Action");
  if (cm.dateRaw    == null) missingCols.push("date");
  if (missingCols.length > 0) {
    console.error(`REVIEWED.xlsx missing required columns: ${missingCols.join(", ")}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (siteColIdx < 0) {
    console.warn("WARN: no SITE NAME column found in REVIEWED.xlsx — siteNameRaw/siteId fix will produce no matches.");
  }

  // ── Read ORIGINAL Excel and build rowIndex → tinQty map ───────────────────
  // REVIEWED.xlsx drops col H (TIN QTY) because its header is blank in the
  // source, and the classifier filters by header name. Spot-checks confirm
  // the two files share identical row ordering, so we can join by row
  // index. Read TIN QTY by POSITION (col index 7), not by name.
  if (!fs.existsSync(ORIGINAL_PATH)) {
    console.error(`Original Excel not found: ${ORIGINAL_PATH}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const origWb = XLSX.readFile(ORIGINAL_PATH, { cellDates: false });
  const origSheetName = origWb.SheetNames[0];
  const origSheet = origSheetName ? origWb.Sheets[origSheetName] : undefined;
  if (!origSheet) {
    console.error(`Original Excel has no data sheet`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const origRaw = XLSX.utils.sheet_to_json<unknown[]>(origSheet, { header: 1, raw: true, defval: null });

  // Alignment check: spot-check 5 row indices for matching samplingNo + SKU.
  const alignLen   = Math.min(origRaw.length, raw.length);
  const sampleIdxs = [
    1,
    Math.max(1, Math.floor(alignLen / 4)),
    Math.max(1, Math.floor(alignLen / 2)),
    Math.max(1, Math.floor((alignLen * 3) / 4)),
    Math.max(1, alignLen - 1),
  ];
  const snoIdx = cm.samplingNo!;
  const skuIdx = cm.skuCode!;
  const misalignments: string[] = [];
  for (const i of sampleIdxs) {
    const oRow = origRaw[i] as unknown[] | undefined;
    const rRow = raw[i]     as unknown[] | undefined;
    if (!Array.isArray(oRow) || !Array.isArray(rRow)) continue;
    const oSno = oRow[snoIdx];
    const rSno = rRow[snoIdx];
    const oSku = oRow[skuIdx];
    const rSku = rRow[skuIdx];
    if (String(oSno) !== String(rSno) || String(oSku) !== String(rSku)) {
      misalignments.push(`row ${i}: ORIG[sno=${oSno}, sku=${oSku}] vs REV[sno=${rSno}, sku=${rSku}]`);
    }
  }
  if (misalignments.length > 0) {
    console.error("ALIGNMENT FAILED — Original and REVIEWED row orderings diverge:");
    for (const m of misalignments) console.error(`  ${m}`);
    console.error("Aborting to avoid writing wrong tinQty values.");
    await prisma.$disconnect();
    process.exit(1);
  }

  // Build the map. Keyed by the same row-index `r` that the parse loop uses.
  const tinQtyByRow = new Map<number, number>();
  for (let i = 1; i < origRaw.length; i++) {
    const oRow = origRaw[i];
    if (!Array.isArray(oRow)) continue;
    const cell = oRow[ORIGINAL_TINQTY_COL];
    if (cell == null || (typeof cell === "string" && cell.trim() === "")) continue;
    const v = typeof cell === "number" ? cell : parseFloat(String(cell));
    if (Number.isFinite(v)) tinQtyByRow.set(i, v);
  }
  const tinQtyAligned = tinQtyByRow.size;

  // ── Pre-flight DB state ───────────────────────────────────────────────────
  const stockLoad  = loadStockMaster();
  const legacyLoad = loadSkuMaster();

  const [parentCount, recipeCount, usageCount] = [
    await prisma.sampling_register.count(),
    await prisma.sampling_recipes.count(),
    await prisma.sampling_usage_log.count(),
  ];

  // Load delivery_point_master into memory.
  const allSites = await prisma.delivery_point_master.findMany({
    select: { id: true, customerName: true },
  });
  const sitesByName = new Map<string, number>();
  for (const s of allSites) {
    if (!s.customerName) continue;
    const key = s.customerName.trim().toLowerCase();
    if (!sitesByName.has(key)) sitesByName.set(key, s.id);
  }

  // Load existing recipes for lookup. Used to set recipeId on usage rows.
  const allRecipes = await prisma.sampling_recipes.findMany({
    select: { id: true, samplingNo: true, skuCode: true, packCode: true },
  });
  const recipesByKey = new Map<string, number>();
  for (const r of allRecipes) {
    recipesByKey.set(`${r.samplingNo}|${r.skuCode}|${r.packCode}`, r.id);
  }

  // Load existing parents so we can update them later.
  const existingParents = await prisma.sampling_register.findMany({
    select: { samplingNo: true },
  });
  const existingParentSet = new Set(existingParents.map((p) => p.samplingNo));

  // ── Parse all IMPORT rows from Excel ──────────────────────────────────────
  const actionCounts = { IMPORT: 0, REVIEW: 0, SKIP: 0, OTHER: 0 };
  let totalDataRows = 0;
  let skippedNoParent  = 0;
  let skippedNoPack    = 0;
  let tinQtyDefaulted  = 0;

  // samplingNo → ParentRepairPlan
  const plansByNo = new Map<number, ParentRepairPlan>();

  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    if (!Array.isArray(row)) continue;
    if (row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;
    totalDataRows += 1;

    const action = toStrTrimmed(row[actionColIdx]);
    if (action === "IMPORT")      actionCounts.IMPORT += 1;
    else if (action === "REVIEW") actionCounts.REVIEW += 1;
    else if (action === "SKIP")   actionCounts.SKIP   += 1;
    else                          actionCounts.OTHER  += 1;
    if (action !== "IMPORT") continue;

    const samplingNo = toIntOrNull(row[cm.samplingNo!]);
    if (samplingNo == null) continue;
    // Phase 4: existingParentSet holds string samplingNos (TEXT column).
    if (!existingParentSet.has(samplingNo.toString())) {
      skippedNoParent += 1;
      continue;
    }

    const skuCode    = toStrTrimmed(row[cm.skuCode!]);
    const desc       = toStrTrimmed(row[cm.desc!]);
    const dealerName = cm.dealerName != null ? toStrTrimmed(row[cm.dealerName]) : "";
    const siteName   = siteColIdx >= 0 ? toStrTrimmed(row[siteColIdx]) : "";
    const tinQtyFromOrig = tinQtyByRow.get(r);
    const tinQty     = tinQtyFromOrig ?? 0;
    if (tinQtyFromOrig === undefined) tinQtyDefaulted += 1;
    const usageDate  = excelDateToJsDate(row[cm.dateRaw!]);

    // Resolve packCode — DESC first, then stock, then legacy.
    let packCode: string | null = extractPackCode(desc);
    if (packCode == null) {
      const lookup = lookupSku(stockLoad.map, legacyLoad.map, skuCode);
      if (lookup.desc) {
        const p = extractPackCode(lookup.desc);
        if (p) packCode = p;
      }
    }
    if (packCode == null || !VALID_PACK_CODES.has(packCode)) {
      skippedNoPack += 1;
      // Still log the usage event — but without recipeId/packCode.
      packCode = null;
    }

    const recipeKey = packCode != null
      ? `${samplingNo}|${skuCode}|${packCode}`
      : null;

    let plan = plansByNo.get(samplingNo);
    if (!plan) {
      plan = {
        samplingNo,
        earliestAt:  null,
        latestAt:    null,
        siteId:      null,
        siteNameRaw: null,
        usageRows:   [],
      };
      plansByNo.set(samplingNo, plan);
    }

    plan.usageRows.push({
      samplingNo,
      recipeKey,
      usageDate:      usageDate ? startOfUtcDay(usageDate) : null,
      tinQty,
      dealerNameRaw:  dealerName || null,
      siteNameRaw:    siteName   || null,
      skuCodeRaw:     skuCode    || null,
      packCode:       packCode as PackCode | null,
      sourceRowIndex: r + 1, // 1-based for human-readable reporting
    });

    if (usageDate) {
      if (!plan.earliestAt || usageDate < plan.earliestAt) plan.earliestAt = usageDate;
      if (!plan.latestAt   || usageDate > plan.latestAt)   plan.latestAt   = usageDate;
    }
  }

  // Resolve site (most recent siteName per sampling) + match against master.
  // We pick the most-recent (largest usageDate) non-blank siteName as the
  // canonical site for the parent.
  for (const plan of Array.from(plansByNo.values())) {
    let bestSite: string | null = null;
    let bestDate: Date | null = null;
    for (const u of plan.usageRows) {
      if (!u.siteNameRaw) continue;
      if (!bestSite || (u.usageDate && (!bestDate || u.usageDate > bestDate))) {
        bestSite = u.siteNameRaw;
        bestDate = u.usageDate;
      }
    }
    if (bestSite) {
      const matchId = sitesByName.get(bestSite.trim().toLowerCase());
      if (matchId !== undefined) {
        plan.siteId = matchId;
        plan.siteNameRaw = null;
      } else {
        plan.siteId = null;
        plan.siteNameRaw = bestSite;
      }
    }
  }

  // ── Statistics ────────────────────────────────────────────────────────────
  const totalUsageRows = Array.from(plansByNo.values()).reduce((s, p) => s + p.usageRows.length, 0);
  let unmatchedSiteCount = 0;
  let matchedSiteCount   = 0;
  let blankSiteCount     = 0;
  const unmatchedSiteHist = new Map<string, number>();
  for (const plan of Array.from(plansByNo.values())) {
    if (plan.siteId !== null) matchedSiteCount += 1;
    else if (plan.siteNameRaw) {
      unmatchedSiteCount += 1;
      unmatchedSiteHist.set(plan.siteNameRaw, (unmatchedSiteHist.get(plan.siteNameRaw) ?? 0) + 1);
    } else {
      blankSiteCount += 1;
    }
  }

  // ── Baseline safety check ─────────────────────────────────────────────────
  const baselineBlockers: string[] = [];
  if (parentCount !== EXPECTED_PARENTS_BASELINE) {
    baselineBlockers.push(`sampling_register count is ${parentCount}, expected ${EXPECTED_PARENTS_BASELINE}`);
  }
  if (recipeCount !== EXPECTED_RECIPES_BASELINE) {
    baselineBlockers.push(`sampling_recipes count is ${recipeCount}, expected ${EXPECTED_RECIPES_BASELINE}`);
  }
  if (usageCount !== EXPECTED_USAGE_LOG_BASELINE) {
    baselineBlockers.push(`sampling_usage_log count is ${usageCount}, expected ${EXPECTED_USAGE_LOG_BASELINE} (repair may have already run)`);
  }

  // ── Print plan ────────────────────────────────────────────────────────────
  if (mode === "commit") {
    console.log("⚠️  COMMIT MODE will modify the production database.");
    console.log("⚠️  Make sure you have reviewed the dry-run output.");
    console.log("⚠️  10-second countdown starting...");
    console.log("");
  }

  console.log(`===== REPAIR_MODE = ${mode === "dry" ? "dry-run" : "commit"} =====`);
  console.log(`Source: ${REVIEWED_PATH}`);
  console.log(`Modified: ${mtime}`);
  console.log("");
  console.log("Existing baseline:");
  console.log(`  sampling_register rows:  ${parentCount}  (expected: ${EXPECTED_PARENTS_BASELINE})`);
  console.log(`  sampling_recipes rows:   ${recipeCount}  (expected: ${EXPECTED_RECIPES_BASELINE})`);
  console.log(`  sampling_usage_log rows: ${usageCount}  (expected: ${EXPECTED_USAGE_LOG_BASELINE})`);
  console.log("");
  console.log("Sampling Excel summary:");
  console.log(`  Total rows in file:           ${totalDataRows}`);
  console.log(`  Rows with Action=IMPORT:      ${actionCounts.IMPORT}`);
  console.log(`  Rows with Action=REVIEW:      ${actionCounts.REVIEW}  (skipped this run)`);
  console.log(`  Rows with Action=SKIP:        ${actionCounts.SKIP}  (skipped this run)`);
  if (actionCounts.OTHER > 0) {
    console.log(`  Rows with other Action:       ${actionCounts.OTHER}`);
  }
  if (skippedNoParent > 0) {
    console.log(`  IMPORT rows with no parent in DB (skipped): ${skippedNoParent}`);
  }
  if (skippedNoPack > 0) {
    console.log(`  IMPORT rows with unresolved pack (logged with packCode=NULL): ${skippedNoPack}`);
  }
  console.log("");
  console.log(`TIN QTY source: ${ORIGINAL_PATH} col H. ${tinQtyAligned} rows aligned; ${tinQtyDefaulted} IMPORT rows defaulted to 0.`);
  console.log("");
  console.log("Planned actions:");
  console.log(`  UPDATE sampling_register parent rows:  ${plansByNo.size}`);
  console.log(`    - Setting createdAt to earliest Excel date per sampling no`);
  console.log(`    - Setting siteId or siteNameRaw based on master match`);
  console.log(`  INSERT sampling_usage_log entries:    ${totalUsageRows}`);
  console.log(`    - One row per IMPORT row in source Excel`);
  console.log("");

  console.log("Date repair preview (first 10 sampling nos):");
  console.log("  samplingNo | earliestExcelDate | latestExcelDate");
  console.log("  -----------+-------------------+----------------");
  const plansArr = Array.from(plansByNo.values()).sort((a, b) => a.samplingNo - b.samplingNo);
  for (const p of plansArr.slice(0, 10)) {
    const sno = String(p.samplingNo).padStart(10);
    const e   = formatIsoDate(p.earliestAt).padEnd(17);
    const l   = formatIsoDate(p.latestAt).padEnd(15);
    console.log(`  ${sno} | ${e} | ${l}`);
  }
  console.log("");

  console.log("Site match preview:");
  console.log(`  Total parents with usage rows:                ${plansByNo.size}`);
  console.log(`  Matched to delivery_point_master:             ${matchedSiteCount}`);
  console.log(`  Stored as siteNameRaw (no master match):      ${unmatchedSiteCount}`);
  console.log(`  Blank SITE NAME in Excel (siteId stays null): ${blankSiteCount}`);
  console.log("");

  if (unmatchedSiteHist.size > 0) {
    const top = Array.from(unmatchedSiteHist.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log("Top 10 unmatched sites (by sampling-no count):");
    for (const [name, n] of top) {
      console.log(`  ${name} — ${n} sampling no${n === 1 ? "" : "s"}`);
    }
    console.log("");
  }

  console.log("Usage log preview (first 5 rows to insert):");
  console.log("  samplingNo | usageDate  | sku                | pack   | tinQty | dealerRaw                  | siteRaw");
  console.log("  -----------+------------+--------------------+--------+--------+----------------------------+--------");
  let printed = 0;
  outer: for (const p of plansArr) {
    for (const u of p.usageRows) {
      const sno    = String(u.samplingNo).padStart(10);
      const date   = formatIsoDate(u.usageDate).padEnd(10);
      const sku    = (u.skuCodeRaw ?? "—").padEnd(18).slice(0, 18);
      const pack   = (u.packCode ?? "—").padEnd(6);
      const qty    = String(u.tinQty).padStart(6);
      const dealer = (u.dealerNameRaw ?? "—").padEnd(26).slice(0, 26);
      const site   = (u.siteNameRaw   ?? "—").slice(0, 30);
      console.log(`  ${sno} | ${date} | ${sku} | ${pack} | ${qty} | ${dealer} | ${site}`);
      printed += 1;
      if (printed >= 5) break outer;
    }
  }
  console.log("");

  // ── Blockers ──────────────────────────────────────────────────────────────
  const blockers: string[] = [...baselineBlockers];
  if (plansByNo.size === 0) blockers.push("No IMPORT rows produced any plans");

  if (tinQtyDefaulted >= 1000) {
    console.log(`WARN: ${tinQtyDefaulted} usage_log rows still have tinQty=0 — check source data.`);
    console.log("");
  }

  console.log(`Status: ${blockers.length === 0 ? "READY TO COMMIT" : `BLOCKED — ${blockers[0]}`}`);

  if (blockers.length > 0) {
    console.log("");
    console.log("===== BLOCKED =====");
    console.log("Reasons:");
    for (const b of blockers) console.log(`  - ${b}`);
    console.log("");
    console.log("If the baseline mismatch is intentional (e.g. you re-imported), edit the EXPECTED_*_BASELINE constants at the top of this script and re-run dry-run.");
    await prisma.$disconnect();
    process.exit(0);
  }

  if (mode === "dry") {
    console.log("");
    console.log("Dry-run complete. Awaiting Smart Flow confirmation to commit.");
    await prisma.$disconnect();
    return;
  }

  // ── COMMIT MODE ───────────────────────────────────────────────────────────
  console.log("");
  for (let i = 10; i >= 1; i--) {
    console.log(`Committing in ${i}...`);
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
  console.log("");

  const runStartTime = new Date();
  console.log(`Run start time: ${runStartTime.toISOString()}`);
  console.log("");

  let parentsUpdated = 0;
  let usageInserted  = 0;
  const failures: { kind: "parent" | "usage"; samplingNo: number; rowIndex?: number; error: string }[] = [];

  // Update parents ────────────────────────────────────────────────────────────
  for (const plan of plansArr) {
    try {
      await prisma.sampling_register.update({
        where: { samplingNo: plan.samplingNo.toString() },
        data: {
          createdAt:   plan.earliestAt ?? undefined,
          siteId:      plan.siteId,
          siteNameRaw: plan.siteNameRaw,
        },
      });
      parentsUpdated += 1;
      if (parentsUpdated % 100 === 0 || parentsUpdated === plansArr.length) {
        console.log(`Updated ${parentsUpdated} / ${plansArr.length} parents`);
      }
    } catch (err) {
      failures.push({
        kind: "parent",
        samplingNo: plan.samplingNo,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  console.log("");

  // Insert usage_log rows ─────────────────────────────────────────────────────
  for (const plan of plansArr) {
    for (const u of plan.usageRows) {
      try {
        const recipeId = u.recipeKey ? recipesByKey.get(u.recipeKey) ?? null : null;
        await prisma.sampling_usage_log.create({
          data: {
            samplingNo:      u.samplingNo.toString(),
            recipeId,
            usageDate:       u.usageDate,
            operatorId:      null,
            operatorNameRaw: null,
            tinQty:          new Prisma.Decimal(u.tinQty),
            dealerNameRaw:   u.dealerNameRaw,
            siteNameRaw:     u.siteNameRaw,
            skuCodeRaw:      u.skuCodeRaw,
            packCode:        u.packCode,
            sourceRowIndex:  u.sourceRowIndex,
          },
        });
        usageInserted += 1;
        if (usageInserted % 500 === 0 || usageInserted === totalUsageRows) {
          console.log(`Inserted ${usageInserted} / ${totalUsageRows} usage_log rows`);
        }
      } catch (err) {
        failures.push({
          kind: "usage",
          samplingNo: u.samplingNo,
          rowIndex:   u.sourceRowIndex,
          error:      err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ── Verification ──────────────────────────────────────────────────────────
  console.log("");
  console.log("===== Commit complete =====");
  const parentOk = parentsUpdated === plansArr.length ? "✓" : "✗";
  const usageOk  = usageInserted  === totalUsageRows  ? "✓" : "✗";
  console.log(`Parents updated:     ${parentsUpdated}  (expected ${plansArr.length})  ${parentOk}`);
  console.log(`Usage logs inserted: ${usageInserted}   (expected ${totalUsageRows})  ${usageOk}`);
  console.log("");

  if (failures.length > 0) {
    console.log(`${failures.length} failure${failures.length === 1 ? "" : "s"} during commit:`);
    for (const f of failures.slice(0, 50)) {
      const where = f.kind === "parent"
        ? `parent samplingNo=${f.samplingNo}`
        : `usage samplingNo=${f.samplingNo} rowIndex=${f.rowIndex}`;
      console.log(`  ${where} — ${f.error}`);
    }
    if (failures.length > 50) {
      console.log(`  ...and ${failures.length - 50} more`);
    }
    console.log("");
  }

  console.log("DB verification queries (run in Supabase manually):");
  console.log(`  SELECT COUNT(*) FROM sampling_usage_log;                                       -- expected ${totalUsageRows}`);
  console.log(`  SELECT COUNT(*) FROM sampling_register WHERE "siteId" IS NOT NULL;             -- expected ${matchedSiteCount}`);
  console.log(`  SELECT COUNT(*) FROM sampling_register WHERE "siteNameRaw" IS NOT NULL;        -- expected ${unmatchedSiteCount}`);
  console.log(`  SELECT MIN("createdAt"), MAX("createdAt") FROM sampling_register;              -- range should span historical dates, not just today`);
  console.log("");
  console.log("Status: SUCCESS");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
