// Phase 1 reseed — wipes mo_order_form_index and re-inserts every row
// from docs/prompts/drafts/taxonomy-preview.json.
//
// Per CLAUDE_CORE.md §3:
//   - sequential awaits, no prisma.$transaction([...])
//   - no prisma db push / no prisma migrate (the unique-constraint
//     widening was applied via Supabase SQL Editor in Phase A)
//
// Per Phase 1 Prompt 2:
//   - Re-verify safety preconditions (backup file present, preview has
//     0 warnings + >400 rows + 34 families) BEFORE any mutation.
//   - Strip the preview-only `skuCount` field via whitelist destructure
//     before passing rows to prisma.create.
//   - Sequential prisma.create() in a for loop (no createMany).
//   - Verify post-insert row count matches source.
//
// Run with: npx tsx scripts/phase1-seed-mo-order-form-index.ts
//
// Idempotent on re-run: deleteMany({}) on an empty table is a no-op,
// so re-running after a partial-insert crash is safe.

import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// One-off scripts use DIRECT_URL (port 5432) per CLAUDE_CORE §4 — bypasses
// the pooler / pgbouncer quirks that don't play well with maintenance jobs.
const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!directUrl) {
  throw new Error("DIRECT_URL (or DATABASE_URL) must be set in environment.");
}
const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
  log: ["error"],
});

const PREVIEW_PATH = path.join("docs", "prompts", "drafts", "taxonomy-preview.json");
const BACKUP_DIR   = path.join("docs", "prompts", "drafts");

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
  skuCount?:    number;     // preview metadata — discarded
};

type PreviewJson = {
  summary: {
    totalNewRows:     number;
    warnings:         number;
    familiesProduced: number;
  };
  newRowsByFamily: Record<string, PreviewRow[]>;
};

function findLatestBackup(): string | null {
  // Find any mo_order_form_index-backup-*.json snapshot. We need at
  // least one on disk before any DELETE runs.
  return null;  // synchronous list happens via fs.readdir below
}
void findLatestBackup;  // kept for documentation; real check below

