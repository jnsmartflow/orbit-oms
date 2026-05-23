// scripts/normalise-sampling-data.ts
//
// Sampling Library — normalisation audit (read-only).
//
// Scans three entity types in the sampling library data — SKU codes, dealer
// names, site names — against their canonical masters and classifies every
// non-canonical variant into one of four bands (HIGH / MEDIUM / LOW /
// UNRESOLVED) using a single Levenshtein distance metric capped at 5.
//
// Output: one plain-text report per entity in
//   docs/plans/sampling-register/audit-{skus,dealers,sites}.txt
//
// Modes (--mode flag):
//   audit   — read-only; produces the three reports. Default.
//   commit  — not implemented yet; aborts immediately.
//
// Engineering rules (CORE §3):
//   - NO prisma.$transaction. Sequential awaits only.
//   - Read-only in audit mode: no UPDATE / INSERT / DELETE.
//   - No new dependencies; Levenshtein is inlined.
//   - TypeScript strict.
//
// Run:
//   npx tsx scripts/normalise-sampling-data.ts --mode=audit

import * as fs       from "fs";
import * as path     from "path";
import * as readline from "readline";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPORT_DIR = "docs/plans/sampling-register";
const DIST_CAP   = 5;

// ── Types ───────────────────────────────────────────────────────────────────

type Source = "sampling_recipes" | "sampling_usage_log" | "sampling_register";
type Band   = "HIGH" | "MEDIUM" | "LOW" | "UNRESOLVED";

interface Location {
  source:  Source;
  column:  string;
  count:   number;
  samples: (number | string)[];
}

interface Variant {
  raw:           string;
  normalized:    string;
  closestMaster: string | null;
  distance:      number;
  band:          Band;
  locations:     Location[];
}

interface MasterEntry {
  raw:        string;
  normalized: string;
}

interface ScanRow {
  raw:      string | null;
  // Phase 4: sampling_register.samplingNo flipped Int → String, so this audit
  // identifier holds either a usage-log id (number) or a samplingNo (string).
  sampleId: number | string;
}

interface ScanSource {
  source:    Source;
  column:    string;
  rows:      ScanRow[];
}

interface EntityResult {
  variants:    Variant[];
  scannedRows: Array<{ source: Source; total: number }>;
}

// ── Inline Levenshtein (capped, with row-min early exit) ────────────────────

