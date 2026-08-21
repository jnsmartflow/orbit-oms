// lib/mrn/number.ts
//
// Allocates the two identifiers a new MRN needs: `mrnNumber` (MRN-{YEAR}-{5
// digits}, unique across the whole table) and `srNo` (the truck's position
// within its `mrnDate`).
//
// 🔴🔴 BOTH ALLOCATORS DELIBERATELY COUNT SOFT-REMOVED ROWS. 🔴🔴
//
// This is the single most dangerous rule in the module, so it is stated once
// here and again at each of the two call sites below.
//
// `mrn` soft-deletes: a deleted MRN keeps its row with isRemoved = true, and
// the DB still enforces UNIQUE(mrnNumber) and UNIQUE(mrnDate, srNo) against it.
// Filtering `isRemoved: false` in either query here would hand the next truck a
// number a deleted row still holds, and the INSERT would throw a P2002 on a
// screen where the operator did nothing wrong.
//
// This is exactly the challan sequence-allocation rule — the ONE challan read
// that deliberately does not filter `isVoided` while every other one does
// (CORE §13). Everywhere ELSE in this module, every read filters
// `isRemoved: false`; these two queries are the documented exception.
//
// A deleted MRN's number is never reused. The design says so in words (§7) and
// this file is where that promise is actually kept.

import { prisma } from "@/lib/prisma";

/** Zero-padding width of the numeric half of an MRN number. */
const SEQ_WIDTH = 5;

/**
 * Render an MRN number. Pure — exported so a preview ("this is truck 4 today,
 * MRN-2026-00042") formats it with the same rule that writes it.
 */
export function formatMrnNumber(year: number, seq: number): string {
  return `MRN-${year}-${String(seq).padStart(SEQ_WIDTH, "0")}`;
}

/** The `MRN-{year}-` prefix, for the startsWith scan below. */
function mrnNumberPrefix(year: number): string {
  return `MRN-${year}-`;
}

/**
 * The calendar year an MRN number counts against, read off the MRN's own date.
 *
 * ⚠ `mrnDate` is a @db.Date, which Prisma hands back as a Date anchored at UTC
 * MIDNIGHT — so its UTC parts ARE its calendar parts. `getUTCFullYear()` is
 * therefore correct and `getFullYear()` would be a bug on any host west of UTC.
 * Nothing here parses a string, so CORE §3's offset-less `Date.parse()` trap
 * does not arise.
 */
function yearOf(mrnDate: Date): number {
  return mrnDate.getUTCFullYear();
}

export interface MrnIdentity {
  mrnNumber: string;
  srNo: number;
  /** The year the sequence counts against — handy for a preview caption. */
  year: number;
  /** The numeric half, unpadded. */
  seq: number;
}

/**
 * Allocate the next `mrnNumber` and `srNo` for an MRN being raised on `mrnDate`.
 *
 * `mrnDate` is passed IN, never read from a clock inside — the caller owns the
 * clock (the same discipline lib/picking/picker-split.ts follows), so this is
 * testable and a backfill can allocate against a past date.
 *
 * Sequential awaits, never prisma.$transaction (CORE §3).
 *
 * ⚠ NOT ATOMIC, AND THAT IS AN ACCEPTED TRADE. Two creates racing on the same
 * millisecond can read the same maximum and collide. At this depot that is one
 * billing operator raising roughly four MRNs a day, so the window is
 * theoretical — and the DB's two UNIQUE indexes are the real backstop: the
 * loser gets a P2002 rather than a duplicate number. The create route should
 * surface that as "please try again", not as a corrupted MRN. Do NOT "fix" this
 * with $transaction; that is banned here (Vercel serverless + the Supabase
 * pooler time out on it).
 */
export async function allocateMrnIdentity(mrnDate: Date): Promise<MrnIdentity> {
  const year = yearOf(mrnDate);

  // ── mrnNumber ──────────────────────────────────────────────────────────────
  // 🔴 NO `isRemoved` FILTER — BY DESIGN. See this file's header. A removed
  // MRN still owns its number under UNIQUE(mrnNumber); skipping it here would
  // reissue that number and the INSERT would throw.
  //
  // Ordered lexicographically DESC over a zero-padded fixed-width suffix, which
  // within a single `MRN-{year}-` prefix is identical to numeric DESC — and it
  // rides the mrn_mrnNumber_key btree instead of scanning. MAX+1, never
  // COUNT+1: a count silently collides the moment the sequence has any gap, and
  // gaps are expected here (a year can start mid-sequence after a data fix).
  const prefix = mrnNumberPrefix(year);
  const latest = await prisma.mrn.findFirst({
    where: { mrnNumber: { startsWith: prefix } },
    orderBy: { mrnNumber: "desc" },
    select: { mrnNumber: true },
  });

  const lastSeq = latest ? Number.parseInt(latest.mrnNumber.slice(prefix.length), 10) : 0;
  // A malformed suffix (hand-edited row) would otherwise poison the sequence
  // with NaN, which formats as "MRN-2026-000NaN" and passes the unique index.
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;

  // ── srNo ───────────────────────────────────────────────────────────────────
  // 🔴 NO `isRemoved` FILTER — BY DESIGN, same reason. UNIQUE(mrnDate, srNo)
  // is enforced against removed rows too, so a filtered MAX here would hand
  // truck 4 the number a deleted truck 4 still holds.
  //
  // Rides mrn_mrnDate_srNo_key. MAX+1 for the same gap-tolerance reason.
  const lastOfDay = await prisma.mrn.findFirst({
    where: { mrnDate },
    orderBy: { srNo: "desc" },
    select: { srNo: true },
  });

  const srNo = (lastOfDay?.srNo ?? 0) + 1;

  return { mrnNumber: formatMrnNumber(year, seq), srNo, year, seq };
}
