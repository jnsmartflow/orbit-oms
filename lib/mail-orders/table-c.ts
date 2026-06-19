// ─────────────────────────────────────────────────────────
// Table C — exact (emitted-name + pack) → SAP material dictionary
// ─────────────────────────────────────────────────────────
// PURE DATA MODULE (no React, no Prisma, no env). The caller fetches the two
// v2 catalog row sets — exactly the way GET /api/order/data does (menu =
// mo_order_form_index_v2 isActive, stock = mo_sku_lookup_v2 isPrimary=true) —
// and passes them in. Kept pure so:
//   • it is trivially testable / re-runnable from a script, and
//   • Prompt B can later import buildTableC / tableCKey / cleanPackCode into
//     lib/mail-orders/enrich.ts as a fast-path, feeding the skus it already
//     loads, with ZERO duplication of the pack-normalization logic.
//
// This module adds NO runtime behaviour to any live order path. It is built
// and dumped offline (scripts/table-c-dump.ts) for review.
//
// Build rules (from the discovery pass):
//   1. NAME comes from the MENU, via the real emailLineLabel helper (imported,
//      never re-concatenated), then UPPERCASED to match enrich.ts's text.
//   2. JOIN menu -> stock exactly like /api/order/data:
//        joinName = menu.product ?? menu.subProduct
//        match stock rows where stock.product === joinName
//          AND (menu.baseColour ? stock.baseColour === menu.baseColour : any base)
//   3. isPrimary = true ONLY. isPrimary=false twins are skipped entirely.
//   4. PACK is normalized with cleanPackCode() — a byte-for-byte mirror of
//      enrich.ts's cleanPack step — so the dictionary key matches what the
//      engine computes from an incoming line at lookup time.
//   5. Dictionary key = `${nameUpper}|${cleanPack}` -> material.
// ─────────────────────────────────────────────────────────

import { emailLineLabel } from "../place-order/email";
import { formatPack } from "../place-order/pack";

/** Minimal menu shape (subset of mo_order_form_index_v2 the join needs). */
export interface TableCMenuRow {
  product:    string | null;
  subProduct: string;
  baseColour: string | null;
}

/** Minimal stock shape (subset of mo_sku_lookup_v2 the join needs). */
export interface TableCStockRow {
  product:    string;
  baseColour: string;
  packCode:   string;
  unit:       string | null;
  material:   string;
  isPrimary:  boolean;
}

/** One emitted (menu row × matched stock pack) dictionary entry. */
export interface TableCRecord {
  key:         string;
  name:        string;        // nameUpper (emailLineLabel, uppercased)
  baseColour:  string | null; // the MENU base that produced the name
  packCodeRaw: string;        // stock.packCode verbatim
  unit:        string | null; // stock.unit
  packLabel:   string;        // formatPack(packCodeRaw, unit) — e.g. "1L", "50ML", "1 pc"
  cleanPack:   string;        // engine-normalized pack token — e.g. "1", "50"
  material:    string;        // SAP material this entry resolves to
}

/** A key that resolved to 2+ DISTINCT materials — recorded, never silently picked. */
export interface TableCCollision {
  key:       string;
  materials: string[];
}

export interface TableCResult {
  /** The dictionary: `${nameUpper}|${cleanPack}` -> material (first-seen). */
  table:            Map<string, string>;
  /** Every key that clashed on 2+ distinct materials (full ambiguity recorded). */
  collisions:       TableCCollision[];
  /** Fast membership set of the clashing keys (for per-row CSV flagging). */
  collisionKeys:    Set<string>;
  /** Every emitted entry, one per (menu row × matched stock pack). */
  records:          TableCRecord[];
  /** Menu rows iterated. */
  menuRowsScanned:  number;
  /** Menu rows that joined to ZERO stock packs (null-product / unjoined risk rows). */
  menuRowsZeroKeys: number;
}

/* ── Pack normalization — byte-for-byte mirror of enrich.ts ─────────────────
   PACK_ROUND mirrors lib/mail-orders/enrich.ts (not exported there). Prompt B
   should switch enrich.ts to import cleanPackCode() from here to kill the
   duplication; until then these two copies MUST stay in lock-step. */
const PACK_ROUND: Record<string, string> = {
  "0.925": "1",
  "0.9":   "1",
  "0.975": "1",
  "3.6":   "4",
  "3.7":   "4",
  "9":     "10",
  "9.25":  "10",
  "18":    "20",
  "18.5":  "20",
};

/**
 * Normalize a pack code the SAME way enrich.ts does at lookup time
 * (enrich.ts §"Step 2: Clean pack code"): upper + strip whitespace, strip a
 * trailing unit suffix, default empty -> "1", then PACK_ROUND fractional ->
 * standard. Shared by the dictionary build AND (Prompt B) the engine, so the
 * two sides can never drift.
 */
export function cleanPackCode(packCodeRaw: string | null | undefined): string {
  let cleanPack = (packCodeRaw ?? "").toUpperCase().replace(/\s+/g, "");
  cleanPack = cleanPack.replace(/(ML|LTR|LT|KG|LITT|G|L)$/i, "");
  if (!cleanPack) cleanPack = "1";
  if (PACK_ROUND[cleanPack]) cleanPack = PACK_ROUND[cleanPack];
  return cleanPack;
}

/** The dictionary key — the single shared key shape (build-time == lookup-time). */
export function tableCKey(nameUpper: string, cleanPack: string): string {
  return `${nameUpper}|${cleanPack}`;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(value);
}

