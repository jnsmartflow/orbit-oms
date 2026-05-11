// Two-letter monogram fallback for products / families / sections that
// don't have a category image. Used by the speed-dial mini-tile chips
// and the panel/recall row monogram chips.

export function monogramFor(text: string): string {
  const trimmed = text.replace(/[^A-Za-z0-9]/g, "");
  if (trimmed.length === 0) return "?";
  return trimmed.slice(0, 2).toUpperCase();
}