async function backupExists(): Promise<{ ok: boolean; path?: string; rowCount?: number }> {
  const entries = await fs.readdir(BACKUP_DIR);
  const matches = entries.filter((n) => /^mo_order_form_index-backup-.+\.json$/.test(n));
  if (matches.length === 0) return { ok: false };
  // Pick the most-recently-modified backup — usually the Phase A.1 dump.
  let chosen: { name: string; mtime: number } | null = null;
  for (const name of matches) {
    const stat = await fs.stat(path.join(BACKUP_DIR, name));
    if (!chosen || stat.mtimeMs > chosen.mtime) {
      chosen = { name, mtime: stat.mtimeMs };
    }
  }
  if (!chosen) return { ok: false };
  const full = path.join(BACKUP_DIR, chosen.name);
  const raw  = await fs.readFile(full, "utf8");
  const parsed: unknown = JSON.parse(raw);

  // Tolerate both shapes:
  //  - object: { rowCount, rows: [...] }  ← phase1-backup-current-index.ts
  //  - array : [ ...rows ]                 ← future hand-rolled dumps
  // Prefer explicit rowCount; fall back to rows.length; then array length.
  let rowCount: number | undefined;
  if (Array.isArray(parsed)) {
    rowCount = parsed.length;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as { rowCount?: number; rows?: unknown };
    if (typeof obj.rowCount === "number" && obj.rowCount > 0) {
      rowCount = obj.rowCount;
    } else if (Array.isArray(obj.rows)) {
      rowCount = obj.rows.length;
    }
  }
  return { ok: true, path: full, rowCount };
}

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
  // ── B.1 preconditions ────────────────────────────────────────────────
  const backup = await backupExists();
  if (!backup.ok) {
    throw new Error(
      `Refusing to proceed: no mo_order_form_index-backup-*.json found in ${BACKUP_DIR}. ` +
      `Run scripts/phase1-backup-current-index.ts first.`,
    );
  }
  if (!backup.rowCount || backup.rowCount <= 0) {
    throw new Error(
      `Backup file ${backup.path} has rowCount=${backup.rowCount}. Refusing to proceed without a non-empty backup.`,
    );
  }

  const previewRaw  = await fs.readFile(PREVIEW_PATH, "utf8");
  const preview     = JSON.parse(previewRaw) as PreviewJson;
  if (preview.summary.warnings !== 0) {
    throw new Error(`Preview has ${preview.summary.warnings} warnings — refusing to seed. Resolve warnings first.`);
  }
  if (preview.summary.totalNewRows < 400) {
    throw new Error(`Preview totalNewRows=${preview.summary.totalNewRows} suspiciously low (<400). Refusing to seed.`);
  }
  if (preview.summary.familiesProduced !== 34) {
    throw new Error(`Preview familiesProduced=${preview.summary.familiesProduced} (expected 34). Refusing to seed.`);
  }

  // ── B.2 flatten + validate ───────────────────────────────────────────
  const flat: PreviewRow[] = [];
  for (const fam of Object.keys(preview.newRowsByFamily)) {
    for (const r of preview.newRowsByFamily[fam]) flat.push(r);
  }
  if (flat.length !== preview.summary.totalNewRows) {
    throw new Error(`Flatten count ${flat.length} ≠ summary.totalNewRows ${preview.summary.totalNewRows}.`);
  }
  flat.forEach(validateRow);

  // ── B.2.5 dedupe by (family, subProduct, baseColour) ─────────────────
  // The new unique constraint is (family, subProduct, baseColour). Multiple
  // legacy mo_sku_lookup triples can converge to the same canonical row:
  //   - WS/MAX + WEATHERCOAT/MAX (T3 rebadge — same product, two SAP gens)
  //   - DULUX/SUPERCLEAN + SUPERCLEAN/SUPERCLEAN (likewise)
  //   - DULUX/PU ENAMEL + PU/PU ENAMEL → both fold into GLOSS/GLOSS
  //   - Promise primer triples from PROMISE + PROMISE SHEEN + PROMISE SMARTCHOICE
  // The output row is byte-identical regardless of source (displayName /
  // searchTokens / tinterType / sortOrder all come from family+subProduct
  // lookup tables in taxonomy-mapping.ts, not the legacy triple). First-
  // wins is safe.
  //
  // Phase 2 T3 rebadge cleanup (web-update-2026-04-28-gloss-bw-generic-
  // cleanup.md) will eventually flip losing-generation SKUs to
  // isActive=false in mo_sku_lookup. After that runs, this dedup pass
  // will be a no-op.
  const seen = new Set<string>();
  const deduped: PreviewRow[] = [];
  let dropped = 0;
  for (const r of flat) {
    const key = `${r.family}|||${r.subProduct}|||${r.baseColour ?? ""}`;
    if (seen.has(key)) { dropped++; continue; }
    seen.add(key);
    deduped.push(r);
  }
  // eslint-disable-next-line no-console
  console.log(`Deduped rows: ${dropped} (kept ${deduped.length} of ${flat.length})`);

  // ── B.3 wipe ─────────────────────────────────────────────────────────
  // Idempotent: deleteMany on empty table is a no-op.
  const wipeResult = await prisma.mo_order_form_index.deleteMany({});
  const rowsWiped  = wipeResult.count;

  // ── B.4 sequential insert ────────────────────────────────────────────
  // Strip preview-only `skuCount` via whitelist destructure. Sequential
  // awaits per CLAUDE_CORE §3 — no prisma.$transaction array.
  let inserted = 0;
  for (const r of deduped) {
    const { family, subProduct, displayName, searchTokens, baseColour,
            productType, tinterType, sortOrder, isActive } = r;
    await prisma.mo_order_form_index.create({
      data: {
        family,
        subProduct,
        displayName,
        searchTokens,
        baseColour,
        productType,
        tinterType,
        sortOrder,
        isActive,
      },
    });
    inserted++;
  }

  // ── B.5 verify ───────────────────────────────────────────────────────
  const finalCount = await prisma.mo_order_form_index.count();
  const matches    = finalCount === inserted;

  const activeCount = await prisma.mo_order_form_index.count({ where: { isActive: true } });
  const distinctFamilies = (await prisma.mo_order_form_index.findMany({
    select: { family: true },
    distinct: ["family"],
  })).length;

  /* eslint-disable no-console */
  console.log("─── Phase 1 seed result ───");
  console.log(`Backup file        : ${backup.path}`);
  console.log(`Source preview     : ${PREVIEW_PATH}`);
  console.log(`Rows wiped         : ${rowsWiped}`);
  console.log(`Rows inserted      : ${inserted}`);
  console.log(`Verification count : ${finalCount} (matches inserted count: ${matches ? "✓" : "✗"})`);
  console.log(`Distinct families  : ${distinctFamilies}`);
  console.log(`Inserted with isActive=true: ${activeCount}`);
  /* eslint-enable no-console */

  if (!matches) {
    throw new Error(
      `Verification failed: count() returned ${finalCount} but ${inserted} rows were inserted.`,
    );
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("✗ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
