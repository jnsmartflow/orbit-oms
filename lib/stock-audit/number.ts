// lib/stock-audit/number.ts
//
// Allocates an audit's identity: `seq` (1, 2, 3 …) and `auditNumber`
// (SA-0001, SA-0002 …), both UNIQUE on stock_audits (Schema v27.78).
//
// MRN / CI STYLE, NOT THE TRIP STYLE. lib/trips/number.ts hands out the LOWEST
// FREE seq per day per type and gives a cancelled trip's number back; neither
// applies here. An audit number is one global running sequence: MAX(seq) + 1
// over ALL rows, never reused, never reset (lib/mrn/number.ts and
// lib/ci/number.ts reset each January; this does not — the brief is
// SA-0001, SA-0002 …). Audits are never deleted and never reopened, so there
// is no soft-deleted row to forget — but the query still reads every row, on
// purpose, so that rule survives if a delete is ever added.
//
// 🔴 THE FORMAT IS A DATABASE RULE. chk_stock_audits_number_shape (live text):
//   CHECK (("auditNumber" = ('SA-'::text || lpad((seq)::text,
//          GREATEST(4, length((seq)::text)), '0'::text))))
// formatAuditNumber below is the same rule. Postgres lpad TRUNCATES, which is
// why the width is greatest(4, length): a bare 4 would refuse SA-10000. JS
// padStart never truncates, so padStart(4) matches it for every seq ≥ 1.
//
// ⚠ NOT ATOMIC, AND THAT IS AN ACCEPTED TRADE (the CI/MRN reasoning). Two
// creates in the same instant can read the same MAX. The UNIQUEs on seq and
// "auditNumber" are the backstop; allocateAuditNumberWithRetry re-reads and
// retries ONCE (the trips pattern), then lets the error surface. Never
// prisma.$transaction (CORE §3) — sequential awaits only.
//
// (This file never touches a SKU. The rule that every stock-audit line stores
// the SAP `material` and never a sku_master / sku_master_v2 row id — CORE §13,
// the id-space landmine — is restated in each server-side file that does.)

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Minimum zero-padded width of the numeric half. */
const SEQ_WIDTH = 4;

const PREFIX = "SA-";

/** Render an audit number. Pure — a preview formats it with the rule that writes it. */
export function formatAuditNumber(seq: number): string {
  return `${PREFIX}${String(seq).padStart(SEQ_WIDTH, "0")}`;
}

export interface AuditIdentity {
  seq: number;
  auditNumber: string;
}

/**
 * The next identity: MAX(seq) + 1 over every row. Ordered on the integer
 * `seq` (stock_audits_seq_key backs it), never on the text — "SA-10000" sorts
 * below "SA-9999" as a string.
 */
export async function allocateAuditNumber(): Promise<AuditIdentity> {
  const latest = await prisma.stockAudit.findFirst({
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const last = latest?.seq ?? 0;
  const seq = (Number.isFinite(last) && last > 0 ? last : 0) + 1;
  return { seq, auditNumber: formatAuditNumber(seq) };
}

/**
 * Was this a collision on seq / auditNumber? Prisma 5.22 reports the FIELD
 * names in meta.target (see isTripNumberCollision in lib/trips/number.ts); the
 * index names are matched too in case a later Prisma reports those.
 */
export function isAuditNumberCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return (
    asText.includes("stock_audits_seq_key") ||
    asText.includes("stock_audits_auditNumber_key") ||
    asText.includes("auditNumber") ||
    asText.split(",").map((s) => s.trim()).includes("seq")
  );
}

/**
 * Allocate, then run `create` with the identity; on a number collision
 * re-allocate ONCE and try again. A second collision surfaces — the route
 * answers "please try again" rather than looping on a serverless function.
 */
export async function allocateAuditNumberWithRetry<T>(
  create: (identity: AuditIdentity) => Promise<T>,
): Promise<T> {
  const first = await allocateAuditNumber();
  try {
    return await create(first);
  } catch (err) {
    if (!isAuditNumberCollision(err)) throw err;
    const second = await allocateAuditNumber();
    return await create(second);
  }
}
