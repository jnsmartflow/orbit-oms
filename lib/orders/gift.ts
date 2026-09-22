// lib/orders/gift.ts
//
// THE gift rule, one owner (owner decision, 2026-09-22).
//
// A bill is a GIFT when `orders.materialType` is "GIFTS" — SAP's own value,
// carried by the Auto-Import header (`MaterialType`). Manual SAP and paste write
// null (lib/sap-parser/build-obd.ts), and "FG" / null are ordinary bills.
//
// 🔴 A GIFT IS LEFT OUT OF EVERY LITRE AND KG TOTAL, AND OF EVERY LOAD BAR. Its
// quantities are SAP placeholders (1 to 2,000 "L" on a box of stickers or a
// ceiling fan) and they inflated trip and route totals by up to a tonne.
//
// 🔴 A GIFT STILL COUNTS AS A BILL AND AS A STOP. Nothing here touches a count —
// the truck still drives to the shop and the bill still has to be handed over.
//
// ⚠ KEY ON materialType ONLY. Never on the size of the number: gift bills range
// from 1 to 2,000 and plenty of ordinary bills are 1,000 L.
//
// ⚠ PROMO IS NOT THIS. `trip_report.promoType` is an NTS tag on a different
// table and is not read here.
//
// PURE — no Prisma, no I/O — so a route, a query module and a client component
// can all import it.

/** True when the bill's SAP material type is GIFTS (trimmed, any case). */
export function isGiftBill(materialType: string | null | undefined): boolean {
  return (materialType ?? "").trim().toUpperCase() === "GIFTS";
}

/** The litres a bill adds to a load total: 0 for a gift, else its litres (missing = 0). */
export function loadLitres(litres: number | null | undefined, isGift: boolean): number {
  if (isGift) return 0;
  return litres ?? 0;
}

/**
 * The kilos a bill adds to a load total.
 *
 * A gift returns 0 — a KNOWN zero. Otherwise the stored weight comes back
 * untouched (null stays null), because the callers do not agree on what
 * "unknown" means and this change must not move that line: the board treats
 * 0 as a missing weight (status-pill.tsx `sumWeightKg`), the trip summary
 * counts only null. Each caller keeps its own rule and must skip it for a gift
 * — `isGift` is passed in beside the weight for exactly that.
 */
export function loadKg(kg: number | null | undefined, isGift: boolean): number | null {
  if (isGift) return 0;
  return kg ?? null;
}
