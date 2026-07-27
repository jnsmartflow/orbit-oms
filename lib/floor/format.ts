// Floor Control — display formatting helpers. Pure string work: no React, no
// browser API, no DB. Deliberately NOT a "use client" file so it can be imported
// from either a server or a client component.
//
// Moved here from components/support/shared/table-cells.tsx (verbatim) as step 1
// of the Support retirement — Floor is the only remaining consumer.

// ── Article pack-word abbreviation ───────────────────────────────────────────
// articleTag is a comma-separated "{integer} {word}" list written at import
// (e.g. "16 Drum, 14 Carton"). Abbreviates known words for display only —
// never touches the stored value. Any group that fails to parse as
// "{integer} {word}" bails the whole string back to the raw original,
// verbatim, rather than partially formatting it.
export const ARTICLE_WORD_ABBR: Record<string, string> = { Drum: "D", Carton: "C", Tin: "T", Bag: "B" };

export function formatArticleTag(raw: string): string {
  const groups = raw.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
  if (groups.length === 0) return raw;
  const parts: string[] = [];
  for (const g of groups) {
    const m = g.match(/^(\d+)\s+(\S.*)$/);
    if (!m) return raw;
    const [, num, word] = m;
    const short = ARTICLE_WORD_ABBR[word];
    parts.push(short ? `${num} ${short}` : `${num} ${word}`);
  }
  return parts.join(" · ");
}
