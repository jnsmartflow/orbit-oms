// lib/stock-audit/catalog.ts — builds the searchable SKU list the counter's
// phone downloads ONCE and searches locally (GET /api/stock-count/catalog).
// SERVER-ONLY: Prisma + node:crypto. The phone imports lib/stock-audit/
// sku-search.ts, never this file.
//
// ⚠️ MATERIAL ONLY — the list carries the SAP code, never a sku_master /
// sku_master_v2 row id (CORE §13, the id-space landmine).
//
// VERSION = A CONTENT HASH, not updatedAt. sku_master_v2.updatedAt has no
// @updatedAt and is maintained by hand (CORE §7.1.c); an isActive flip or a
// CSV reload need not move it. The hash is over the exact rows shipped, so ANY
// change to what the phone would search changes the version — and nothing
// else does.
//
// Cost: one findMany of ~2,100 rows + one sha1, per screen open. The
// phone sends ?have=<version> and gets a ~60-byte "unchanged" when it is current.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { formatPack } from "@/lib/place-order/pack";
import { TAGGED_CODE, type CatalogRow } from "./sku-search";

export interface CatalogPayload {
  version: string;
  rows: CatalogRow[];
}

/** EVERY untagged catalogue row, active AND inactive (Smart Flow, 2026-11-04 —
 *  inactive stock can still be on the floor), active first, then isPrimary
 *  first, then material — the search order. The isActive flag rides slot 5, so
 *  it is inside the hash: flipping a row's isActive changes the version. */
export async function buildCatalog(): Promise<CatalogPayload> {
  const skus = await prisma.sku_master_v2.findMany({
    orderBy: [{ isActive: "desc" }, { isPrimary: "desc" }, { material: "asc" }],
    select: { material: true, description: true, packCode: true, unit: true, isPrimary: true, isActive: true },
  });
  const rows: CatalogRow[] = [];
  for (const s of skus) {
    if (TAGGED_CODE.test(s.material)) continue;
    rows.push([s.material, s.description, formatPack(s.packCode, s.unit), s.isPrimary ? 1 : 0, s.isActive ? 1 : 0]);
  }
  const version = createHash("sha1").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  return { version, rows };
}
