// scripts/import-sampling-library.ts
//
// DEPRECATED: Phase 4 flipped sampling_register.samplingNo from Int → String
// (format "YY-NNNN", legacy 6-digit accepted). This one-shot importer
// still treats Excel samplingNo cells as numbers internally and coerces
// to string at every DB boundary (.toString()) so writes succeed against
// the new schema. Do not extend this script for new data — use the
// /api/sampling-library POST endpoint, which uses next_sampling_no().
//
// Sampling Library importer — reads Tinting_data_Tracker_N_REVIEWED.xlsx,
// filters to Action=IMPORT rows, groups by samplingNo, and writes parents
// (sampling_register) + child recipes (sampling_recipes).
//
// Two modes (env var IMPORT_MODE):
//   dry     → print plan only, NO database writes (default)
//   commit  → write to DB after 10-second countdown
//
// Engineering rules (CORE §3):
//   - NO prisma.$transaction. Sequential awaits only.
//   - NO createMany. Use create() per row so failures point to exact row.
//   - NO prisma db push. Schema is already migrated via Supabase SQL Editor.
//
// Run:
//   $env:IMPORT_MODE="dry";    npx tsx scripts/import-sampling-library.ts
//   $env:IMPORT_MODE="commit"; npx tsx scripts/import-sampling-library.ts

import * as XLSX from "xlsx";
import * as fs from "fs";
import { PrismaClient, Prisma } from "@prisma/client";
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
  type PigmentCode,
} from "./lib/sampling-classifier";

const REVIEWED_PATH = "docs/plans/sampling-register/Tinting_data_Tracker_N_REVIEWED.xlsx";

// PackCode enum values from prisma/schema.prisma. The classifier only
// produces a subset (8 packs), but we keep the full set here as the
// validation gate — anything outside this set is an error.
const VALID_PACK_CODES = new Set<string>([
  "ml_500", "L_0_9", "L_0_925", "L_1", "L_3_6", "L_3_7", "L_4",
  "L_9", "L_9_25", "L_10", "L_15", "L_18", "L_18_5", "L_20",
  "L_22", "L_30", "L_40",
]);

type Mode = "dry" | "commit";

interface ParsedRow {
  samplingNo:    number;
  shadeName:     string;
  skuCode:       string;
  packCode:      string;
  productName:   string;
  dealerName:    string;
  pigments:      Record<PigmentCode, number>;
}

interface RecipePlan {
  skuCode:     string;
  packCode:    string;
  productName: string;
  pigments:    Record<PigmentCode, number>;
  isPrimary:   boolean;
}

interface ParentPlan {
  samplingNo:  number;
  shadeName:   string;
  tinterType:  "TINTER";
  dealerName:  string | null;
  recipes:     RecipePlan[];
}

const prisma = new PrismaClient();

function emptyPigments(): Record<PigmentCode, number> {
  const out = {} as Record<PigmentCode, number>;
  for (const code of TINTER_CODES) out[code] = 0;
  return out;
}

