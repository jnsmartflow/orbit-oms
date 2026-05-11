// Phase 1 dry-run preview generator — CSV input variant.
//
// The DB-backed scripts/preview-new-taxonomy.ts couldn't run from the
// dev sandbox (Supabase unreachable). This variant reads the same input
// from a static CSV snapshot of mo_sku_lookup distinct triples and runs
// the identical mapping pipeline. Output JSON is canonical per Phase 1
// Prompt 2's expected shape:
//   { summary{ totalLegacyTriples, totalNewRows, crossListedExtraRows,
//              skippedTriples, warnings, familiesProduced },
//     newRowsByFamily, skippedTriples[], warnings[] }
//
// Read-only — no DB calls. Reuses lib/mail-orders/taxonomy-mapping.ts
// untouched. Run with:
//   npx tsx scripts/preview-new-taxonomy-from-csv.ts

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  mapLegacyToNew,
  getSkipReason,
  type LegacyKey,
  type NewRow,
} from "../lib/mail-orders/taxonomy-mapping";

const IN_PATH  = path.join("docs", "prompts", "drafts", "mo_sku_lookup-triples-2026-05-06.csv");
const OUT_PATH = path.join("docs", "prompts", "drafts", "taxonomy-preview.json");

type CsvRow = {
  category:           string;
  product:            string;
  baseColour:         string;
  sku_count:          number;
  example_description: string;
};

type PreviewRow = NewRow & { skuCount: number };

type SkippedEntry = {
  category:   string;
  product:    string;
  baseColour: string;
  skuCount:   number;
  reason:     string;
};

type WarningEntry = {
  category:           string;
  product:            string;
  baseColour:         string;
  skuCount:           number;
  exampleDescription: string;
};

type Output = {
  capturedAt: string;
  source:     string;
  summary: {
    totalLegacyTriples:    number;
    totalLegacySkuCount:   number;
    totalNewRows:          number;     // post-suppression (matches newRowsByFamily exactly)
    crossListedExtraRows:  number;     // post-suppression (recomputed from final groups)
    suppressedPlainRows:   number;     // phantom PLAIN rows dropped — see suppressPhantomPlain()
    skippedTriples:        number;
    warnings:              number;
    familiesProduced:      number;
  };
  newRowsByFamily: Record<string, PreviewRow[]>;
  skippedTriples:  SkippedEntry[];
  warnings:        WarningEntry[];
};

// ── CSV parsing (RFC 4180 subset) ────────────────────────────────────────
//
// The input is a Supabase CSV export. Most rows are bare comma-split, but
// some `example_description` cells contain commas inside quoted fields —
// e.g. `"DN SAT FIN RICH BROWN  0,5 LTR"` (European decimal for 0.5 L).
// We need a proper state-machine parser that respects double-quotes and
// `""` escape sequences. No external dep added.
//
// Supports: quoted fields, embedded `,`, escaped `""` inside a quoted
// field, plain bare fields. Newlines inside quoted fields are out of
// scope — the data uses one record per physical line.

function parseCsv(raw: string): string[][] {
  const out: string[][] = [];
  const text = raw.replace(/\r\n/g, "\n");
  let i = 0;
  const n = text.length;

  while (i < n) {
    // Parse one record (line).
    const fields: string[] = [];
    let cur   = "";
    let quoted = false;

    while (i < n) {
      const c = text[i];

      if (quoted) {
        if (c === "\"") {
          // Could be end-quote or escaped "".
          if (text[i + 1] === "\"") { cur += "\""; i += 2; continue; }
          quoted = false; i++; continue;
        }
        cur += c; i++; continue;
      }

      // Not quoted.
      if (c === "\"" && cur === "") { quoted = true; i++; continue; }
      if (c === ",")                { fields.push(cur); cur = ""; i++; continue; }
      if (c === "\n")               { fields.push(cur); cur = ""; i++; break; }
      cur += c; i++;
    }
    // End of input mid-record (no trailing newline) — flush.
    if (i >= n && (cur !== "" || fields.length > 0)) {
      fields.push(cur);
    }
    if (fields.length > 0 && !(fields.length === 1 && fields[0] === "")) {
      out.push(fields.map((f) => f.trim()));
    }
  }
  return out;
}

