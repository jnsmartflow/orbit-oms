// scripts/list-missing-skus.ts
//
// Read-only diagnostic: list SKU codes that appear in the sampling Excel but
// are NOT present in sku-master.xlsx. Mirrors the SKU-extraction and
// master-loading logic from scripts/classify-sampling-excel.ts (inlined —
// no shared module exists). Does not modify any input or run the classifier.
//
// Run: npx tsx scripts/list-missing-skus.ts

import * as XLSX from "xlsx";
import * as path from "path";
import * as fs from "fs";

// ── Paths ────────────────────────────────────────────────────────────────────
const SOURCE_PATH     = "docs/plans/Tinting data Tracker_N.xlsx";
const SKU_MASTER_PATH = "docs/plans/sampling-register/sku-master.xlsx";
const OUTPUT_PATH     = "docs/plans/sampling-register/missing-skus.txt";

// ── SKU master loader (mirror of classify-sampling-excel.ts) ────────────────

function normaliseWhitespace(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/[\s ]+/g, " ").trim();
}

function looksLikeHeaderRow(row: unknown[] | undefined): boolean {
  if (!Array.isArray(row)) return false;
  const cells = row.map((c) => (c == null ? "" : String(c).toLowerCase()));
  const hasCode = cells.some((c) => /\bcode\b/.test(c));
  const hasDesc = cells.some((c) => /description/.test(c));
  return hasCode && hasDesc;
}

function loadSkuMasterKeys(): Set<string> {
  const wb = XLSX.readFile(SKU_MASTER_PATH, { cellDates: false });
  const keys = new Set<string>();

  const addKey = (sku: string): void => {
    if (!sku) return;
    keys.add(sku);
  };

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    if (raw.length === 0) continue;

    const dataStart = looksLikeHeaderRow(raw[0]) ? 1 : 2;
    const numCols = Math.max(...raw.map((r) => (Array.isArray(r) ? r.length : 0)));

    for (let r = dataStart; r < raw.length; r++) {
      const row = raw[r];
      if (!Array.isArray(row)) continue;
      if (row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;

      if (numCols >= 4) {
        // pair-of-pairs: [genericCode, genericDesc, secondaryCode, secondaryDesc]
        addKey(normaliseWhitespace(row[0]));
        addKey(normaliseWhitespace(row[2]));
      } else {
        addKey(normaliseWhitespace(row[0]));
      }
    }
  }

  return keys;
}

// ── Generic helpers (mirror) ────────────────────────────────────────────────

function headerNorm(s: string): string {
  return s.toLowerCase().replace(/[\s_.\-/()]+/g, "");
}

interface ColumnMap {
  samplingNo: number | null;
  skuCode:    number | null;
  dateRaw:    number | null;
}

function findColumn(headers: string[], patterns: RegExp[]): number | null {
  const norm = headers.map(headerNorm);
  for (let i = 0; i < norm.length; i++) {
    for (const re of patterns) {
      if (re.test(norm[i])) return i;
    }
  }
  return null;
}

function buildColumnMap(headers: string[]): ColumnMap {
  return {
    samplingNo: findColumn(headers, [/^(sampling(no|number)?|sno|sampleno|sl)$/]),
    skuCode:    findColumn(headers, [/^(sku(code)?|material(code|no|number)?|basesku|matcode)$/]),
    dateRaw:    findColumn(headers, [/^(date|createdat|createdon|tidate|tintingdate|entrydate|orderdate)$/]),
  };
}

function toStrTrimmed(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toIntOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (Math.floor(v) !== v) return null;
    return v > 0 ? v : null;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
}

// ── Date formatting ─────────────────────────────────────────────────────────
// Source is read with cellDates:false (mirror of classifier), so date cells
// arrive as Excel serial numbers. Convert to ISO YYYY-MM-DD when possible;
// otherwise fall back to the raw trimmed string.
function formatDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    // Excel epoch is 1899-12-30 (accounting for the 1900 leap-year bug)
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()) && /[-/]/.test(s)) {
    return parsed.toISOString().slice(0, 10);
  }
  return s;
}

// ── Main ────────────────────────────────────────────────────────────────────

interface MissingEntry {
  rowCount:      number;
  samplingNoSet: Set<number>;
  firstSeen:     string | null;
  lastSeen:      string | null;
}