/**
 * Build Table C from the v2 menu + stock rows.
 *
 * @param menuRows  mo_order_form_index_v2 rows (isActive) — name source.
 * @param stockRows mo_sku_lookup_v2 rows — pack + material source. Non-primary
 *                  twins are skipped internally (rule 3), so callers may pass
 *                  the full set safely.
 */
export function buildTableC(
  menuRows: TableCMenuRow[],
  stockRows: TableCStockRow[],
): TableCResult {
  // ── Index stock exactly like /api/order/data's packMap (dual key) ──────
  //   byProduct        — for menu rows with no baseColour (any base)
  //   byProductBase    — for menu rows that carry a baseColour
  // Skip non-primary twins (rule 3) and the route's `!product || !packCode`
  // rows so the join matches the live catalog 1:1.
  const byProduct     = new Map<string, TableCStockRow[]>();
  const byProductBase = new Map<string, TableCStockRow[]>();
  for (const s of stockRows) {
    if (!s.isPrimary) continue;
    if (!s.product || !s.packCode) continue;
    push(byProduct, s.product, s);
    if (s.baseColour) push(byProductBase, `${s.product}|||${s.baseColour}`, s);
  }

  const records         = [] as TableCRecord[];
  const materialsByKey  = new Map<string, Set<string>>();
  let   menuRowsZeroKeys = 0;

  for (const m of menuRows) {
    const joinName  = m.product ?? m.subProduct;
    const nameUpper = emailLineLabel(m.product, m.baseColour, m.subProduct).toUpperCase();

    const matched = m.baseColour
      ? byProductBase.get(`${joinName}|||${m.baseColour}`) ?? []
      : byProduct.get(joinName) ?? [];

    if (matched.length === 0) {
      menuRowsZeroKeys++;   // null-product / unjoined → emits nothing (risk row)
      continue;
    }

    for (const s of matched) {
      const packCodeRaw = String(s.packCode);
      const cleanPack   = cleanPackCode(packCodeRaw);
      const packLabel   = formatPack(packCodeRaw, s.unit);
      const key         = tableCKey(nameUpper, cleanPack);

      records.push({
        key,
        name:       nameUpper,
        baseColour: m.baseColour,
        packCodeRaw,
        unit:       s.unit,
        packLabel,
        cleanPack,
        material:   s.material,
      });

      let mats = materialsByKey.get(key);
      if (!mats) {
        mats = new Set<string>();
        materialsByKey.set(key, mats);
      }
      mats.add(s.material);
    }
  }

  // ── Collisions: keys that resolved to 2+ DISTINCT materials ────────────
  const collisions    = [] as TableCCollision[];
  const collisionKeys = new Set<string>();
  for (const [key, mats] of Array.from(materialsByKey.entries())) {
    if (mats.size >= 2) {
      collisions.push({ key, materials: Array.from(mats) });
      collisionKeys.add(key);
    }
  }

  // ── Final dictionary: key -> material (first-seen), EXCLUDING collision
  //    keys. A key that resolved to 2+ distinct materials is ambiguous, so it
  //    is left OUT of the lookup map entirely — a fast-path miss there falls
  //    through to keyword scoring (which disambiguates it today). The full
  //    ambiguity for every excluded key is still preserved in `collisions`.
  const table = new Map<string, string>();
  for (const r of records) {
    if (collisionKeys.has(r.key)) continue;       // ambiguous → not in the dict
    if (!table.has(r.key)) table.set(r.key, r.material);
  }

  return {
    table,
    collisions,
    collisionKeys,
    records,
    menuRowsScanned: menuRows.length,
    menuRowsZeroKeys,
  };
}

// ─────────────────────────────────────────────────────────
// Combo siblings — alt-SKU twins sharing a product|base|pack combo
// ─────────────────────────────────────────────────────────
// Inverse of enrich.ts's byCombo/byComboAlt (enrich.ts:270-286): instead of
// keeping only the 1st (primary) + 2nd (alt) row per combo and DROPPING the
// 3rd+, this keeps EVERY member so the mail-order line UI can surface all
// alternate SKUs that share a line's (product|baseColour|packCode). Pure,
// additive, read-only — used at load time by /api/mail-orders; the billed
// skuCode stays the primary, this is informational only.

/** Minimal stock shape for sibling grouping (subset of mo_sku_lookup_v2). */
export interface ComboSiblingRow {
  material:    string;
  product:     string;
  baseColour:  string;
  packCode:    string;
  description: string;
}

export interface ComboSiblingMaps {
  /** material -> `${product}|${baseColour}|${packCode}` */
  materialToCombo: Map<string, string>;
  /** combo key -> ALL members (code + description), primary included */
  comboToSiblings: Map<string, { code: string; description: string }[]>;
}

/** The combo key — product|baseColour|packCode (raw, un-normalized). */
export function comboKeyFor(product: string, baseColour: string, packCode: string): string {
  return `${product}|${baseColour}|${packCode}`;
}

/**
 * Build the material->combo and combo->siblings maps from v2 stock rows.
 * Keeps ALL rows for a combo (no 1st/2nd cap), so callers can list every
 * twin and subtract the line's own code at read time.
 */
export function buildComboSiblings(skus: ComboSiblingRow[]): ComboSiblingMaps {
  const materialToCombo = new Map<string, string>();
  const comboToSiblings = new Map<string, { code: string; description: string }[]>();
  for (const s of skus) {
    if (!s.material) continue;
    const key = comboKeyFor(s.product, s.baseColour, s.packCode);
    materialToCombo.set(s.material, key);
    let members = comboToSiblings.get(key);
    if (!members) {
      members = [];
      comboToSiblings.set(key, members);
    }
    members.push({ code: s.material, description: s.description });
  }
  return { materialToCombo, comboToSiblings };
}