async function readCsv(filePath: string): Promise<CsvRow[]> {
  const raw  = await fs.readFile(filePath, "utf8");
  const grid = parseCsv(raw);
  if (grid.length === 0) throw new Error(`Empty CSV: ${filePath}`);

  const header   = grid[0];
  const expected = ["category", "product", "baseColour", "sku_count", "example_description"];
  for (let j = 0; j < expected.length; j++) {
    if (header[j] !== expected[j]) {
      throw new Error(`CSV header mismatch at col ${j}: expected '${expected[j]}', got '${header[j]}'`);
    }
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cols = grid[i];
    if (cols.length !== expected.length) {
      throw new Error(
        `CSV row ${i + 1} has ${cols.length} columns, expected ${expected.length}. ` +
        `Possibly malformed quoting. First 120 chars of fields: ${cols.join(" | ").slice(0, 120)}…`,
      );
    }
    rows.push({
      category:            cols[0],
      product:             cols[1],
      baseColour:          cols[2],
      sku_count:           parseInt(cols[3], 10) || 0,
      example_description: cols[4],
    });
  }
  return rows;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const csvRows = await readCsv(IN_PATH);

  const newRowsByFamily: Record<string, PreviewRow[]> = {};
  const skippedTriples: SkippedEntry[] = [];
  const warnings:       WarningEntry[] = [];

  let totalNewRows         = 0;
  let crossListedExtraRows = 0;
  let totalLegacySkuCount  = 0;

  for (const r of csvRows) {
    totalLegacySkuCount += r.sku_count;
    const legacy: LegacyKey = {
      category:    r.category,
      product:     r.product,
      baseColour:  r.baseColour,
      description: r.example_description,
    };

    const result = mapLegacyToNew(legacy);
    if (result === null) {
      const reason = getSkipReason(legacy);
      if (reason) {
        skippedTriples.push({
          category:   r.category,
          product:    r.product,
          baseColour: r.baseColour,
          skuCount:   r.sku_count,
          reason,
        });
      } else {
        warnings.push({
          category:           r.category,
          product:            r.product,
          baseColour:         r.baseColour,
          skuCount:           r.sku_count,
          exampleDescription: r.example_description,
        });
      }
      continue;
    }

    if (result.length > 1) crossListedExtraRows += (result.length - 1);
    totalNewRows += result.length;

    for (const newRow of result) {
      const previewRow: PreviewRow = { ...newRow, skuCount: r.sku_count };
      if (!newRowsByFamily[newRow.family]) newRowsByFamily[newRow.family] = [];
      newRowsByFamily[newRow.family].push(previewRow);
    }
  }

  // ── Phantom PLAIN suppression ──────────────────────────────────────────
  // The mapping function returns rows as the legacy triple's baseColour
  // dictates — empty baseColour → PLAIN, non-empty → BASE_VARIANT/COLOUR.
  // When the SAME (family, subProduct) gets one PLAIN row from a triple
  // with empty baseColour AND non-PLAIN siblings from triples with bases
  // (e.g. SADOLIN LUXURIO MATT — generic + 90 BASE + 93 BASE + BLACK),
  // the PLAIN row is a phantom: it would render as an empty card on
  // /place-order with no underlying SKU.
  //
  // Rule: per (family, subProduct), if any row is BASE_VARIANT or COLOUR,
  // drop all PLAIN rows in that group. Single-PLAIN groups (genuine
  // single-SKU specialty products like VT MARBLE / SMOOTHOVER / VAF) are
  // preserved untouched.
  let suppressedPlainRows = 0;
  for (const fam of Object.keys(newRowsByFamily)) {
    const rows = newRowsByFamily[fam];
    const bySubProduct: Record<string, PreviewRow[]> = {};
    for (const r of rows) {
      (bySubProduct[r.subProduct] ??= []).push(r);
    }
    const kept: PreviewRow[] = [];
    for (const sp of Object.keys(bySubProduct)) {
      const grp        = bySubProduct[sp];
      const hasVariant = grp.some((r) => r.productType !== "PLAIN");
      if (hasVariant) {
        const filtered = grp.filter((r) => r.productType !== "PLAIN");
        suppressedPlainRows += (grp.length - filtered.length);
        kept.push(...filtered);
      } else {
        kept.push(...grp);
      }
    }
    newRowsByFamily[fam] = kept;
  }

  // ── Recompute totalNewRows + crossListedExtraRows post-suppression ────
  // Pre-suppression accumulators no longer match the final newRowsByFamily.
  // - totalNewRows: sum of row counts across families (matches JSON exactly).
  // - crossListedExtraRows: count distinct families that share the same
  //   (subProduct, baseColour). Use a Set of families per key — within-
  //   family duplicates (e.g. two legacy triples mapping to the same
  //   SUPERCLEAN/SUPERCLEAN/BRILLIANT WHITE under SUPERCLEAN family) do NOT
  //   count as cross-list extras; only multi-family appearances do.
  totalNewRows = 0;
  for (const fam of Object.keys(newRowsByFamily)) {
    totalNewRows += newRowsByFamily[fam].length;
  }
  const crossKeyFamilies = new Map<string, Set<string>>();
  for (const fam of Object.keys(newRowsByFamily)) {
    for (const r of newRowsByFamily[fam]) {
      const k = `${r.subProduct}|||${r.baseColour ?? ""}`;
      if (!crossKeyFamilies.has(k)) crossKeyFamilies.set(k, new Set());
      crossKeyFamilies.get(k)!.add(fam);
    }
  }
  crossListedExtraRows = 0;
  for (const fams of Array.from(crossKeyFamilies.values())) {
    if (fams.size > 1) crossListedExtraRows += (fams.size - 1);
  }

  // Sort each family by sortOrder asc, then subProduct, then baseColour.
  for (const fam of Object.keys(newRowsByFamily)) {
    newRowsByFamily[fam].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder
        || a.subProduct.localeCompare(b.subProduct)
        || (a.baseColour ?? "").localeCompare(b.baseColour ?? ""),
    );
  }

  // Sort family keys themselves by their lowest sortOrder for predictable
  // grid order in the JSON.
  const sortedFamilies: Record<string, PreviewRow[]> = {};
  Object.keys(newRowsByFamily)
    .sort((a, b) => {
      const aMin = Math.min(...newRowsByFamily[a].map((r) => r.sortOrder));
      const bMin = Math.min(...newRowsByFamily[b].map((r) => r.sortOrder));
      return aMin - bMin || a.localeCompare(b);
    })
    .forEach((f) => { sortedFamilies[f] = newRowsByFamily[f]; });

  const out: Output = {
    capturedAt: new Date().toISOString(),
    source:     IN_PATH,
    summary: {
      totalLegacyTriples:    csvRows.length,
      totalLegacySkuCount,
      totalNewRows,
      crossListedExtraRows,
      suppressedPlainRows,
      skippedTriples:        skippedTriples.length,
      warnings:              warnings.length,
      familiesProduced:      Object.keys(sortedFamilies).length,
    },
    newRowsByFamily: sortedFamilies,
    skippedTriples,
    warnings,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf8");

  /* eslint-disable no-console */
  console.log("─── Phase 1 taxonomy preview (from CSV) ───");
  console.log(`Total legacy triples processed : ${out.summary.totalLegacyTriples}`);
  console.log(`Total legacy SKUs              : ${out.summary.totalLegacySkuCount}`);
  console.log(`Total new rows that would seed : ${out.summary.totalNewRows}`);
  console.log(`Cross-listed extra rows        : ${out.summary.crossListedExtraRows}`);
  console.log(`Suppressed phantom PLAIN rows  : ${out.summary.suppressedPlainRows}`);
  console.log(`Skipped (intentional)          : ${out.summary.skippedTriples}`);
  console.log(`Warnings (no mapping rule)     : ${out.summary.warnings}`);
  console.log(`Families produced              : ${out.summary.familiesProduced} (expected 33)`);
  console.log(`Output                         : ${OUT_PATH}`);
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
