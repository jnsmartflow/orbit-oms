// lib/ci/number.ts
//
// Allocates `ciNumber` — CI-{YEAR}-{5 digits}, unique across the whole table.
//
// COPIED FROM lib/mrn/number.ts, deliberately, and not from the challan
// allocator (spec §5). There is no shared CHN- allocator to reuse — it is built
// inline at six call sites — and MRN's is the later, better-reasoned one:
// year-prefixed scope rather than a global max, ordering on the zero-padded
// number itself rather than a surrogate `id`, an explicit Number.isFinite guard,
// and A RESET TO 00001 EACH JANUARY, which CHN- does not do.
//
// 🔴 NO `isVoided` FILTER ON THE SEQUENCE QUERY.
//
// `ci_returns` soft-voids: a voided CI keeps its row with isVoided = true, and
// the database still enforces UNIQUE("ciNumber") against it. Filtering here
// would hand the next return a number a voided row still holds, and the INSERT
// would throw a P2002 on a screen where the operator did nothing wrong.
//
// This is the same rule the challan sequence follows — the one challan read that
// deliberately does not filter isVoided while every other one does (CORE §13) —
// and the same rule lib/mrn/number.ts keeps for isRemoved. Everywhere ELSE in
// this module every read filters voided rows out; this query is the documented
// exception. A voided CI's number is never reused.

import { prisma } from "@/lib/prisma";

/** Zero-padding width of the numeric half. */
const SEQ_WIDTH = 5;

/**
 * Render a CI number. Pure — exported so a preview formats it with the same
 * rule that writes it.
 */
export function formatCiNumber(year: number, seq: number): string {
  return `CI-${year}-${String(seq).padStart(SEQ_WIDTH, "0")}`;
}

/** The `CI-{year}-` prefix, for the startsWith scan below. */
function ciNumberPrefix(year: number): string {
  return `CI-${year}-`;
}

export interface CiIdentity {
  ciNumber: string;
  /** The year the sequence counts against — handy for a preview caption. */
  year: number;
  /** The numeric half, unpadded. */
  seq: number;
}

/**
 * Allocate the next `ciNumber` for a CI being submitted on `submittedAt`.
 *
 * The clock is passed IN, never read inside — the same discipline
 * lib/mrn/number.ts and lib/picking/picker-split.ts follow, so this is testable
 * and a backfill can allocate against a past date.
 *
 * ⚠ ALLOCATED AT SUBMIT, NEVER WHEN THE FORM OPENS (spec §5). That is the whole
 * reason ci_returns.ciNumber is NULLABLE: the write order is insert the header
 * as draft → insert the lines → allocate and flip to 'submitted', so a failure
 * part-way leaves a numberless draft rather than a numbered CI with no lines on
 * the floor's screen. Every list filters `status <> 'draft'`, so such a row is
 * never user-visible.
 *
 * Sequential awaits, never prisma.$transaction (CORE §3).
 *
 * ⚠ NOT ATOMIC, AND THAT IS AN ACCEPTED TRADE. Two submits racing on the same
 * millisecond can read the same maximum and collide. At this depot that is a
 * handful of returns a day, so the window is theoretical — and UNIQUE("ciNumber")
 * is the real backstop: the loser gets a P2002 rather than a duplicate number.
 * The submit route (step 3c) must surface that as "please try again". Do NOT
 * "fix" this with $transaction; it is banned here (Vercel serverless + the
 * Supabase pooler time out on it).
 */
export async function allocateCiNumber(submittedAt: Date): Promise<CiIdentity> {
  // The calendar year in IST, not UTC. A CI submitted at 02:00 IST on 1 January
  // is 19:30 UTC on 31 December — reading the UTC year would file it under the
  // previous year's sequence and, worse, do so for exactly five and a half
  // hours every New Year. lib/mrn/number.ts does not face this because it reads
  // a @db.Date (already UTC-midnight anchored); this takes a timestamptz.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const year = new Date(submittedAt.getTime() + IST_OFFSET_MS).getUTCFullYear();

  // 🔴 NO isVoided FILTER — see this file's header.
  //
  // Ordered lexicographically DESC over a zero-padded fixed-width suffix, which
  // within a single `CI-{year}-` prefix is identical to numeric DESC — and it
  // rides the ci_returns_ciNumber_key btree instead of scanning. MAX+1, never
  // COUNT+1: a count silently collides the moment the sequence has any gap, and
  // gaps are expected (a voided CI keeps its number; an abandoned draft never
  // had one).
  const prefix = ciNumberPrefix(year);
  const latest = await prisma.ci_returns.findFirst({
    where: { ciNumber: { startsWith: prefix } },
    orderBy: { ciNumber: "desc" },
    select: { ciNumber: true },
  });

  const lastSeq = latest?.ciNumber
    ? Number.parseInt(latest.ciNumber.slice(prefix.length), 10)
    : 0;
  // A malformed suffix (hand-edited row) would otherwise poison the sequence
  // with NaN, which formats as "CI-2026-000NaN" and passes the unique index.
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;

  return { ciNumber: formatCiNumber(year, seq), year, seq };
}
