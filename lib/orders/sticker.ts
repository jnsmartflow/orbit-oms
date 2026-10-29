// lib/orders/sticker.ts
//
// THE sticker rule, one owner (owner decision, 2026-10-29).
//
// SAP sends STICKERS 500PC (6028563) with a placeholder volume and weight equal
// to the quantity: OBD 9110462350 arrived as qty 2000 → 2000 L, 2000 kg. Those
// figures were counted in every total.
//
// 🔴 THE LINE DATA IS KEPT RAW ON PURPOSE. unitQty, volumeLine, netWeight and
// totalWeight stay exactly as SAP sent them, and a line row still DISPLAYS its
// own values. The exclusion happens only when SUMMING: a sticker line adds no
// litres, no kilos and no article count to any total.
//
// 🔴 THE TAG HAS NO COUNT ON PURPOSE. A sticker line's tag is the bare word
// "Sticker", and an order-level tag carries it once ("5 Carton, Sticker"; a
// sticker-only bill reads "Sticker"). lib/article-tag-parse.ts knows the bare
// word; nothing else should parse it by hand.
//
// ⚠ PER LINE, NOT PER BILL. This is NOT the gift rule (lib/orders/gift.ts keys
// a whole bill on materialType = GIFTS). A bill can be both; the two rules do
// not read each other.
//
// To extend: add the SAP material code to STICKER_SKUS. Never hand-write the
// code check anywhere else — import isStickerSku / isStickerLine / loadLines.
//
// PURE — no Prisma, no I/O — so a route, a query module and a client component
// can all import it.

/** SAP material codes treated as stickers. Matched on the trimmed skuCodeRaw. */
export const STICKER_SKUS: ReadonlySet<string> = new Set(["6028563"]);

/** The line tag, and the one word an order-level tag carries for it. */
export const STICKER_TAG = "Sticker";

/** True when this SAP material code is a sticker. */
export function isStickerSku(sku: string | null | undefined): boolean {
  return STICKER_SKUS.has((sku ?? "").trim());
}

/** True when this line is a sticker line. */
export function isStickerLine(line: { skuCodeRaw: string | null | undefined }): boolean {
  return isStickerSku(line.skuCodeRaw);
}

/** The lines that count toward litre / kg / article totals — sticker lines removed. */
export function loadLines<T extends { skuCodeRaw: string | null | undefined }>(lines: readonly T[]): T[] {
  return lines.filter((l) => !isStickerLine(l));
}

/**
 * A SAP HEADER kg with the sticker lines' own kg taken out.
 *
 * Only what the lines actually carry is subtracted: a sticker line with no
 * totalWeight (Auto-Import lines carry none) subtracts nothing, so its kg stays
 * inside the header figure — we do not invent one. null stays null; the result
 * never goes below 0.
 */
export function headerKgLessStickers(
  headerKg: number | null,
  lines: ReadonlyArray<{ skuCodeRaw: string | null | undefined; totalWeight?: number | null }>,
): number | null {
  if (headerKg === null) return null;
  let sticker = 0;
  for (const l of lines) {
    if (isStickerLine(l) && (l.totalWeight ?? 0) > 0) sticker += l.totalWeight!;
  }
  return sticker > 0 ? Math.max(0, headerKg - sticker) : headerKg;
}

/** A SAP HEADER litres with the sticker lines' own volume taken out (same rules as the kg). */
export function headerLitresLessStickers(
  headerLitres: number | null,
  lines: ReadonlyArray<{ skuCodeRaw: string | null | undefined; volumeLine?: number | null }>,
): number | null {
  if (headerLitres === null) return null;
  let sticker = 0;
  for (const l of lines) {
    if (isStickerLine(l) && (l.volumeLine ?? 0) > 0) sticker += l.volumeLine!;
  }
  return sticker > 0 ? Math.max(0, headerLitres - sticker) : headerLitres;
}
