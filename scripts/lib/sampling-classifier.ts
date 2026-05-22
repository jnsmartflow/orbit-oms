// scripts/lib/sampling-classifier.ts
//
// Shared classification logic for the sampling-Excel pipeline. Consumed by
// scripts/classify-sampling-excel.ts (writes the working REVIEWED.xlsx) and
// scripts/generate-final-review-xlsx.ts (writes the formatted FINAL_REVIEW.xlsx).
//
// Pure logic only — no console output, no file writes. Callers handle I/O.

import * as XLSX from "xlsx";

// ── Paths ────────────────────────────────────────────────────────────────────
export const SOURCE_PATH     = "docs/plans/Tinting data Tracker_N.xlsx";
export const STOCK_PATH      = "docs/plans/sampling-register/stock 21.05.2026.xlsx";
export const SKU_MASTER_PATH = "docs/plans/sampling-register/sku-master.xlsx";

// ── Pigment columns (TINTER only — ACOTONE absent in source) ────────────────
export const TINTER_CODES = [
  "YOX","LFY","GRN","TBL","WHT","MAG","FFR","BLK","OXR","HEY","HER","COB","COG",
] as const;
export type PigmentCode = (typeof TINTER_CODES)[number];

export const PIGMENT_HEADER_ALIASES: Record<string, PigmentCode> = {
  CBO: "COB",
  CGO: "COG",
};

// ── Pack extraction ──────────────────────────────────────────────────────────
export function extractPackCode(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const trimmed = String(desc).trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/);
  const tail = tokens[tokens.length - 1].toUpperCase();

  const normalized = tail
    .replace(/LTR$/, "L")
    .replace(/LT$/,  "L")
    .replace(/KG$/,  "L");

  const map: Record<string, string> = {
    "0.9L": "L_0_9",
    "1L":   "L_1",
    "3.6L": "L_3_6",
    "4L":   "L_4",
    "9L":   "L_9",
    "10L":  "L_10",
    "18L":  "L_18",
    "20L":  "L_20",
  };
  return map[normalized] ?? null;
}

// ── SKU master loader (legacy 9-sheet pair-of-pairs structure) ──────────────

export interface SkuMasterLoad {
  map:              Map<string, string>;
  collisions:       Array<{ sku: string; existing: string; incoming: string }>;
  sheetsProcessed:  number;
}

export function normaliseWhitespace(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/[\s ]+/g, " ").trim();
}

export function looksLikeHeaderRow(row: unknown[] | undefined): boolean {
  if (!Array.isArray(row)) return false;
  const cells = row.map((c) => (c == null ? "" : String(c).toLowerCase()));
  const hasCode = cells.some((c) => /\bcode\b/.test(c));
  const hasDesc = cells.some((c) => /description/.test(c));
  return hasCode && hasDesc;
}

export function loadSkuMaster(): SkuMasterLoad {
  const wb = XLSX.readFile(SKU_MASTER_PATH, { cellDates: false });
  const map = new Map<string, string>();
  const collisions: SkuMasterLoad["collisions"] = [];
  let sheetsProcessed = 0;

  function addEntry(sku: string, desc: string): void {
    if (!sku || !desc) return;
    const existing = map.get(sku);
    if (existing !== undefined) {
      if (existing !== desc) collisions.push({ sku, existing, incoming: desc });
      return;
    }
    map.set(sku, desc);
  }

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    if (raw.length === 0) continue;

    const dataStart = looksLikeHeaderRow(raw[0]) ? 1 : 2;
    const numCols = Math.max(...raw.map((r) => (Array.isArray(r) ? r.length : 0)));
    sheetsProcessed += 1;

    for (let r = dataStart; r < raw.length; r++) {
      const row = raw[r];
      if (!Array.isArray(row)) continue;
      if (row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;

      if (numCols >= 4) {
        addEntry(normaliseWhitespace(row[0]), normaliseWhitespace(row[1]));
        addEntry(normaliseWhitespace(row[2]), normaliseWhitespace(row[3]));
      } else {
        addEntry(normaliseWhitespace(row[0]), normaliseWhitespace(row[1]));
      }
    }
  }

  return { map, collisions, sheetsProcessed };
}

// ── Stock master loader (SAP flat structure) ────────────────────────────────

export interface StockMasterLoad {
  map:        Map<string, string>;
  collisions: number;
}

