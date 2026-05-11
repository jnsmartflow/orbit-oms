// Phase 1 dry-run preview generator.
//
// Reads mo_sku_lookup, runs every distinct (category, product, baseColour,
// description) tuple through the taxonomy mapping function, aggregates
// results by family, and writes a JSON preview to:
//   docs/prompts/drafts/taxonomy-preview.json
//
// Read-only — NO writes to mo_sku_lookup, mo_order_form_index, or any
// other table. The preview is the deliverable. Phase 1 Prompt 2 will
// reseed mo_order_form_index from this preview after the unique-constraint
// SQL migration is applied in Supabase.
//
// Run with:
//   npx tsx scripts/preview-new-taxonomy.ts

import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  mapLegacyToNew,
  getSkipReason,
  type LegacyKey,
  type NewRow,
} from "../lib/mail-orders/taxonomy-mapping";

const prisma = new PrismaClient();

const OUT_PATH = path.join("docs", "prompts", "drafts", "taxonomy-preview.json");

type SkippedEntry = {
  category:   string;
  product:    string;
  baseColour: string;
  reason:     string;
};

type WarningEntry = {
  category:   string;
  product:    string;
  baseColour: string;
  reason:     "no mapping rule";
  exampleDescription?: string;
};

type Output = {
  capturedAt: string;
  summary: {
    totalLegacyTriples:  number;
    totalNewRows:        number;
    skippedTriples:      number;
    crossListedRows:     number;
    warnings:            number;
  };
  newRowsByFamily:       Record<string, NewRow[]>;
  skippedTriples:        SkippedEntry[];
  warnings:              WarningEntry[];
};

function tripleKey(t: { category: string; product: string; baseColour: string }): string {
  return `${t.category}|||${t.product}|||${t.baseColour}`;
}

async function main(): Promise<void> {
  // Pull every row of mo_sku_lookup and dedupe to distinct
  // (category, product, baseColour) triples. We retain one description per
  // triple so the mapping function has it available for description-based
  // splits (TEXTURE / PROTECT / SATIN per planning doc §6.7 / §3 / §2).
  const rows = await prisma.mo_sku_lookup.findMany({
    select: { category: true, product: true, baseColour: true, description: true },
  });

  const triples = new Map<string, LegacyKey & { description: string }>();
  for (const r of rows) {
    const k = tripleKey({
      category:   r.category,
      product:    r.product,
      baseColour: r.baseColour ?? "",
    });
    if (!triples.has(k)) {
      triples.set(k, {
        category:    r.category,
        product:     r.product,
        baseColour:  r.baseColour ?? "",
        description: r.description ?? "",
      });
    }
  }

  const newRowsByFamily: Record<string, NewRow[]> = {};
  const skippedTriples: SkippedEntry[]            = [];
  const warnings:       WarningEntry[]            = [];
  let totalNewRows     = 0;
  let crossListedRows  = 0;

  for (const t of Array.from(triples.values())) {
    const result = mapLegacyToNew(t);
    if (result === null) {
      const skipReason = getSkipReason(t);
      if (skipReason) {
        skippedTriples.push({
          category:   t.category,
          product:    t.product,
          baseColour: t.baseColour,
          reason:     skipReason,
        });
      } else {
        warnings.push({
          category:   t.category,
          product:    t.product,
          baseColour: t.baseColour,
          reason:     "no mapping rule",
          exampleDescription: t.description,
        });
      }
      continue;
    }

    if (result.length > 1) crossListedRows += (result.length - 1);
    totalNewRows += result.length;

    for (const newRow of result) {
      if (!newRowsByFamily[newRow.family]) newRowsByFamily[newRow.family] = [];
      newRowsByFamily[newRow.family].push(newRow);
    }
  }

  // Sort each family's rows by sortOrder asc, then displayName for stability.
  for (const fam of Object.keys(newRowsByFamily)) {
    newRowsByFamily[fam].sort(
      (a, b) => a.sortOrder - b.sortOrder
              || a.subProduct.localeCompare(b.subProduct)
              || (a.baseColour ?? "").localeCompare(b.baseColour ?? ""),
    );
  }

  // Sort families themselves by their lowest sortOrder (matches grid display).
  const sortedFamilies: Record<string, NewRow[]> = {};
  Object.keys(newRowsByFamily)
    .sort((a, b) => {
      const aMin = Math.min(...newRowsByFamily[a].map((r) => r.sortOrder));
      const bMin = Math.min(...newRowsByFamily[b].map((r) => r.sortOrder));
      return aMin - bMin || a.localeCompare(b);
    })
    .forEach((f) => { sortedFamilies[f] = newRowsByFamily[f]; });

  const out: Output = {
    capturedAt: new Date().toISOString(),
    summary: {
      totalLegacyTriples:  triples.size,
      totalNewRows,
      skippedTriples:      skippedTriples.length,
      crossListedRows,
      warnings:            warnings.length,
    },
    newRowsByFamily: sortedFamilies,
    skippedTriples,
    warnings,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log("─── Phase 1 taxonomy preview ───");
  // eslint-disable-next-line no-console
  console.log(`Total legacy triples processed : ${out.summary.totalLegacyTriples}`);
  // eslint-disable-next-line no-console
  console.log(`Total new rows that would seed : ${out.summary.totalNewRows}`);
  // eslint-disable-next-line no-console
  console.log(`Cross-listed extra rows        : ${out.summary.crossListedRows}`);
  // eslint-disable-next-line no-console
  console.log(`Skipped (intentional)          : ${out.summary.skippedTriples}`);
  // eslint-disable-next-line no-console
  console.log(`Warnings (no mapping rule)     : ${out.summary.warnings}`);
  // eslint-disable-next-line no-console
  console.log(`Families produced              : ${Object.keys(sortedFamilies).length}`);
  // eslint-disable-next-line no-console
  console.log(`Output                         : ${OUT_PATH}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
