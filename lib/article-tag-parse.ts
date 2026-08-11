// lib/article-tag-parse.ts
//
// The PURE half of the article-tag rule: parsing and rolling up tag STRINGS.
// No prisma, no I/O, no React — importable from a server route or a client
// component alike.
//
// ⚠ WHY THIS FILE EXISTS. These three exports lived in lib/article-tag.ts and
// still read identically; they were moved here verbatim (2026-08-11), not
// rewritten. That module opens with `import { prisma } from "./prisma"`, and
// lib/prisma.ts instantiates `new PrismaClient()` at module scope — a side
// effect, so it does not tree-shake. Importing `parseArticleTag` from there
// into a "use client" component therefore pulls PrismaClient into the browser
// bundle. The Floor picker card needs exactly this parsing on the client, so
// the pure functions moved down here and lib/article-tag.ts re-exports them.
//
// lib/article-tag.ts remains THE owner of the rule itself (which pack is a
// drum, what a carton splits into). Nothing about that moved. Do not add a DB
// read, a catalog lookup or a React import to this file — the whole point is
// that it has no dependencies at all.

/** Display order for a rolled-up tag. */
export const TYPE_ORDER = ["Drum", "Bag", "Carton", "Tin", "Pcs"] as const;

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
 *
 * ⚠ SPLITS ON COMMAS AS WELL AS WHITESPACE (fixed 2026-08-11). It originally
 * split on `/\s+/` alone, which is right for the LINE-level tags it was written
 * for — cartonInfo builds those with `parts.join(" ")`, so they never contain a
 * comma. ORDER-level tags are the output of aggregateArticleTags below, which
 * joins with ", ", so "1 Drum, 2 Carton" tokenised to ["1","Drum,","2","Carton"]
 * and every group but the LAST carried its comma into the type: "Drum," matches
 * no known type, so it was dropped by aggregateArticleTags and rendered raw and
 * unabbreviated ("1 Drum,") by lib/floor/format.ts's formatArticleBreakdown.
 *
 * The fix belongs here rather than in the caller: the parser was the thing that
 * could not read its own module's output. Stripping commas is a strict no-op for
 * line-level input (there are none) and makes aggregateArticleTags idempotent —
 * it can now re-aggregate a tag it produced, which is what any consumer summing
 * several ORDER tags is doing.
 */
export function parseArticleTag(tag: string): Array<{ count: number; type: string }> {
  const out: Array<{ count: number; type: string }> = [];
  const tokens = tag.trim().split(/[\s,]+/).filter(Boolean);
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
