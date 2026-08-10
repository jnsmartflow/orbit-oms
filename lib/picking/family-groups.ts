import type { PickingDetailLine } from "./types";

// ── Product family — ONE resolution, every picking surface ──────────────────
// The picking CARD has shown family chips since 2026-07-21, resolved inside
// lib/picking/queue.ts. The picker's detail screen groups its line list by the
// same family from 2026-08-10. Those are two screens reading the same catalog
// for the same concept, so the rule lives HERE and both import it.
//
// This is not hypothetical tidiness: this module has already been bitten by the
// exact drift. The two picking boards each kept a private copy of the detail-line
// interface until findings forced them together, and each still owns a private
// copy of the row JSX. A family rule computed in two places would go the same way
// — one of them would learn about displayCategory and the other would not, and a
// bill's card chips would disagree with its own line groups.
//
// ⚠ RESOLVED BY `material` — the SAP natural key — NEVER via the
// enrichedLineItem.skuId FK, which shares no id space with sku_master_v2 and
// would mispoint every line (CLAUDE_CORE.md §13). Callers hand over rows they
// already fetched by material; nothing here touches the database.

/** The `sku_master_v2` columns family resolution reads. */
export interface FamilyCatalogRow {
  material: string;
  category: string | null;
  displayCategory: string | null;
}

/**
 * The Prisma `select` for the two columns above.
 *
 * Exported so queue.ts's bulk catalog read and resolve-lines.ts's cannot drift
 * into selecting different columns and quietly resolving family differently —
 * a `displayCategory` that one query forgets to fetch reads as NULL, not as an
 * error, and silently falls back to `category`.
 */
export const FAMILY_CATALOG_SELECT = {
  category: true,
  displayCategory: true,
} as const;

/**
 * family = COALESCE(displayCategory, category) — THE single resolution point.
 *
 * Keeping it as a COALESCE is what makes the deferred friendly-name swap
 * data-only later: `displayCategory` is 100% NULL across all 1,718 active rows
 * today (verified 2026-08-10), so family === category for now, and populating
 * that column is the whole migration.
 *
 * Trim-guarded, returning null for a resolved-but-BLANK value. COALESCE only
 * falls back on NULL and `category` is NOT NULL, so this is belt-and-braces —
 * but a blank chip, or a group strip with no label, is worse than counting the
 * line as unlisted. A null here means "no family" everywhere downstream.
 */
export function resolveFamily(row: {
  category: string | null;
  displayCategory: string | null;
}): string | null {
  const resolved = (row.displayCategory ?? row.category ?? "").trim();
  return resolved === "" ? null : resolved;
}

/**
 * Build the code → family map from catalog rows fetched by `material`.
 *
 * A code MISSING from the returned map has no family — either it matched no
 * `sku_master_v2` row at all (the long-standing catalog gap, ~27% of distinct
 * codes across all history, CLAUDE_CORE.md §13) or it resolved blank. Callers
 * must treat both the same way: the card counts them into `unresolvedLineCount`,
 * the detail screen files them under "Other". Same rule, same source, so the
 * chip and the bucket agree by construction.
 */
export function buildFamilyByCode(
  rows: readonly FamilyCatalogRow[],
): Map<string, string> {
  const byCode = new Map<string, string>();
  for (const row of rows) {
    const family = resolveFamily(row);
    if (family !== null) byCode.set(row.material, family);
  }
  return byCode;
}

// ── Detail-screen grouping ─────────────────────────────────────────────────

/** The bucket for lines with no family. Always rendered LAST. */
export const OTHER_FAMILY_LABEL = "Other";

/** React key for the Other group. Not a family name — no real family collides
 *  with it because a real family is a trimmed non-empty catalog string. */
export const OTHER_FAMILY_KEY = "__other__";

export interface PickingFamilyGroup {
  /** Stable React key. The family name itself, or OTHER_FAMILY_KEY. */
  key: string;
  /** null on the Other bucket — the discriminator, never compare on `label`. */
  family: string | null;
  /** What the strip prints. */
  label: string;
  lines: PickingDetailLine[];
}

/**
 * Bucket detail rows into family groups for rendering.
 *
 * ⚠ RUNS ON THE MERGED ROWS, AFTER groupPickingDetailLines() — never on raw
 * lines. Order in, order out: groups appear in FIRST-APPEARANCE order and lines
 * keep their order within a group, so a bill's list is a re-bucketing of what
 * the picker already saw and never a re-sort. Nothing here sorts anything.
 *
 * A group of ONE still gets its own group — no "families with a single line get
 * folded" special case. A strip that appears for two lines and vanishes for one
 * would make the layout depend on the bill in a way the picker cannot predict.
 *
 * The Other bucket is appended LAST whatever order its lines arrived in, and is
 * omitted entirely when empty.
 *
 * PURE — pass it the FILTERED list and any group left with nothing simply does
 * not appear, which is exactly the pack-chip behaviour (a chip narrows the view,
 * it does not restructure it).
 */
export function groupLinesByFamily(
  lines: readonly PickingDetailLine[],
): PickingFamilyGroup[] {
  // Map preserves insertion order — that IS the first-appearance rule.
  const byFamily = new Map<string, PickingFamilyGroup>();
  const other: PickingDetailLine[] = [];

  for (const line of lines) {
    if (line.family === null) {
      other.push(line);
      continue;
    }
    const existing = byFamily.get(line.family);
    if (existing) {
      existing.lines.push(line);
    } else {
      byFamily.set(line.family, {
        key: line.family,
        family: line.family,
        label: line.family,
        lines: [line],
      });
    }
  }

  const groups = Array.from(byFamily.values());
  if (other.length > 0) {
    groups.push({
      key: OTHER_FAMILY_KEY,
      family: null,
      label: OTHER_FAMILY_LABEL,
      lines: other,
    });
  }
  return groups;
}
