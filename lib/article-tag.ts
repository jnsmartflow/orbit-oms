// lib/article-tag.ts
//
// The single article/articleTag rule for OBD import. Before this file, the
// rule lived ONLY on the depot PC — `Get-ArticleInfo` in Auto-Import*.ps1,
// reading `Master\pack-sizes.txt` (a file that is not in this repo). The
// server just carried the PowerShell-computed `article_tag` field through,
// and the manual-SAP parser had no rule at all: `build-obd.ts` hardcoded
// `articleTag: null` on every line since 2026-05-14.
//
// Resolution order (first match wins):
//   1. sku_master_v2 by `material` — the primary source.
//      a. unit === "PC"           -> piece goods, "N Pcs"
//      b. piecesPerCarton != null -> carton math at the SKU's OWN pack count
//   2. packSize = volumeLine / unitQty, against the DRUM/BAG/CARTON fallback
//      lists below (the old pack-sizes.txt, extended).
//   3. No match -> null. Deliberate for packSize 0.4 / 2.5 / 3 / 5 and
//      anything unlisted: an untagged line is recoverable, a wrong pack
//      count sends a picker to the wrong shelf. Do not guess here.
//
// The catalog is consulted per-SKU, so it beats the flat pack-size list in
// one important way: pack-sizes.txt can only hold ONE carton count per pack
// size (1L -> 6), while sku_master_v2 knows that four 1L SKUs actually pack
// 9 to a carton. Those four have been mis-tagged in production since the
// rule was written — see docs/CLAUDE_IMPORT.md §8.2.
//
// No prisma.$transaction (CLAUDE_CORE.md §3). Reads are either one batched
// findMany via loadPackCatalog() or a single findUnique per call.

import { prisma } from "./prisma";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ArticleTagInput {
  material:   string;
  unitQty:    number | null;
  volumeLine: number | null;
}

export interface ArticleInfo {
  /** Numeric article count — drums/bags/pieces = qty, cartons = cartons + loose tins. */
  article:    number | null;
  /** Display tag, e.g. "5 Drum" / "1 Carton 3 Tin" / "12 Pcs". Null when unresolvable. */
  articleTag: string | null;
}

/** The only sku_master_v2 columns this rule reads. */
export interface PackCatalogRow {
  material:        string;
  unit:            string | null;
  piecesPerCarton: number | null;
}

export type PackCatalog = Map<string, PackCatalogRow>;

// ─── Fallback pack-size lists (the old Master\pack-sizes.txt, extended) ────
//
// Keys are packSize * 10000 rounded to an integer. Decimal equality on
// doubles is not safe here — 0.05, 0.1, 0.2, 0.3 and 0.925 are none of them
// exactly representable, so `packSize === 0.05` is a coin flip. Integer keys
// make the comparison exact.

const KEY_SCALE = 10000;

/** packSize -> integer key. */
function packKey(packSize: number): number {
  return Math.round(packSize * KEY_SCALE);
}

/**
 * Size overrides applied BEFORE the fallback lookup only. These are SAP
 * volume quirks, not real pack sizes: a 0.925 L tin is sold as a 1 L, a
 * 3.7 L as a 4 L. Never applied to the catalog lookup, which always uses
 * the SKU's own data.
 */
const SIZE_OVERRIDES = new Map<number, number>([
  [packKey(0.925), packKey(1)],
  [packKey(3.7),   packKey(4)],
  [packKey(9.25),  packKey(10)],
  [packKey(18.5),  packKey(20)],
]);

/** Pack sizes (litres) sold as drums. */
const DRUM_SIZES = new Set<number>([packKey(10), packKey(20), packKey(15)]);

/** Pack sizes (litres) sold as bags. */
const BAG_SIZES = new Set<number>([packKey(25), packKey(30), packKey(40)]);

/** Pack size (litres) -> pieces per carton. Fallback only; the catalog's
 *  per-SKU piecesPerCarton wins whenever it is present. */
const CARTON_SIZES = new Map<number, number>([
  [packKey(1),    6],
  [packKey(4),    4],
  [packKey(0.5),  12],
  [packKey(0.05), 20],
  [packKey(0.1),  20],
  [packKey(0.2),  12],
  [packKey(0.3),  12],
]);

// ─── Catalog loading ──────────────────────────────────────────────────────

/**
 * Batch-load the pack columns for a set of materials. One query for a whole
 * file rather than one per line — a 1,000-line SAP upload would otherwise
 * fire 1,000 sequential round-trips through the Supabase pooler.
 *
 * No isPrimary / isActive filter: `material` carries @unique, so there is
 * exactly one row per code and nothing to disambiguate. Matches the existing
 * coverage gate in app/api/import/obd/route.ts.
 */