export function loadStockMaster(): StockMasterLoad {
  const wb = XLSX.readFile(STOCK_PATH, { cellDates: false });
  const map = new Map<string, string>();
  let collisions = 0;

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    for (let r = 1; r < raw.length; r++) {
      const row = raw[r];
      if (!Array.isArray(row)) continue;
      const material = row[0];
      const desc     = row[1];
      if (material == null || desc == null) continue;
      const key   = String(material).trim();
      const value = String(desc).trim();
      if (!key || !value) continue;
      if (map.has(key)) { collisions += 1; continue; }
      map.set(key, value);
    }
  }
  return { map, collisions };
}

// ── SKU lookup (stock primary, legacy fallback) ─────────────────────────────

export interface SkuLookup {
  desc:   string | null;
  source: "stock" | "legacy" | null;
}

export function lookupSku(
  stockMap:  Map<string, string>,
  legacyMap: Map<string, string>,
  sku:       string,
): SkuLookup {
  const key = String(sku).trim();
  if (!key) return { desc: null, source: null };
  const stockHit = stockMap.get(key);
  if (stockHit) return { desc: stockHit, source: "stock" };
  const legacyHit = legacyMap.get(key);
  if (legacyHit) return { desc: legacyHit, source: "legacy" };
  return { desc: null, source: null };
}

// ── Generic helpers ──────────────────────────────────────────────────────────

export function headerNorm(s: string): string {
  return s.toLowerCase().replace(/[\s_.\-/()]+/g, "");
}

export interface ColumnMap {
  samplingNo: number | null;
  shadeName:  number | null;
  skuCode:    number | null;
  desc:       number | null;
  dealerName: number | null;
  dateRaw:    number | null;
  pigments:   Partial<Record<PigmentCode, number>>;
}

export function findColumn(headers: string[], patterns: RegExp[]): number | null {
  const norm = headers.map(headerNorm);
  for (let i = 0; i < norm.length; i++) {
    for (const re of patterns) {
      if (re.test(norm[i])) return i;
    }
  }
  return null;
}

export function buildColumnMap(headers: string[]): ColumnMap {
  const trimmedUpper = headers.map((h) => h.trim().toUpperCase());
  const map: ColumnMap = {
    samplingNo: findColumn(headers, [/^(sampling(no|number)?|sno|sampleno|sl)$/]),
    shadeName:  findColumn(headers, [/^(shade(namecode|codename|name|code)?|colour(name)?|color(name)?)$/]),
    skuCode:    findColumn(headers, [/^(sku(code)?|material(code|no|number)?|basesku|matcode)$/]),
    desc:       findColumn(headers, [/^(desc|description)$/]),
    dealerName: findColumn(headers, [/^(dealer(name)?|customer(name)?|party(name)?|billto(name)?)$/]),
    dateRaw:    findColumn(headers, [/^(date|createdat|createdon|tidate|tintingdate|entrydate|orderdate)$/]),
    pigments:   {},
  };
  for (let i = 0; i < trimmedUpper.length; i++) {
    const h = trimmedUpper[i];
    if (!/^[A-Z]{3}$/.test(h)) continue;
    if ((TINTER_CODES as readonly string[]).includes(h)) {
      map.pigments[h as PigmentCode] = i;
      continue;
    }
    if (PIGMENT_HEADER_ALIASES[h]) {
      map.pigments[PIGMENT_HEADER_ALIASES[h]] = i;
    }
  }
  return map;
}

export function toIntOrNull(v: unknown): number | null {
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

export function isNonIntegerSampling(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v) && Math.floor(v) !== v;
  const s = String(v).trim();
  return /^\d+\.\d+$/.test(s);
}