function levCapped(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb > max ? max + 1 : lb;
  if (lb === 0) return la > max ? max + 1 : la;

  let prev: number[] = new Array<number>(lb + 1);
  let curr: number[] = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const ins = curr[j - 1] + 1;
      const del = prev[j] + 1;
      const sub = prev[j - 1] + cost;
      const v   = ins < del ? (ins < sub ? ins : sub) : (del < sub ? del : sub);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

// ── Per-entity normalisers ──────────────────────────────────────────────────

function normSku(s: string): string {
  return s.trim().toUpperCase();
}

function normDealer(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

function normSite(s: string): string {
  // Hyphens collapse to spaces, then whitespace collapses to single space.
  return s.trim().toUpperCase().replace(/-/g, " ").replace(/\s+/g, " ");
}

function bandOf(d: number): Band {
  if (d === 0) return "HIGH";
  if (d <= 2)  return "MEDIUM";
  if (d <= 4)  return "LOW";
  return "UNRESOLVED";
}

function findClosest(varNorm: string, masters: MasterEntry[]): { master: string; dist: number } {
  let bestRaw  = "";
  let bestDist = DIST_CAP + 1;
  for (const m of masters) {
    const d = levCapped(varNorm, m.normalized, DIST_CAP);
    if (d < bestDist) {
      bestDist = d;
      bestRaw  = m.raw;
      if (d === 0) break;
    }
  }
  return { master: bestRaw, dist: bestDist };
}

// ── Core audit ──────────────────────────────────────────────────────────────

function runAudit(
  masters:   string[],
  normalize: (s: string) => string,
  scans:     ScanSource[],
): EntityResult {
  const masterRawSet  = new Set(masters);
  const normalizedMasters: MasterEntry[] = masters.map((m) => ({
    raw:        m,
    normalized: normalize(m),
  }));

  const variants = new Map<string, { locations: Location[] }>();
  const seenScanned = new Map<Source, number>();

  for (const scan of scans) {
    const prev = seenScanned.get(scan.source) ?? 0;
    seenScanned.set(scan.source, Math.max(prev, scan.rows.length));

    for (const row of scan.rows) {
      if (row.raw == null) continue;
      const raw = row.raw;
      if (raw.trim() === "") continue;
      // Skip rows whose raw value already matches a master exactly
      // (already canonical; no action needed).
      if (masterRawSet.has(raw)) continue;

      let v = variants.get(raw);
      if (!v) {
        v = { locations: [] };
        variants.set(raw, v);
      }
      let loc = v.locations.find((l) => l.source === scan.source && l.column === scan.column);
      if (!loc) {
        loc = { source: scan.source, column: scan.column, count: 0, samples: [] };
        v.locations.push(loc);
      }
      loc.count += 1;
      if (loc.samples.length < 5 && !loc.samples.includes(row.sampleId)) {
        loc.samples.push(row.sampleId);
      }
    }
  }

  const out: Variant[] = [];
  for (const entry of Array.from(variants.entries())) {
    const raw  = entry[0];
    const vv   = entry[1];
    const norm = normalize(raw);
    const { master, dist } = findClosest(norm, normalizedMasters);
    const band = bandOf(dist);
    out.push({
      raw,
      normalized:    norm,
      closestMaster: band === "UNRESOLVED" ? null : master,
      distance:      dist,
      band,
      locations:     vv.locations,
    });
  }

  return {
    variants: out,
    scannedRows: Array.from(seenScanned.entries()).map(([source, total]) => ({ source, total })),
  };
}

// ── Report formatting ───────────────────────────────────────────────────────

function totalRows(v: Variant): number {
  return v.locations.reduce((s, l) => s + l.count, 0);
}

function sampleLabelFor(source: Source): string {
  // sampling_recipes + sampling_register both expose samplingNo as the
  // useful natural reference; sampling_usage_log uses its primary id.
  return source === "sampling_usage_log" ? "id examples" : "samplingNo examples";
}

function formatReport(entity: string, result: EntityResult): string {
  const lines: string[] = [];
  lines.push("SAMPLING LIBRARY — NORMALISATION AUDIT");
  lines.push(`Entity: ${entity}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  const totalsStr = result.scannedRows
    .map((s) => `${s.source}=${s.total}`)
    .join(", ");
  lines.push(`Source rows scanned: ${totalsStr}`);
  lines.push("");

  const byBand: Record<Band, Variant[]> = { HIGH: [], MEDIUM: [], LOW: [], UNRESOLVED: [] };
  for (const v of result.variants) byBand[v.band].push(v);

  const bandOrder: Band[] = ["HIGH", "MEDIUM", "LOW", "UNRESOLVED"];
  for (const band of bandOrder) {
    lines.push(`=== ${band} ===`);
    const items = [...byBand[band]].sort((a, b) => totalRows(b) - totalRows(a));
    if (items.length === 0) {
      lines.push("(none)");
    } else {
      for (const v of items) {
        lines.push(`"${v.raw}"`);
        if (band !== "UNRESOLVED" && v.closestMaster !== null) {
          lines.push(`  → "${v.closestMaster}"  (distance=${v.distance}, band=${band})`);
        }
        lines.push(`  Found in:`);
        const sortedLocs = [...v.locations].sort((a, b) =>
          `${a.source}.${a.column}`.localeCompare(`${b.source}.${b.column}`),
        );
        for (const loc of sortedLocs) {
          const samplesStr = loc.samples.map(String).join(", ");
          const ellipsis   = loc.samples.length === 5 ? ", ..." : "";
          lines.push(
            `    ${loc.source}.${loc.column}: ${loc.count} ${loc.count === 1 ? "row" : "rows"} (${sampleLabelFor(loc.source)}: ${samplesStr}${ellipsis})`,
          );
        }
        lines.push("");
      }
    }
    lines.push("");
  }

  lines.push("=== SUMMARY ===");
  for (const band of bandOrder) {
    const variants = byBand[band].length;
    const rows = byBand[band].reduce((s, v) => s + totalRows(v), 0);
    lines.push(`${band}: ${variants} variants affecting ${rows} database rows`);
  }
  return lines.join("\n") + "\n";
}

// ── Main ────────────────────────────────────────────────────────────────────

// ── Shared loader: scan tables + masters + per-entity audit results ────────

interface AuditPass {
  skuResult:    EntityResult;
  dealerResult: EntityResult;
  siteResult:   EntityResult;
}

async function loadAndAuditAll(): Promise<AuditPass> {
  // Load scan data — one query per table, reused across the 3 entity audits.
  console.log("Loading scan data (sequential)...");
  const recipes = await prisma.sampling_recipes.findMany({
    select: { id: true, samplingNo: true, skuCode: true },
  });
  console.log(`  sampling_recipes:    ${recipes.length} rows`);

  const usageLogs = await prisma.sampling_usage_log.findMany({
    select: { id: true, skuCodeRaw: true, dealerNameRaw: true, siteNameRaw: true },
  });
  console.log(`  sampling_usage_log:  ${usageLogs.length} rows`);

  const register = await prisma.sampling_register.findMany({
    select: { samplingNo: true, dealerName: true, siteNameRaw: true },
  });
  console.log(`  sampling_register:   ${register.length} rows`);
  console.log("");

  // Load masters.
  console.log("Loading masters (sequential)...");
  const skuMasterRows = await prisma.sku_master.findMany({ select: { skuCode: true } });
  const skuMasters   = skuMasterRows.map((r) => r.skuCode);
  console.log(`  sku_master:                                ${skuMasters.length} rows`);

  const dealerMasterRows = await prisma.delivery_point_master.findMany({
    where:  { customerType: { name: "Dealer" } },
    select: { customerName: true },
  });
  const dealerMasters = dealerMasterRows.map((r) => r.customerName);
  console.log(`  delivery_point_master (customerType=Dealer): ${dealerMasters.length} rows`);

  const siteMasterRows = await prisma.delivery_point_master.findMany({
    where:  { customerType: { name: "Site" } },
    select: { customerName: true },
  });
  const siteMasters = siteMasterRows.map((r) => r.customerName);
  console.log(`  delivery_point_master (customerType=Site):   ${siteMasters.length} rows`);
  console.log("");

  console.log("Auditing SKUs...");
  const skuResult = runAudit(skuMasters, normSku, [
    { source: "sampling_recipes",   column: "skuCode",    rows: recipes.map((r) => ({ raw: r.skuCode,    sampleId: r.samplingNo })) },
    { source: "sampling_usage_log", column: "skuCodeRaw", rows: usageLogs.map((u) => ({ raw: u.skuCodeRaw, sampleId: u.id })) },
  ]);

  console.log("Auditing Dealers...");
  const dealerResult = runAudit(dealerMasters, normDealer, [
    { source: "sampling_register",  column: "dealerName",     rows: register.map((r) => ({ raw: r.dealerName,    sampleId: r.samplingNo })) },
    { source: "sampling_usage_log", column: "dealerNameRaw",  rows: usageLogs.map((u) => ({ raw: u.dealerNameRaw, sampleId: u.id })) },
  ]);

  console.log("Auditing Sites...");
  const siteResult = runAudit(siteMasters, normSite, [
    { source: "sampling_register",  column: "siteNameRaw", rows: register.map((r) => ({ raw: r.siteNameRaw, sampleId: r.samplingNo })) },
    { source: "sampling_usage_log", column: "siteNameRaw", rows: usageLogs.map((u) => ({ raw: u.siteNameRaw, sampleId: u.id })) },
  ]);

  return { skuResult, dealerResult, siteResult };
}

function tally(result: EntityResult): Record<Band, number> {
  const out: Record<Band, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, UNRESOLVED: 0 };
  for (const v of result.variants) out[v.band] += 1;
  return out;
}

// ── Commit-mode helpers ────────────────────────────────────────────────────

function getIstDatestamp(): string {
  // YYYYMMDD in Asia/Kolkata. Used as suffix on backup table names.
  const istIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return istIso.replace(/-/g, "");
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS(
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = ${name}
    ) AS "exists"
  `;
  return rows[0]?.exists === true;
}

function askYesNo(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    let resolved = false;
    const done = (value: string): void => {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(value);
    };
    rl.question(prompt, (answer) => done(answer));
    rl.on("close", () => done(""));
  });
}

// ── Audit mode ─────────────────────────────────────────────────────────────

async function runAuditMode(): Promise<void> {
  console.log("=== SAMPLING LIBRARY NORMALISATION AUDIT ===");
  console.log("");

  const { skuResult, dealerResult, siteResult } = await loadAndAuditAll();

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const skuPath    = path.join(REPORT_DIR, "audit-skus.txt");
  const dealerPath = path.join(REPORT_DIR, "audit-dealers.txt");
  const sitePath   = path.join(REPORT_DIR, "audit-sites.txt");

  fs.writeFileSync(skuPath,    formatReport("SKU codes",    skuResult));
  fs.writeFileSync(dealerPath, formatReport("Dealer names", dealerResult));
  fs.writeFileSync(sitePath,   formatReport("Site names",   siteResult));

  const sSku    = tally(skuResult);
  const sDealer = tally(dealerResult);
  const sSite   = tally(siteResult);

  console.log("");
  console.log("=== AUDIT SUMMARY ===");
  console.log("Entity   | HIGH | MEDIUM | LOW | UNRESOLVED");
  console.log("---------+------+--------+-----+-----------");
  console.log(`SKUs     | ${String(sSku.HIGH).padStart(4)} | ${String(sSku.MEDIUM).padStart(6)} | ${String(sSku.LOW).padStart(3)} | ${String(sSku.UNRESOLVED).padStart(10)}`);
  console.log(`Dealers  | ${String(sDealer.HIGH).padStart(4)} | ${String(sDealer.MEDIUM).padStart(6)} | ${String(sDealer.LOW).padStart(3)} | ${String(sDealer.UNRESOLVED).padStart(10)}`);
  console.log(`Sites    | ${String(sSite.HIGH).padStart(4)} | ${String(sSite.MEDIUM).padStart(6)} | ${String(sSite.LOW).padStart(3)} | ${String(sSite.UNRESOLVED).padStart(10)}`);
  console.log("");
  console.log("Reports written:");
  console.log(`  ${skuPath}`);
  console.log(`  ${dealerPath}`);
  console.log(`  ${sitePath}`);
}

// ── Commit mode ────────────────────────────────────────────────────────────

const COMMIT_SCOPE: Record<"SKUs" | "Dealers" | "Sites", Band[]> = {
  SKUs:    ["HIGH"],
  Dealers: ["HIGH", "MEDIUM"],
  Sites:   ["HIGH"],
};

async function runCommitMode(): Promise<void> {
  console.log("=== SAMPLING LIBRARY NORMALISATION — COMMIT MODE ===");
  console.log("");

  // 1) Date suffix for backup tables.
  const datestamp = getIstDatestamp();
  if (!/^\d{8}$/.test(datestamp)) {
    throw new Error(`Invalid datestamp computed: "${datestamp}"`);
  }
  const backups = {
    sampling_recipes:   `sampling_recipes_backup_${datestamp}`,
    sampling_usage_log: `sampling_usage_log_backup_${datestamp}`,
    sampling_register:  `sampling_register_backup_${datestamp}`,
  } as const;

  // 2) Pre-check — abort if ANY backup already exists.
  for (const name of [backups.sampling_recipes, backups.sampling_usage_log, backups.sampling_register]) {
    if (await tableExists(name)) {
      console.error(`Backup table ${name} already exists. Drop it manually or change date suffix before re-running.`);
      process.exit(1);
    }
  }

  // 3) Create backups + verify row counts.
  console.log("Creating backups (sequential)...");
  async function backupTable(source: keyof typeof backups): Promise<void> {
    const target = backups[source];
    // Datestamp is validated as 8 digits above; source is a known literal.
    await prisma.$executeRawUnsafe(`CREATE TABLE ${target} AS SELECT * FROM ${source}`);
    const sourceCount = source === "sampling_recipes"
      ? await prisma.sampling_recipes.count()
      : source === "sampling_usage_log"
        ? await prisma.sampling_usage_log.count()
        : await prisma.sampling_register.count();
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM ${target}`,
    );
    const backupCount = Number(rows[0]?.count ?? 0);
    if (backupCount !== sourceCount) {
      throw new Error(`Backup count mismatch on ${target}: source=${sourceCount}, backup=${backupCount}`);
    }
    console.log(`  Backed up ${source}: ${sourceCount} rows → ${target}`);
  }
  await backupTable("sampling_recipes");
  await backupTable("sampling_usage_log");
  await backupTable("sampling_register");
  console.log("");

  // 4) Re-run audit pass in-memory to reflect current state (idempotent).
  const pass = await loadAndAuditAll();

  // 5) Filter to in-scope bands per entity.
  function inScope(entity: keyof typeof COMMIT_SCOPE, result: EntityResult): Variant[] {
    const allow = new Set(COMMIT_SCOPE[entity]);
    return result.variants.filter((v) => allow.has(v.band) && v.closestMaster !== null);
  }
  const skuPicks    = inScope("SKUs",    pass.skuResult);
  const dealerPicks = inScope("Dealers", pass.dealerResult);
  const sitePicks   = inScope("Sites",   pass.siteResult);

  // 6) Preview.
  function rowsOf(v: Variant): number {
    return v.locations.reduce((s, l) => s + l.count, 0);
  }
  function locBreakdown(v: Variant): string {
    return v.locations.map((l) => `${l.source}.${l.column}=${l.count}`).join(", ");
  }
  function previewBlock(label: string, picks: Variant[]): void {
    const total = picks.reduce((s, v) => s + rowsOf(v), 0);
    console.log(`${label} (${picks.length} variants, ~${total} rows):`);
    for (const v of picks) {
      const distNote = v.band === "HIGH" ? "HIGH" : `${v.band}, distance=${v.distance}`;
      console.log(`  '${v.raw}' → '${v.closestMaster}' (${distNote}, ${rowsOf(v)} rows — ${locBreakdown(v)})`);
    }
    console.log("");
  }

  console.log("=== NORMALISATION PREVIEW ===");
  previewBlock(`SKUs (HIGH band)`,           skuPicks);
  previewBlock(`Dealers (HIGH + MEDIUM)`,    dealerPicks);
  previewBlock(`Sites (HIGH band)`,          sitePicks);

  const totalVariants = skuPicks.length + dealerPicks.length + sitePicks.length;
  const totalRows     = [skuPicks, dealerPicks, sitePicks]
    .flat()
    .reduce((s, v) => s + rowsOf(v), 0);
  console.log("=== TOTALS ===");
  console.log(`Variants to normalise: ${totalVariants}`);
  console.log(`Database rows affected: ${totalRows} (sum across all tables and bands)`);
  console.log(`Backup tables created: 3 (with date suffix _${datestamp})`);
  console.log("");

  if (totalVariants === 0) {
    console.log("Nothing to update. Backups remain in place. Exiting.");
    return;
  }

  // 7) Confirmation.
  const answer = await askYesNo("Type 'yes' to proceed with UPDATE, anything else to abort: ");
  if (answer !== "yes") {
    console.log("Aborted. Backups remain in place for inspection.");
    return;
  }
  console.log("");

  // 8) UPDATE execution — sequential awaits. Halt on first failure.
  console.log("Running UPDATEs (sequential)...");
  console.log("");
  let skuRowsUpdated    = 0;
  let dealerRowsUpdated = 0;
  let siteRowsUpdated   = 0;

  // SKUs — sampling_recipes.skuCode + sampling_usage_log.skuCodeRaw
  console.log("SKUs:");
  for (const v of skuPicks) {
    const canonical = v.closestMaster!;
    const raw       = v.raw;
    const recipesN = Number(await prisma.$executeRaw`
      UPDATE sampling_recipes SET "skuCode" = ${canonical} WHERE "skuCode" = ${raw}
    `);
    const usageN = Number(await prisma.$executeRaw`
      UPDATE sampling_usage_log SET "skuCodeRaw" = ${canonical} WHERE "skuCodeRaw" = ${raw}
    `);
    skuRowsUpdated += recipesN + usageN;
    console.log(`  '${raw}' → '${canonical}': recipes=${recipesN}, usage_log=${usageN}`);
  }
  console.log("");

  // Dealers — sampling_register.dealerName + sampling_usage_log.dealerNameRaw
  console.log("Dealers:");
  for (const v of dealerPicks) {
    const canonical = v.closestMaster!;
    const raw       = v.raw;
    const regN = Number(await prisma.$executeRaw`
      UPDATE sampling_register SET "dealerName" = ${canonical} WHERE "dealerName" = ${raw}
    `);
    const usageN = Number(await prisma.$executeRaw`
      UPDATE sampling_usage_log SET "dealerNameRaw" = ${canonical} WHERE "dealerNameRaw" = ${raw}
    `);
    dealerRowsUpdated += regN + usageN;
    console.log(`  '${raw}' → '${canonical}': register=${regN}, usage_log=${usageN}`);
  }
  console.log("");

  // Sites — sampling_register.siteNameRaw + sampling_usage_log.siteNameRaw
  console.log("Sites:");
  for (const v of sitePicks) {
    const canonical = v.closestMaster!;
    const raw       = v.raw;
    const regN = Number(await prisma.$executeRaw`
      UPDATE sampling_register SET "siteNameRaw" = ${canonical} WHERE "siteNameRaw" = ${raw}
    `);
    const usageN = Number(await prisma.$executeRaw`
      UPDATE sampling_usage_log SET "siteNameRaw" = ${canonical} WHERE "siteNameRaw" = ${raw}
    `);
    siteRowsUpdated += regN + usageN;
    console.log(`  '${raw}' → '${canonical}': register=${regN}, usage_log=${usageN}`);
  }
  console.log("");

  // 9) Re-match step — populate siteId on sampling_register where the
  //    canonical siteNameRaw now matches exactly one Site-type
  //    delivery_point_master row (case-insensitive trimmed).
  console.log("Re-matching sites to delivery_point_master (customerTypeId=6)...");
  const siteTypeMaster = await prisma.delivery_point_master.findMany({
    where:  { customerTypeId: 6 },
    select: { id: true, customerName: true },
  });
  const byNormName = new Map<string, number[]>();
  for (const m of siteTypeMaster) {
    const key = m.customerName.trim().toLowerCase();
    const arr = byNormName.get(key);
    if (arr) arr.push(m.id);
    else byNormName.set(key, [m.id]);
  }

  const unmatched = await prisma.sampling_register.findMany({
    where:  { siteId: null, siteNameRaw: { not: null } },
    select: { samplingNo: true, siteNameRaw: true },
  });

  let rematched = 0;
  for (const row of unmatched) {
    const key = (row.siteNameRaw ?? "").trim().toLowerCase();
    if (!key) continue;
    const ids = byNormName.get(key);
    if (!ids || ids.length !== 1) continue;
    await prisma.sampling_register.update({
      where: { samplingNo: row.samplingNo },
      data:  { siteId: ids[0], siteNameRaw: null },
    });
    rematched += 1;
  }
  const stillUnmatched = unmatched.length - rematched;
  console.log(`Re-matched ${rematched} sites to delivery_point_master, ${stillUnmatched} still unmatched`);
  console.log("");
  console.log("Note: sampling_usage_log has no siteId column — re-match applies to sampling_register only.");
  console.log("");

  // 10) Final summary.
  console.log("=== DONE ===");
  console.log(`SKU rows updated:    ${skuRowsUpdated}`);
  console.log(`Dealer rows updated: ${dealerRowsUpdated}`);
  console.log(`Site rows updated:   ${siteRowsUpdated}`);
  console.log(`Sites re-matched to master: ${rematched}`);
  console.log(`Backup tables: ${backups.sampling_recipes}, ${backups.sampling_usage_log}, ${backups.sampling_register}`);
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args    = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith("--mode=")) ?? "--mode=audit";
  const mode    = modeArg.split("=")[1] ?? "audit";

  if (mode === "audit") {
    await runAuditMode();
  } else if (mode === "commit") {
    await runCommitMode();
  } else {
    console.error(`Unknown mode: ${mode}. Use --mode=audit or --mode=commit`);
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