function main(): void {
  if (!fs.existsSync(SOURCE_PATH)) {
    console.error(`Source file not found: ${SOURCE_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(SKU_MASTER_PATH)) {
    console.error(`SKU master not found: ${SKU_MASTER_PATH}`);
    process.exit(1);
  }

  const masterKeys = loadSkuMasterKeys();
  const wb = XLSX.readFile(SOURCE_PATH, { cellDates: false });

  const missingMap = new Map<string, MissingEntry>();
  const foundSkus  = new Set<string>();
  let totalRows = 0;

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const headers: string[] = ((raw[0] ?? []) as unknown[]).map((c) => (c == null ? "" : String(c)));
    const cm = buildColumnMap(headers);
    // Mirror classifier's inclusion rule — only sheets with a sampling-no column.
    if (cm.samplingNo == null) continue;

    for (let r = 1; r < raw.length; r++) {
      const row = raw[r];
      if (!Array.isArray(row)) continue;
      if (row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;

      totalRows += 1;

      const skuCode = cm.skuCode != null ? toStrTrimmed(row[cm.skuCode]) : "";
      if (!skuCode) continue; // blank SKU is not a "missing" SKU

      if (masterKeys.has(skuCode)) {
        foundSkus.add(skuCode);
        continue;
      }

      const samplingNo = cm.samplingNo != null ? toIntOrNull(row[cm.samplingNo]) : null;
      const dateStr    = cm.dateRaw   != null ? formatDate(row[cm.dateRaw]) : null;

      let entry = missingMap.get(skuCode);
      if (!entry) {
        entry = { rowCount: 0, samplingNoSet: new Set<number>(), firstSeen: null, lastSeen: null };
        missingMap.set(skuCode, entry);
      }
      entry.rowCount += 1;
      if (samplingNo != null) entry.samplingNoSet.add(samplingNo);
      if (dateStr) {
        if (entry.firstSeen == null || dateStr < entry.firstSeen) entry.firstSeen = dateStr;
        if (entry.lastSeen  == null || dateStr > entry.lastSeen)  entry.lastSeen  = dateStr;
      }
    }
  }

  const totalUniqueSku = new Set<string>([
    ...Array.from(foundSkus),
    ...Array.from(missingMap.keys()),
  ]).size;

  const missingArr = Array.from(missingMap.entries())
    .map(([sku, e]) => ({
      sku,
      rowCount:        e.rowCount,
      samplingNoCount: e.samplingNoSet.size,
      firstSeen:       e.firstSeen ?? "",
      lastSeen:        e.lastSeen  ?? "",
    }))
    .sort((a, b) => b.rowCount - a.rowCount || a.sku.localeCompare(b.sku));

  // ── Terminal print ────────────────────────────────────────────────────────
  console.log("===== Missing SKU summary =====");
  console.log(`Total rows in sampling Excel:        ${totalRows}`);
  console.log(`Total unique SKUs in sampling Excel: ${totalUniqueSku}`);
  console.log(`Unique SKUs found in master:         ${foundSkus.size}`);
  console.log(`Unique SKUs MISSING from master:     ${missingArr.length}`);
  console.log("");
  console.log("Top 50 missing SKUs by row count:");
  console.log("  SKU                | Rows | Sampling Nos | First seen | Last seen");
  console.log("  -------------------+------+--------------+------------+-----------");
  for (const e of missingArr.slice(0, 50)) {
    const skuCol = e.sku.padEnd(18).slice(0, 18);
    const rows   = String(e.rowCount).padStart(4);
    const snos   = String(e.samplingNoCount).padStart(12);
    const first  = (e.firstSeen || "—").padEnd(10).slice(0, 10);
    const last   = (e.lastSeen  || "—").padEnd(10).slice(0, 10);
    console.log(`  ${skuCol} | ${rows} | ${snos} | ${first} | ${last}`);
  }

  // ── Write txt (LF endings) ────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  const lines = missingArr.map((e) =>
    [e.sku, e.rowCount, e.samplingNoCount, e.firstSeen, e.lastSeen].join("\t"),
  );
  fs.writeFileSync(OUTPUT_PATH, lines.join("\n") + "\n", { encoding: "utf8" });

  console.log("");
  console.log(`Full list written to ${OUTPUT_PATH} (${missingArr.length} lines).`);
  console.log("Awaiting Smart Flow direction on options A / B / C.");
}

main();
