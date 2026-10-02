// lib/tint/tint-lines.ts — a bill's TINT litres + articles (2026-10-02).
//
// ONE helper for the Tint Manager's Tint tab. A tint bill can mix tint lines
// with plain base lines; the tint room only mixes the tint ones, so the Tint
// tab's litres and articles count ONLY lines with `import_raw_line_items.isTinting`
// = true (SAP's per-line "Tinting" column, set at import —
// app/api/import/obd/route.ts parseBooleanCell(lr["Tinting"])).
//
// The orders route computes these per bill and adds them as NEW response fields
// (`tintVolume`, `tintArticleTag`); components/tint/manager/rows.ts reads them
// into every board row, so the summary cards, operator board, group headers,
// Vol / Art. columns and history all sum the same numbers. Floor, Billing, the
// challan and the detail panel's line list keep the full bill.
//
// PURE — no prisma, no clock.

import { aggregateArticleTags } from "@/lib/article-tag-parse";

export interface TintLineLike {
  isTinting:  boolean;
  volumeLine: number | null;
  articleTag: string | null;
}

export interface TintLinesSummary {
  /** Litres of the tint lines; null when the bill has no tint line on file
   *  (the caller then falls back to the whole bill). */
  tintVolume:     number | null;
  /** "2 Drum, 3 Tin" over the tint lines; null = unknown (untagged), never zero. */
  tintArticleTag: string | null;
}

export function tintLinesOf(lines: readonly TintLineLike[]): TintLinesSummary {
  const tint = lines.filter((l) => l.isTinting);
  if (tint.length === 0) return { tintVolume: null, tintArticleTag: null };
  const litres = tint.reduce((n, l) => n + (l.volumeLine ?? 0), 0);
  return {
    tintVolume:     Math.round(litres * 100) / 100,
    tintArticleTag: aggregateArticleTags(tint.map((l) => l.articleTag)),
  };
}