async function findSystemUser(): Promise<{ id: number; name: string; email: string } | null> {
  const byName = await prisma.users.findFirst({
    where: {
      OR: [
        { name:  "system" },
        { email: "system@orbitoms.in" },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  if (byName) return byName;
  const byId = await prisma.users.findUnique({
    where: { id: 1 },
    select: { id: true, name: true, email: true },
  });
  return byId;
}

async function main(): Promise<void> {
  const modeRaw = (process.env.IMPORT_MODE ?? "").toLowerCase();
  const mode: Mode = modeRaw === "commit" ? "commit" : "dry";

  // ── Pre-flight ────────────────────────────────────────────────────────────
  if (!fs.existsSync(REVIEWED_PATH)) {
    console.error(`Input not found: ${REVIEWED_PATH}`);
    process.exit(1);
  }
  const mtime = fs.statSync(REVIEWED_PATH).mtime.toISOString();

  const systemUser = await findSystemUser();
  if (!systemUser) {
    console.error("No system user available for import.");
    console.error("Please create a user with name 'system' or email 'system@orbitoms.in', or ensure user id=1 exists.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const stockLoad  = loadStockMaster();
  const legacyLoad = loadSkuMaster();
  const allMasterSkus = new Set<string>([
    ...Array.from(stockLoad.map.keys()),
    ...Array.from(legacyLoad.map.keys()),
  ]);

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
  const remarksColIdx = headers.findIndex((h) => h.trim().toLowerCase() === "remarks");

  const missingCols: string[] = [];
  if (cm.samplingNo == null) missingCols.push("sampling no");
  if (cm.shadeName  == null) missingCols.push("shade name");
  if (cm.skuCode    == null) missingCols.push("sku code");
  if (cm.desc       == null) missingCols.push("desc");
  if (actionColIdx  < 0)     missingCols.push("Action");
  if (missingCols.length > 0) {
    console.error(`REVIEWED.xlsx missing required columns: ${missingCols.join(", ")}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  void remarksColIdx;

  // ── Parse rows ────────────────────────────────────────────────────────────
  const actionCounts = { IMPORT: 0, REVIEW: 0, SKIP: 0, OTHER: 0 };
  let totalDataRows = 0;
  const importRows: ParsedRow[] = [];
  const unresolvedPackRows: number[] = [];

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

    const shadeName  = toStrTrimmed(row[cm.shadeName!]);
    const skuCode    = toStrTrimmed(row[cm.skuCode!]);
    const desc       = toStrTrimmed(row[cm.desc!]);
    const descBlank  = desc === "";
    const dealerName = cm.dealerName != null ? toStrTrimmed(row[cm.dealerName]) : "";

    // Resolve packCode — DESC first, then stock, then legacy.
    let packCode: string | null = extractPackCode(desc);
    let recoveredDesc: string | null = null;
    if (packCode == null) {
      const lookup = lookupSku(stockLoad.map, legacyLoad.map, skuCode);
      if (lookup.desc) {
        const pack = extractPackCode(lookup.desc);
        if (pack) {
          packCode      = pack;
          recoveredDesc = lookup.desc;
        }
      }
    }
    if (packCode == null) {
      // Shouldn't happen for IMPORT rows (classifier enforced this), but
      // safety net — track and skip.
      unresolvedPackRows.push(r + 1); // 1-based for human-friendly reporting
      continue;
    }
    const productName = descBlank ? (recoveredDesc ?? "") : desc;

    // Pigment values
    const pigments = emptyPigments();
    for (const code of TINTER_CODES) {
      const colIdx = cm.pigments[code];
      pigments[code] = colIdx != null ? toDecimal(row[colIdx]) : 0;
    }

    importRows.push({
      samplingNo,
      shadeName,
      skuCode,
      packCode,
      productName,
      dealerName,
      pigments,
    });
  }

  // ── Group by samplingNo + collapse duplicate (skuCode, packCode) ──────────
  const groups = new Map<number, ParsedRow[]>();
  for (const r of importRows) {
    const existing = groups.get(r.samplingNo);
    if (existing) existing.push(r);
    else groups.set(r.samplingNo, [r]);
  }

  let collapsedDuplicates = 0;
  const parents: ParentPlan[] = [];
  const orderedSamplingNos = Array.from(groups.keys()).sort((a, b) => a - b);
  for (const samplingNo of orderedSamplingNos) {
    const rows = groups.get(samplingNo)!;
    const shadeName  = rows.find((r) => r.shadeName)?.shadeName  ?? "(blank)";
    const dealerName = rows.find((r) => r.dealerName)?.dealerName ?? "";

    // Latest row wins for pigment values on duplicates within a sampling.
    const recipeMap = new Map<string, RecipePlan>();
    for (const row of rows) {
      const key = `${row.skuCode}|${row.packCode}`;
      const existing = recipeMap.get(key);
      if (existing) {
        existing.pigments    = row.pigments;
        existing.productName = row.productName || existing.productName;
        collapsedDuplicates += 1;
      } else {
        recipeMap.set(key, {
          skuCode:     row.skuCode,
          packCode:    row.packCode,
          productName: row.productName,
          pigments:    row.pigments,
          isPrimary:   false,
        });
      }
    }
    const recipes = Array.from(recipeMap.values());

    // isPrimary: prefer L_20, else first variant.
    if (recipes.length > 0) {
      let primaryIdx = recipes.findIndex((r) => r.packCode === "L_20");
      if (primaryIdx < 0) primaryIdx = 0;
      recipes[primaryIdx].isPrimary = true;
    }

    parents.push({
      samplingNo,
      shadeName,
      tinterType: "TINTER",
      dealerName: dealerName || null,
      recipes,
    });
  }

  const totalRecipes = parents.reduce((s, p) => s + p.recipes.length, 0);

  // ── DB validation: check for existing samplingNo collisions ───────────────
  const samplingNos = parents.map((p) => p.samplingNo.toString());
  const existing = samplingNos.length > 0
    ? await prisma.sampling_register.findMany({
        where:  { samplingNo: { in: samplingNos } },
        select: { samplingNo: true },
      })
    : [];
  const collisionNos = existing.map((e) => e.samplingNo);

  // Pack code validation
  let invalidPackCount = 0;
  for (const p of parents) {
    for (const r of p.recipes) {
      if (!VALID_PACK_CODES.has(r.packCode)) invalidPackCount += 1;
    }
  }

  // SKU codes not in any master (informational)
  const skusNotInMaster = new Set<string>();
  for (const p of parents) {
    for (const r of p.recipes) {
      if (!allMasterSkus.has(r.skuCode)) skusNotInMaster.add(r.skuCode);
    }
  }

  // Blockers
  const blockers: string[] = [];
  if (parents.length === 0)         blockers.push("No IMPORT rows found in REVIEWED.xlsx");
  if (totalRecipes === 0)           blockers.push("No recipes to insert");
  if (collisionNos.length > 0)      blockers.push(`${collisionNos.length} sampling numbers already exist in sampling_register`);
  if (invalidPackCount > 0)         blockers.push(`${invalidPackCount} recipes have invalid pack codes`);

  // ── Print plan ────────────────────────────────────────────────────────────
  if (mode === "commit") {
    console.log("⚠️  COMMIT MODE will write to the production database.");
    console.log("⚠️  Make sure you have reviewed the dry-run output.");
    console.log("⚠️  10-second countdown starting...");
    console.log("");
  }

  console.log(`===== IMPORT_MODE = ${mode === "dry" ? "dry-run" : "commit"} =====`);
  console.log(`Source: ${REVIEWED_PATH}`);
  console.log(`Modified: ${mtime}`);
  console.log("");
  console.log(`System user: id=${systemUser.id}, name=${systemUser.name}`);
  console.log("");
  console.log("Sampling Excel summary:");
  console.log(`  Total rows in file:           ${totalDataRows}`);
  console.log(`  Rows with Action=IMPORT:      ${actionCounts.IMPORT}`);
  console.log(`  Rows with Action=REVIEW:      ${actionCounts.REVIEW}  (skipped this run)`);
  console.log(`  Rows with Action=SKIP:        ${actionCounts.SKIP}  (skipped this run)`);
  if (actionCounts.OTHER > 0) {
    console.log(`  Rows with other Action:       ${actionCounts.OTHER}`);
  }
  if (unresolvedPackRows.length > 0) {
    console.log(`  IMPORT rows with unresolved pack (skipped): ${unresolvedPackRows.length}`);
  }
  console.log("");
  console.log("Import plan:");
  console.log(`  Sampling numbers to create (parents): ${parents.length}`);
  console.log(`  Recipe rows to create (children):     ${totalRecipes}`);
  console.log(`  Collapsed duplicates (same SKU+pack within a sampling): ${collapsedDuplicates}`);
  console.log("");

  console.log("Sample of first 10 parents:");
  console.log("  samplingNo | shadeName                            | tinterType | recipeCount");
  console.log("  -----------+--------------------------------------+------------+------------");
  for (const p of parents.slice(0, 10)) {
    const sno = String(p.samplingNo).padStart(10);
    const sn  = p.shadeName.padEnd(36).slice(0, 36);
    const tt  = p.tinterType.padEnd(10);
    const rc  = String(p.recipes.length).padStart(11);
    console.log(`  ${sno} | ${sn} | ${tt} | ${rc}`);
  }
  console.log("");

  console.log("Sample of first 10 recipes:");
  console.log("  samplingNo | skuCode            | packCode | tinQty | nonZeroPigments");
  console.log("  -----------+--------------------+----------+--------+----------------");
  let printedRecipes = 0;
  outer: for (const p of parents) {
    for (const r of p.recipes) {
      const nonZero = TINTER_CODES
        .filter((c) => r.pigments[c] > 0)
        .map((c) => `${c}:${r.pigments[c]}`)
        .join(" ");
      const sno = String(p.samplingNo).padStart(10);
      const sku = r.skuCode.padEnd(18).slice(0, 18);
      const pc  = r.packCode.padEnd(8);
      console.log(`  ${sno} | ${sku} | ${pc} |      0 | ${nonZero}`);
      printedRecipes += 1;
      if (printedRecipes >= 10) break outer;
    }
  }
  console.log("");

  console.log("Validation checks (run against DB):");
  console.log(`  Sampling numbers already in DB (collision):   ${collisionNos.length}`);
  console.log(`  SKU codes in recipes not seen in any master:  ${skusNotInMaster.size}  (informational only)`);
  console.log(`  Pack codes invalid against enum:              ${invalidPackCount}  (must be 0)`);
  console.log("");
  console.log(`Status: ${blockers.length === 0 ? "READY TO COMMIT" : `BLOCKED — ${blockers[0]}`}`);

  if (blockers.length > 0) {
    console.log("");
    console.log("===== BLOCKED =====");
    console.log("Reasons:");
    for (const b of blockers) console.log(`  - ${b}`);
    console.log("Fix steps:");
    let stepNo = 1;
    if (collisionNos.length > 0) {
      const sample = collisionNos.slice(0, 5).join(", ");
      console.log(`  ${stepNo++}. Inspect existing sampling_register rows (sample: ${sample}...).`);
      console.log(`     Run: SELECT "samplingNo" FROM sampling_register ORDER BY "samplingNo";`);
      console.log(`  ${stepNo++}. If safe to wipe and re-import:`);
      console.log(`     DELETE FROM sampling_recipes;`);
      console.log(`     DELETE FROM sampling_register;`);
    }
    if (invalidPackCount > 0) {
      console.log(`  ${stepNo++}. Investigate invalid pack codes — re-run the classifier with refreshed masters.`);
    }
    if (parents.length === 0) {
      console.log(`  ${stepNo++}. Verify REVIEWED.xlsx Data sheet actually has Action=IMPORT rows.`);
    }
    console.log("Rerun in dry-run mode after fixing.");
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

  let parentsInserted = 0;
  let recipesInserted = 0;
  const cleanupSql = (): void => {
    console.error("");
    console.error("Cleanup SQL (run in Supabase SQL Editor):");
    console.error(`  DELETE FROM sampling_recipes WHERE "createdAt" >= '${runStartTime.toISOString()}';`);
    console.error(`  DELETE FROM sampling_register WHERE "createdAt" >= '${runStartTime.toISOString()}';`);
  };

  // Insert parents ────────────────────────────────────────────────────────────
  for (const p of parents) {
    try {
      await prisma.sampling_register.create({
        data: {
          samplingNo:     p.samplingNo.toString(),
          shadeName:      p.shadeName,
          tinterType:     p.tinterType,
          siteId:         null,
          salesOfficerId: null,
          dealerName:     p.dealerName,
          notes:          null,
          isActive:       true,
          needsReview:    false,
          createdById:    systemUser.id,
        },
      });
      parentsInserted += 1;
      if (parentsInserted % 100 === 0 || parentsInserted === parents.length) {
        console.log(`Inserted ${parentsInserted} / ${parents.length} parents`);
      }
    } catch (err) {
      console.error("");
      console.error("===== PARENT INSERT FAILED =====");
      console.error(`Failed at samplingNo=${p.samplingNo} (after ${parentsInserted} successful inserts)`);
      console.error(err);
      cleanupSql();
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  // Insert recipes ────────────────────────────────────────────────────────────
  for (const p of parents) {
    for (const r of p.recipes) {
      try {
        const data: Prisma.sampling_recipesUncheckedCreateInput = {
          samplingNo:  p.samplingNo.toString(),
          skuCode:     r.skuCode,
          productName: r.productName || null,
          packCode:    r.packCode as Prisma.sampling_recipesUncheckedCreateInput["packCode"],
          tinQty:      new Prisma.Decimal(0),
          isPrimary:   r.isPrimary,
          usageCount:  0,
          YOX: new Prisma.Decimal(r.pigments.YOX),
          LFY: new Prisma.Decimal(r.pigments.LFY),
          GRN: new Prisma.Decimal(r.pigments.GRN),
          TBL: new Prisma.Decimal(r.pigments.TBL),
          WHT: new Prisma.Decimal(r.pigments.WHT),
          MAG: new Prisma.Decimal(r.pigments.MAG),
          FFR: new Prisma.Decimal(r.pigments.FFR),
          BLK: new Prisma.Decimal(r.pigments.BLK),
          OXR: new Prisma.Decimal(r.pigments.OXR),
          HEY: new Prisma.Decimal(r.pigments.HEY),
          HER: new Prisma.Decimal(r.pigments.HER),
          COB: new Prisma.Decimal(r.pigments.COB),
          COG: new Prisma.Decimal(r.pigments.COG),
        };
        await prisma.sampling_recipes.create({ data });
        recipesInserted += 1;
        if (recipesInserted % 500 === 0 || recipesInserted === totalRecipes) {
          console.log(`Inserted ${recipesInserted} / ${totalRecipes} recipes`);
        }
      } catch (err) {
        console.error("");
        console.error("===== RECIPE INSERT FAILED =====");
        console.error(`Failed at samplingNo=${p.samplingNo}, skuCode=${r.skuCode}, packCode=${r.packCode}`);
        console.error(`(after ${recipesInserted} successful recipe inserts and ${parentsInserted} parents)`);
        console.error(err);
        cleanupSql();
        await prisma.$disconnect();
        process.exit(1);
      }
    }
  }

  // ── Verification ──────────────────────────────────────────────────────────
  console.log("");
  console.log("===== Commit complete =====");
  const parentOk = parentsInserted === parents.length ? "✓" : "✗";
  const recipeOk = recipesInserted === totalRecipes    ? "✓" : "✗";
  console.log(`Parents inserted:  ${parentsInserted}  (expected ${parents.length})  ${parentOk}`);
  console.log(`Recipes inserted:  ${recipesInserted}  (expected ${totalRecipes})  ${recipeOk}`);
  console.log("");

  // Spot-check 5 random samplings
  const samplePool = [...parents];
  const samples: ParentPlan[] = [];
  for (let i = 0; i < 5 && samplePool.length > 0; i++) {
    const idx = Math.floor(Math.random() * samplePool.length);
    samples.push(samplePool.splice(idx, 1)[0]);
  }
  console.log("Spot-check (random 5 sampling nos):");
  for (const s of samples) {
    const parent = await prisma.sampling_register.findUnique({
      where:   { samplingNo: s.samplingNo.toString() },
      include: { recipes: { select: { id: true } } },
    });
    if (parent) {
      console.log(`  ${parent.samplingNo} — shadeName=${parent.shadeName}, recipeCount=${parent.recipes.length}, tinterType=${parent.tinterType}`);
    } else {
      console.log(`  ${s.samplingNo} — NOT FOUND (verification failure)`);
    }
  }
  console.log("");
  console.log("DB verification queries (also print these for you to run in Supabase manually):");
  console.log(`  SELECT COUNT(*) FROM sampling_register;`);
  console.log(`  SELECT COUNT(*) FROM sampling_recipes;`);
  console.log(`  SELECT "tinterType", COUNT(*) FROM sampling_register GROUP BY "tinterType";`);
  console.log(`  SELECT "needsReview", COUNT(*) FROM sampling_register GROUP BY "needsReview";`);
  console.log("");
  console.log("Status: SUCCESS");
  console.log("");
  console.log(`Commit complete. ${parentsInserted} parents + ${recipesInserted} recipes written.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
