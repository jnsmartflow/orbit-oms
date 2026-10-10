// lib/sales-officer/resolve.ts
//
// FREE-TEXT SO NAME → THE PERSON. A sales officer's name reaches Orbit as free
// text (mo_orders.soName, a ship-to contact's name), spelled a dozen ways —
// "(JSW) Jha Roopesh Ghanshyam", "Rupesh Jha". The alias dictionary
// (sales_officer_aliases, Schema v27.62) maps the NORMALISED spelling to one
// sales_officer_master row; this file is the one place code reads it.
//
// 🔴 Delivery Challans are EXCLUDED by owner (2026-10-10) — never call
//    this from lib/customers/sales-officer.ts, lib/tint/challan-*, or
//    components/tint/challan-*. The challan keeps the FULL master name exactly
//    as it prints today.
//
// The key is computed by the LIVE SQL function so_alias_key(text) (IMMUTABLE),
// never mirrored in TypeScript: one definition, so code and the dictionary
// cannot drift. ONE parameterised read per call, batched over every name the
// caller has (unnest), no transaction. A name with no alias gets NO entry —
// callers keep their own fallback (today's displaySoName, "Telecaller", "—").
//
// Smoke test: scripts/check-so-resolver.ts (read-only).

import { prisma } from "@/lib/prisma";

/** "#19 TEST — Smart Flow" and "#21 NULL" — never resolved to, same as the
 *  prefill (sql/2026-10-10-so-alias-prefill.sql). */
const EXCLUDED_MASTER_IDS = [19, 21];

export interface ResolvedSalesOfficer {
  salesOfficerId: number;
  /** master."displayName", falling back to master.name when blank. */
  displayName: string;
  /** master.name — the full name. */
  name: string;
  phone: string | null;
}

interface Row {
  raw: string;
  salesOfficerId: number;
  name: string;
  displayName: string;
  phone: string | null;
}

/**
 * Resolve free-text SO names, batched. The Map is keyed by the input string
 * exactly as given; only matched names have an entry. Empty / whitespace-only
 * input is dropped; an empty list returns an empty Map without a query.
 */
export async function resolveSoNames(raws: string[]): Promise<Map<string, ResolvedSalesOfficer>> {
  const out = new Map<string, ResolvedSalesOfficer>();
  const unique = Array.from(new Set(raws.filter((r) => typeof r === "string" && r.trim() !== "")));
  if (unique.length === 0) return out;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT u.raw                                                   AS raw,
           m.id                                                    AS "salesOfficerId",
           m.name                                                  AS name,
           coalesce(nullif(btrim(m."displayName"), ''), m.name)    AS "displayName",
           nullif(btrim(m.phone), '')                              AS phone
      FROM unnest(${unique}::text[]) AS u(raw)
      JOIN sales_officer_aliases a ON a."aliasKey" = so_alias_key(u.raw)
      JOIN sales_officer_master m  ON m.id = a."salesOfficerId"
     WHERE m.id <> ALL(${EXCLUDED_MASTER_IDS}::int[])
  `;
  for (const r of rows) {
    out.set(r.raw, {
      salesOfficerId: Number(r.salesOfficerId),
      displayName: r.displayName,
      name: r.name,
      phone: r.phone,
    });
  }
  return out;
}
