// lib/picking/article-count.ts
//
// Article no. (2026-10-06, Schema v27.58) — the number the floor supervisor has
// written on the drum, entered on Approve and editable on a checked bill.
// Stored in pick_assignments.articleCount. NOT the import's articleTag /
// totalArticle (what SAP says should go out) — never derive one from the other.
//
// ONE rule, used by both routes (approve, article-count) and the popup's Save
// gate, so the three can never disagree. The live DB backs the same range with
// CHECK chk_pick_assignments_article_count ("articleCount" IS NULL OR 1–999).
// Decision record: docs/prompts/drafts/web-update-2026-10-06-approve-article-no.md.

export const ARTICLE_COUNT_MIN = 1;
export const ARTICLE_COUNT_MAX = 999;

export const ARTICLE_COUNT_ERROR = "Article no. is required (1–999).";

/** A whole number 1–999, or null. Accepts a JSON number only — never a string. */
export function parseArticleCount(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v < ARTICLE_COUNT_MIN || v > ARTICLE_COUNT_MAX) return null;
  return v;
}

/** The popup's text box → a valid count, or null. Digits only, no leading sign. */
export function parseArticleCountInput(s: string): number | null {
  const t = s.trim();
  if (!/^[0-9]{1,3}$/.test(t)) return null;
  return parseArticleCount(Number(t));
}