export function toStrTrimmed(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export function toDecimal(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function descTailOf(desc: string): string {
  const tokens = desc.split(/\s+/).filter(Boolean);
  return tokens.length === 0 ? "" : tokens[tokens.length - 1];
}

// ── Row + sheet shapes ───────────────────────────────────────────────────────

export type UnknownPackReason =
  | "desc-unparseable"
  | "no-desc-no-master"
  | "no-desc-master-unparseable";

export interface NormalisedRow {
  sourceSheet:        string;
  sheetRowIdx:        number;
  samplingNo:         number | null;
  samplingRaw:        unknown;
  shadeName:          string;
  skuCode:            string;
  desc:               string;
  descBlank:          boolean;
  descTail:           string;
  packLabel:          string | null;
  packSource:         "desc" | "stock" | "legacy" | null;
  unknownPackReason:  UnknownPackReason | null;
  recoveredDesc:      string | null;
  dealerName:         string;
  dateRaw:            unknown;
  pigments:           Record<PigmentCode, number>;
  tinterType:         "TINTER";
  originalCells:      unknown[];
}

export interface SheetMeta {
  name:          string;
  headers:       string[];
  columnMap:     ColumnMap;
  included:      boolean;
  excludeReason: string;
}

export type Action = "IMPORT" | "REVIEW" | "SKIP";

export interface Decision {
  action:     Action;
  remarks:    string;
  shadeNames: string[];
  skuCodes:   string[];
  tinterType: string;
}

// ── Per-group decision ──────────────────────────────────────────────────────

export function decide(rows: NormalisedRow[]): Decision {
  const shadeSet  = new Set(rows.map((r) => r.shadeName.toLowerCase().trim()).filter(Boolean));
  const shadeRaw  = Array.from(new Set(rows.map((r) => r.shadeName.trim()).filter(Boolean)));
  const skuSet    = new Set(rows.map((r) => r.skuCode.trim()).filter(Boolean));
  const skuArr    = Array.from(skuSet);
  const blankShade = rows.filter((r) => !r.shadeName.trim()).length;
  const blankSku   = rows.filter((r) => !r.skuCode.trim()).length;

  if (blankShade === rows.length) {
    return { action: "SKIP", remarks: "all rows blank shade", shadeNames: [], skuCodes: skuArr, tinterType: "TINTER" };
  }
  if (blankSku === rows.length) {
    return { action: "SKIP", remarks: "all rows blank SKU", shadeNames: shadeRaw, skuCodes: [], tinterType: "TINTER" };
  }

  const descUnparseable          = rows.filter((r) => r.unknownPackReason === "desc-unparseable");
  const noDescNoMaster           = rows.filter((r) => r.unknownPackReason === "no-desc-no-master");
  const noDescMasterUnparseable  = rows.filter((r) => r.unknownPackReason === "no-desc-master-unparseable");

  const reasons: string[] = [];
  if (shadeSet.size >= 2) reasons.push(`multi-shade: ${shadeRaw.join(" / ")}`);
  if (blankShade > 0 && blankShade < rows.length) {
    reasons.push(`partial blank shadeName (${blankShade} of ${rows.length} rows)`);
  }
  if (descUnparseable.length > 0) {
    const tails = Array.from(new Set(descUnparseable.map((r) => r.descTail).filter(Boolean)));
    reasons.push(`unknown pack: ${tails.join(", ")}`);
  }
  if (noDescNoMaster.length > 0) {
    reasons.push("no DESC, SKU not in stock or legacy master");
  }
  if (noDescMasterUnparseable.length > 0) {
    const descs = Array.from(new Set(
      noDescMasterUnparseable.map((r) => r.recoveredDesc).filter((d): d is string => !!d),
    ));
    reasons.push(`no DESC, SKU in master but pack unrecognized: ${descs.join(" / ")}`);
  }

  if (reasons.length > 0) {
    return { action: "REVIEW", remarks: reasons.join(" | "), shadeNames: shadeRaw, skuCodes: skuArr, tinterType: "TINTER" };
  }
  return { action: "IMPORT", remarks: "", shadeNames: shadeRaw, skuCodes: skuArr, tinterType: "TINTER" };
}

// ── Full classification orchestrator ────────────────────────────────────────

export interface ClassificationResult {
  stockLoad:        StockMasterLoad;
  legacyLoad:       SkuMasterLoad;
  sheetMetas:       SheetMeta[];
  includedSheets:   SheetMeta[];
  canonHeaders:     string[];
  sheetRowsByName:  Map<string, NormalisedRow[]>;
  allRows:          NormalisedRow[];
  invalidRows:      NormalisedRow[];
  groups:           Map<number, NormalisedRow[]>;
  decisions:        Map<number, Decision>;
}

export function runClassification(wb: XLSX.WorkBook): ClassificationResult {
  const stockLoad  = loadStockMaster();
  const legacyLoad = loadSkuMaster();

  // ── Sheet inclusion ───────────────────────────────────────────────────────
  const sheetMetas: SheetMeta[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) {
      sheetMetas.push({ name, headers: [], columnMap: buildColumnMap([]), included: false, excludeReason: "sheet missing" });
      continue;
    }
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const headers: string[] = ((raw[0] ?? []) as unknown[]).map((c) => (c == null ? "" : String(c)));
    const map = buildColumnMap(headers);
    if (map.samplingNo == null) {
      sheetMetas.push({ name, headers, columnMap: map, included: false, excludeReason: "no sampling-no column found" });
    } else {
      sheetMetas.push({ name, headers, columnMap: map, included: true, excludeReason: "" });
    }
  }

  const includedSheets = sheetMetas.filter((m) => m.included);
  if (includedSheets.length === 0) {
    throw new Error("No sheets contain a sampling-number column.");
  }

  // ── Canonical header order ────────────────────────────────────────────────
  const canonHeaders: string[] = [...includedSheets[0].headers];
  const canonNameSet = new Set(canonHeaders.map((h) => h.trim().toLowerCase()));
  for (let s = 1; s < includedSheets.length; s++) {
    for (const h of includedSheets[s].headers) {
      const key = h.trim().toLowerCase();
      if (!canonNameSet.has(key)) {
        canonHeaders.push(h);
        canonNameSet.add(key);
      }
    }
  }

  // ── Read + normalise all rows ─────────────────────────────────────────────
  const allRows: NormalisedRow[] = [];
  const sheetRowsByName = new Map<string, NormalisedRow[]>();
  for (const m of includedSheets) {
    const sheet = wb.Sheets[m.name];
    if (!sheet) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const headers = m.headers;
    const cm = m.columnMap;
    const rowsForSheet: NormalisedRow[] = [];

    for (let r = 1; r < raw.length; r++) {
      const row = raw[r];
      if (!Array.isArray(row)) continue;
      if (row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;

      const samplingRaw = cm.samplingNo != null ? row[cm.samplingNo] : null;
      const samplingNo  = toIntOrNull(samplingRaw);
      const shadeName   = cm.shadeName != null ? toStrTrimmed(row[cm.shadeName]) : "";
      const skuCode     = cm.skuCode != null ? toStrTrimmed(row[cm.skuCode]) : "";
      const desc        = cm.desc != null ? toStrTrimmed(row[cm.desc]) : "";
      const descBlank   = desc === "";
      const descTail    = descBlank ? "" : descTailOf(desc);
      const dealerName  = cm.dealerName != null ? toStrTrimmed(row[cm.dealerName]) : "";
      const dateRaw     = cm.dateRaw != null ? row[cm.dateRaw] : null;

      let packLabel: string | null = extractPackCode(desc);
      let packSource: "desc" | "stock" | "legacy" | null = packLabel != null ? "desc" : null;
      let recoveredDesc: string | null = null;
      let unknownPackReason: UnknownPackReason | null = null;

      if (packLabel == null) {
        const lookup = lookupSku(stockLoad.map, legacyLoad.map, skuCode);
        if (lookup.desc) {
          const pack = extractPackCode(lookup.desc);
          if (pack) {
            packLabel     = pack;
            packSource    = lookup.source; // "stock" | "legacy"
            recoveredDesc = lookup.desc;
          } else {
            recoveredDesc     = lookup.desc;
            unknownPackReason = descBlank ? "no-desc-master-unparseable" : "desc-unparseable";
          }
        } else {
          unknownPackReason = descBlank ? "no-desc-no-master" : "desc-unparseable";
        }
      }

      const pigments = {} as Record<PigmentCode, number>;
      for (const code of TINTER_CODES) {
        const colIdx = cm.pigments[code];
        pigments[code] = colIdx != null ? toDecimal(row[colIdx]) : 0;
      }

      const original: unknown[] = canonHeaders.map((h) => {
        const idx = headers.findIndex((sh) => sh.trim().toLowerCase() === h.trim().toLowerCase());
        return idx >= 0 ? (row[idx] ?? null) : null;
      });

      const normRow: NormalisedRow = {
        sourceSheet: m.name,
        sheetRowIdx: r,
        samplingNo,
        samplingRaw,
        shadeName,
        skuCode,
        desc,
        descBlank,
        descTail,
        packLabel,
        packSource,
        unknownPackReason,
        recoveredDesc,
        dealerName,
        dateRaw,
        pigments,
        tinterType: "TINTER",
        originalCells: original,
      };
      rowsForSheet.push(normRow);
      allRows.push(normRow);
    }
    sheetRowsByName.set(m.name, rowsForSheet);
  }

  // ── Group by samplingNo ───────────────────────────────────────────────────
  const groups = new Map<number, NormalisedRow[]>();
  const invalidRows: NormalisedRow[] = [];
  for (const row of allRows) {
    if (row.samplingNo == null) {
      invalidRows.push(row);
      continue;
    }
    const existing = groups.get(row.samplingNo);
    if (existing) existing.push(row); else groups.set(row.samplingNo, [row]);
  }

  // ── Decide per group ──────────────────────────────────────────────────────
  const decisions = new Map<number, Decision>();
  for (const [no, rows] of Array.from(groups.entries())) {
    decisions.set(no, decide(rows));
  }

  return {
    stockLoad,
    legacyLoad,
    sheetMetas,
    includedSheets,
    canonHeaders,
    sheetRowsByName,
    allRows,
    invalidRows,
    groups,
    decisions,
  };
}
