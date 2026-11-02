// lib/stock-audit/line-write.ts — turns a counter's POST / PATCH body into the
// exact columns a stock_audit_lines row gets. Shared by
// app/api/stock-count/audits/[id]/lines (POST) and
// app/api/stock-count/lines/[lineId] (PATCH), so the two cannot drift.
//
// ⚠️ MATERIAL ONLY — the line stores the SAP code as typed (trimmed,
// upper-cased) and a SNAPSHOT of description + pack. Never a sku_master /
// sku_master_v2 row id: the two tables give the same code different ids
// (CORE §13, the id-space landmine). There is no FK to the catalog.
//
// 🔴 THE TOTAL IS COMPUTED HERE, ON THE SERVER, with calc.ts computeTotal. Any
// total the client sends is ignored. chk_stock_audit_lines_total is the
// database's copy of the same rule.
//
// Not in catalog: refused with 400 NOT_IN_CATALOG unless the body carries
// notInCatalog: true (the phone asks the counter to confirm first) — then
// inCatalog = false and description / pack are NULL (Smart Flow, 2026-11-02).

import type { NextResponse } from "next/server";
import { computeTotal, validateLineInput } from "./calc";
import { saError } from "./gate";
import { normaliseMaterial, resolveCatalogMaterial } from "./queries";
import type { CountMode } from "./status";

export interface LineWriteData {
  material: string;
  inCatalog: boolean;
  skuDescription: string | null;
  skuPack: string | null;
  mode: CountMode;
  stack: number;
  rows: number;
  depth: number;
  pcsPerCarton: number | null;
  loose: number;
  totalPcs: number;
}

export type LineWrite = { ok: true; data: LineWriteData } | { ok: false; response: NextResponse };

export async function prepareLineWrite(body: Record<string, unknown>): Promise<LineWrite> {
  const material = normaliseMaterial(body.material);
  if (material === null) {
    return {
      ok: false,
      response: saError(400, "INVALID", "Enter a SKU code (letters, digits and '-', up to 40)", {
        fields: [{ field: "material", message: "Enter a SKU code" }],
      }),
    };
  }

  const v = validateLineInput({
    mode: body.mode,
    stack: body.stack,
    rows: body.rows,
    depth: body.depth,
    pcsPerCarton: body.pcsPerCarton,
    loose: body.loose,
  });
  if (!v.ok) {
    return {
      ok: false,
      response: saError(400, "INVALID", v.errors.map((e) => e.message).join(" · "), { fields: v.errors }),
    };
  }

  if (body.notInCatalog !== undefined && typeof body.notInCatalog !== "boolean") {
    return { ok: false, response: saError(400, "INVALID", "notInCatalog must be true or false") };
  }

  const catalog = await resolveCatalogMaterial(material);
  if (catalog === null && body.notInCatalog !== true) {
    return {
      ok: false,
      response: saError(400, "NOT_IN_CATALOG", `${material} is not in the SKU catalog — confirm to count it anyway`),
    };
  }

  return {
    ok: true,
    data: {
      material,
      inCatalog: catalog !== null,
      skuDescription: catalog?.description ?? null,
      skuPack: catalog?.pack ?? null,
      mode: v.working.mode,
      stack: v.working.stack,
      rows: v.working.rows,
      depth: v.working.depth,
      pcsPerCarton: v.working.pcsPerCarton,
      loose: v.working.loose,
      // Server-side, never the client's.
      totalPcs: computeTotal(v.working),
    },
  };
}