export async function loadPackCatalog(materials: string[]): Promise<PackCatalog> {
  const unique = Array.from(new Set(materials.map((m) => m.trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const rows = await prisma.sku_master_v2.findMany({
    where:  { material: { in: unique } },
    select: { material: true, unit: true, piecesPerCarton: true },
  });
  return new Map(rows.map((r) => [r.material, r]));
}

// ─── The rule ─────────────────────────────────────────────────────────────

/**
 * Carton split. Mirrors Get-ArticleInfo's carton branch, INCLUDING its
 * omission of zero groups: 2 tins at 4-per-carton is "2 Tin", not
 * "0 Carton 2 Tin". 14,207 production rows are written in that shape and
 * lib/floor/format.ts parses it — a leading "0 Carton" would be a new format.
 */
function cartonInfo(unitQty: number, piecesPerCarton: number): ArticleInfo {
  if (piecesPerCarton <= 0) return { article: null, articleTag: null };
  const fullCartons = Math.floor(unitQty / piecesPerCarton);
  const looseTins   = unitQty % piecesPerCarton;

  const parts: string[] = [];
  if (fullCartons > 0) parts.push(`${fullCartons} Carton`);
  if (looseTins   > 0) parts.push(`${looseTins} Tin`);
  if (parts.length === 0) return { article: null, articleTag: null };

  return { article: fullCartons + looseTins, articleTag: parts.join(" ") };
}

/**
 * Resolve the article count + display tag for one line.
 *
 * `catalog` is optional: pass a preloaded map (loadPackCatalog) to avoid a
 * per-line query. Omit it and the function does its own single-row lookup.
 *
 * Returns { article: null, articleTag: null } when the rule cannot decide.
 * That is a deliberate outcome, not a failure — see the header note.
 */
export async function computeArticleInfo(
  input:   ArticleTagInput,
  catalog?: PackCatalog,
): Promise<ArticleInfo> {
  const NONE: ArticleInfo = { article: null, articleTag: null };

  const material = (input.material ?? "").trim();
  const unitQty  = input.unitQty;

  // No positive quantity -> nothing countable, whatever the SKU is.
  if (unitQty === null || !Number.isFinite(unitQty) || unitQty <= 0) return NONE;

  // ── 1. Catalog lookup (primary source) ──────────────────────────────────
  let row: PackCatalogRow | null = null;
  if (material) {
    if (catalog) {
      row = catalog.get(material) ?? null;
    } else {
      row = await prisma.sku_master_v2.findUnique({
        where:  { material },
        select: { material: true, unit: true, piecesPerCarton: true },
      });
    }
  }

  // 1a. Piece goods. Checked FIRST — these carry volumeLine 0, so every
  //     volume-based branch below would reject them.
  if (row && (row.unit ?? "").trim().toUpperCase() === "PC") {
    return { article: unitQty, articleTag: `${unitQty} Pcs` };
  }

  // 1b. The SKU's own carton count. Beats the fallback list, which can only
  //     hold one count per pack size.
  if (row && row.piecesPerCarton !== null) {
    return cartonInfo(unitQty, row.piecesPerCarton);
  }

  // ── 2. Fallback: pack size from volume ÷ qty ────────────────────────────
  const volumeLine = input.volumeLine;
  if (volumeLine === null || !Number.isFinite(volumeLine) || volumeLine <= 0) return NONE;

  const rawKey = packKey(volumeLine / unitQty);
  const key    = SIZE_OVERRIDES.get(rawKey) ?? rawKey;

  if (DRUM_SIZES.has(key)) return { article: unitQty, articleTag: `${unitQty} Drum` };
  if (BAG_SIZES.has(key))  return { article: unitQty, articleTag: `${unitQty} Bag`  };

  const perCarton = CARTON_SIZES.get(key);
  if (perCarton !== undefined) return cartonInfo(unitQty, perCarton);

  // ── 3. Unresolvable. Leave it null rather than guess. ───────────────────
  return NONE;
}

/**
 * Tag-only convenience wrapper. Same rule, same inputs; drops the numeric
 * article count for callers that only render the tag.
 */
export async function computeArticleTag(
  input:    ArticleTagInput,
  catalog?: PackCatalog,
): Promise<string | null> {
  const info = await computeArticleInfo(input, catalog);
  return info.articleTag;
}

// ─── Order-level aggregation ──────────────────────────────────────────────

/** Display order for the rolled-up order tag. */
const TYPE_ORDER = ["Drum", "Bag", "Carton", "Tin", "Pcs"] as const;

/**
 * Parse one line tag into its {count, type} groups.
 *
 * A tag can hold MORE THAN ONE group — "1 Carton 3 Tin" is two. The previous
 * inline parsers took parts[0] as the count and joined the whole remainder as
 * the type, yielding the type string "Carton 3 Tin", which then matched no
 * known type and was silently dropped. 801 of 14,207 tagged production rows
 * are multi-group, and orders whose only tagged lines were multi-group ended
 * up with a NULL order-level tag (e.g. OBD 9108735710, line "7 Carton 3 Tin",
 * order tag null). Carton math makes multi-group tags much more common, so
 * this parser walks number/word pairs instead.
 */
export function parseArticleTag(tag: string): Array<{ count: number; type: string }> {
  const out: Array<{ count: number; type: string }> = [];
  const tokens = tag.trim().split(/\s+/);
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const count = parseInt(tokens[i], 10);
    const type  = tokens[i + 1];
    if (!Number.isNaN(count) && type) out.push({ count, type });
  }
  return out;
}

/**
 * Roll a set of line tags into one order-level tag, e.g.
 * ["2 Drum", "1 Carton 3 Tin", "1 Carton"] -> "2 Drum, 2 Carton, 3 Tin".
 * Returns null when nothing summed.
 */
export function aggregateArticleTags(tags: Array<string | null | undefined>): string | null {
  const totals: Record<string, number> = {};
  for (const tag of tags) {
    if (!tag) continue;
    for (const { count, type } of parseArticleTag(tag)) {
      totals[type] = (totals[type] ?? 0) + count;
    }
  }
  return TYPE_ORDER
    .filter((t) => (totals[t] ?? 0) > 0)
    .map((t) => `${totals[t]} ${t}`)
    .join(", ") || null;
}
