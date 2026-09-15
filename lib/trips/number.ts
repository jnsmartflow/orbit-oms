// lib/trips/number.ts
//
// Allocates `tripNumber` — {T}-{YYMMDD}-{NN}, e.g. L-260909-01 — and names the
// cancelled trip that gives a number back.
//
// COPIED FROM lib/ci/number.ts, deliberately, and it keeps two of that file's
// load-bearing choices: the clock passed IN rather than read inside, and the
// unique index as the real backstop instead of a lock. What differs is the scope
// — CI counts per YEAR over a text prefix, a trip counts per (tripDate, typeCode)
// over an integer column — and, since slice 5 (2026-09-15), the rule: a trip
// takes the LOWEST FREE seq, not MAX+1.
//
// 🔴 A CANCELLED TRIP GIVES ITS NUMBER BACK, DELIBERATELY (slice 5, 2026-09-15).
// Cancel 03 and the next trip built that day and type is 03 again. The day's
// numbers stay a gapless run of the loads that are actually planned, which is
// what the floor reads them as. The cancelled row is NOT deleted and NOT
// forgotten: cancelling renames it <number>-C (then -C2, -C3 …), so its old
// number is free on paper and in the unique index, while the row itself keeps
// its history. The known cost is a sheet printed for the cancelled trip, which
// carries the same number as its successor — that is why a create that reuses a
// number says so in its activity row ("number reused, previously held by
// L-260915-03-C"), so any confusion on paper can be traced.
//
// 🔴 NOT ATOMIC, AND THAT IS THE SAME ACCEPTED TRADE lib/ci/number.ts records.
// Two planners building a trip in the same second read the same free seq and
// collide. This module RETRIES ONCE (see allocateTripNumberWithRetry), because a
// trip is built from a drawer the planner is standing in front of, and handing
// him "please try again" for a race he cannot see is worse than one extra round
// trip. Do NOT "fix" this with prisma.$transaction — it is banned (CORE §3:
// Vercel serverless + the Supabase pooler time out on it).
//
// 🔴 TWO UNIQUES BACK THIS, AND BOTH MUST STAY:
//   trips_tripNumber_key          UNIQUE ("tripNumber")
//   trips_date_type_seq_live_key  UNIQUE ("tripDate","typeCode",seq)
//                                 WHERE status <> 'cancelled'   (partial)
// The partial index is what frees a cancelled trip's SEQ. The text unique still
// blocks a cancelled trip's TEXT, which is why the rename on cancel is not
// cosmetic: a cancelled trip still named L-260914-03 would refuse every attempt
// to reuse 03. A caller must treat a P2002 on EITHER as the same retryable
// collision — see isTripNumberCollision() below.
//
// 🔴 AND A THIRD GUARD IN THE DATABASE: chk_trips_number_shape proves
//   base = "typeCode" || '-' || to_char("tripDate",'YYMMDD') || '-'
//          || lpad(seq::text, greatest(2, length(seq::text)), '0')
//   a live trip:      "tripNumber" = base
//   a cancelled trip: "tripNumber" ~ ('^' || base || '-C([2-9]|[1-9][0-9]+)?$')
// so a number this module formats differently from the columns beside it is
// REJECTED at insert time rather than stored. formatTripNumber() and
// cancelledTripNumber() below are the TypeScript half of that same rule; if you
// change one you must ALTER the other in the Supabase SQL Editor first (CORE §3).
//
// ⚠ POSTGRES lpad TRUNCATES. `lpad('100', 2, '0')` is '10' — verified against
// production 2026-09-15. The CHECK therefore pads to greatest(2, length), never
// to a bare 2; the original CHECK did the latter and would have refused the
// 100th trip of a day. Do not "simplify" the width back to 2.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Delivery type name → the letter that opens a trip number.
 *
 * 🔴 AN EXPLICIT MAP, NEVER A DERIVATION. `name.charAt(0).toUpperCase()` would
 * give Local 'L' and Upcountry 'U' and look correct — and then give IGT 'I' by
 * luck and Cross 'C' by luck, until somebody adds a fifth type starting with a
 * letter already taken and two different delivery types silently share a
 * sequence. The map is the whole point: a type this file has not been taught
 * about THROWS rather than guessing.
 *
 * Keys are `delivery_type_master.name` values, verified live 2026-09-09:
 * Local (id 1), Upcountry (id 2), IGT (id 5), Cross (id 6).
 *
 * ⚠ ALL FOUR LETTERS ARE ADMITTED BY THE DATABASE. chk_trips_type_code reads
 * ('L','U','I','C') live — verified 2026-09-15 — and production already holds a
 * Cross trip (C-260911-01). An earlier version of this comment said the CHECK
 * refused 'C'; that was true of the first draft of the constraint and was never
 * true of the live one. A fifth type still needs BOTH this map and an ALTER of
 * that CHECK.
 */
const TYPE_CODE_BY_DELIVERY_TYPE: Record<string, string> = {
  Local: "L",
  Upcountry: "U",
  IGT: "I",
  Cross: "C",
};

/** Minimum width of the sequence half. */
const SEQ_MIN_WIDTH = 2;

/** The collision index names. Exported so nothing hardcodes one of them twice. */
export const TRIP_NUMBER_UNIQUE = "trips_tripNumber_key";
export const TRIP_SEQ_LIVE_UNIQUE = "trips_date_type_seq_live_key";

/**
 * The letter for a delivery type name.
 *
 * THROWS on anything unmapped, loudly and by name. A trip number is printed on
 * a driver's sheet and used to find the load again; a wrong or invented letter
 * is not recoverable once the paper is out of the building.
 */
export function typeCodeForDeliveryType(name: string): string {
  const code = TYPE_CODE_BY_DELIVERY_TYPE[name];
  if (code === undefined) {
    throw new Error(
      `No trip-number letter is defined for delivery type "${name}". ` +
        `Known types: ${Object.keys(TYPE_CODE_BY_DELIVERY_TYPE).join(", ")}. ` +
        `Add it to TYPE_CODE_BY_DELIVERY_TYPE in lib/trips/number.ts — never guess a letter.`,
    );
  }
  return code;
}

/**
 * The YYMMDD half, read off a @db.Date value.
 *
 * ⚠ UTC GETTERS, NOT IST. `trips.tripDate` is `@db.Date`, which Prisma hands
 * back as a Date anchored at UTC midnight — the same shape `dispatchTargetDate`
 * carries, and the same reason lib/floor/queries.ts slices its ISO string
 * rather than converting a timezone. Applying an IST offset here would shift a
 * date-only value into the previous day for the first five and a half hours of
 * every date. There is no clock in a `@db.Date` to convert.
 *
 * This differs from lib/ci/number.ts on purpose: that one takes a timestamptz
 * and DOES apply the IST offset, because its input really is an instant.
 */
export function formatTripDatePart(tripDate: Date): string {
  const yy = String(tripDate.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(tripDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tripDate.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/**
 * Render a trip number. PURE — exported so a preview formats it with the exact
 * rule that writes it, and so a test can check it without a database.
 *
 * 🔴 PADS TO A MINIMUM OF TWO DIGITS AND NEVER TRUNCATES TO TWO.
 * `padStart` widens and leaves anything already longer alone: seq 7 renders
 * "07", seq 137 renders "137". The busiest observed day-and-type is 37 trips
 * (measured over 60 days, 2026-09-09) — 37% of a two-digit ceiling — so a
 * hundredth trip in one day is a matter of when, not if. A `.slice(-2)` here
 * would render seq 100 as "00" and collide with seq 0 while passing every
 * unique index.
 *
 * ⚠ THE DATABASE HALF IS NOT A BARE lpad. Postgres `lpad` TRUNCATES a longer
 * string to the width, so chk_trips_number_shape pads to
 * `greatest(2, length(seq::text))` — the SQL spelling of exactly what padStart
 * does here. Both halves must agree; see the header.
 */
export function formatTripNumber(typeCode: string, tripDate: Date, seq: number): string {
  return `${typeCode}-${formatTripDatePart(tripDate)}-${String(seq).padStart(SEQ_MIN_WIDTH, "0")}`;
}

/**
 * The name a trip takes when it is cancelled: `<number>-C`, then `-C2`, `-C3` …
 * PURE — the caller supplies every name already starting `<number>-C`.
 *
 * ⚠ THE SUFFIX SHAPE IS FENCED BY chk_trips_number_shape: `-C` alone, or `-C`
 * followed by 2 or more with no leading zero. There is deliberately no `-C1` —
 * the first cancel is plain `-C`, so the common case reads cleanly.
 *
 * ⚠ WHY A SECOND CANCEL HAPPENS AT ALL. Cancel 03 → 03-C. The next trip takes
 * 03. Cancel THAT one and 03-C is taken, so it becomes 03-C2. Each is a
 * different trip that really held the number 03 for a while.
 */
export function cancelledTripNumber(tripNumber: string, taken: readonly string[]): string {
  const used = new Set(taken);
  const first = `${tripNumber}-C`;
  if (!used.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${tripNumber}-C${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface TripIdentity {
  tripNumber: string;
  typeCode: string;
  /** The numeric half, unpadded. */
  seq: number;
}

/**
 * Is this error the trip-number race?
 *
 * Exported because a caller that catches it has to know the difference between
 * "somebody beat me to this number" (retry) and "this insert is wrong" (do not).
 * Matches a P2002 on EITHER unique — see the header for why both count.
 *
 * 🔴 WHAT PRISMA ACTUALLY REPORTS — MEASURED, NOT ASSUMED (2026-09-15, Prisma
 * 5.22.0, against production with inserts built to fail and verified to store
 * nothing):
 *   - a declared unique (`trips_tripNumber_key`): meta.target = ["tripNumber"]
 *   - a PARTIAL unique index Prisma cannot model, probed on
 *     customer_sales_officers' PRIMARY index: meta.target = ["customerId"] —
 *     the FIELD names, parsed from Postgres's error detail, not the index name.
 * So a hit on trips_date_type_seq_live_key arrives as
 * ["tripDate","typeCode","seq"]. Postgres also checks unique indexes in OID
 * order and `trips_tripNumber_key` is older, so a seq collision — which always
 * collides on the text as well — reports ["tripNumber"] first. Every spelling
 * is matched anyway: the index NAMES in case a future Prisma reports those
 * instead, the FIELDS because this one does.
 */
export function isTripNumberCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  // Prisma reports the constraint in meta.target, as a string or a string[]
  // depending on the connector and the index shape. Normalise to one string and
  // look for either name rather than trusting the container type.
  const target = err.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return (
    asText.includes(TRIP_NUMBER_UNIQUE) ||
    asText.includes(TRIP_SEQ_LIVE_UNIQUE) ||
    // The pre-slice-5 full unique, kept so a code deploy that lands before the
    // SQL still retries correctly.
    asText.includes("trips_date_type_seq_key") ||
    // What Prisma 5.22 actually reports — the FIELD names. See above.
    asText.includes("tripNumber") ||
    (asText.includes("tripDate") && asText.includes("seq"))
  );
}

/**
 * Allocate the next trip number for `(tripDate, typeCode)` — the LOWEST FREE
 * seq among trips that are not cancelled.
 *
 * 🔴 CANCELLED TRIPS DO NOT HOLD A NUMBER. They are renamed <number>-C on
 * cancel and excluded from trips_date_type_seq_live_key, so their seq is free
 * for the next trip. See the header for why reuse is deliberate.
 *
 * ⚠ A READ OF EVERY LIVE SEQ, NOT A MAX. The busiest day-and-type holds ~40
 * trips, so the list is small; walking it in order finds the first gap without
 * raw SQL. A reused number can therefore be LOWER than a trip created earlier
 * the same day — that is the rule, not a fault.
 *
 * Scoped by the SAME triple the partial unique index is on, filtered by the
 * SAME predicate, so the number it produces and the index that protects it are
 * asking the same question.
 *
 * The clock is NOT read here — `tripDate` is supplied. That keeps this testable
 * and lets a backfill allocate against a past day, exactly as lib/ci/number.ts
 * and lib/picking/picker-split.ts do.
 *
 * Sequential await, never prisma.$transaction (CORE §3).
 */
export async function allocateTripNumber(tripDate: Date, typeCode: string): Promise<TripIdentity> {
  const live = await prisma.trips.findMany({
    where: { tripDate, typeCode, status: { not: "cancelled" } },
    orderBy: { seq: "asc" },
    select: { seq: true },
  });

  // `seq` is NOT NULL and chk_trips_seq_positive keeps it >= 1, so the walk
  // starts at 1. Number.isFinite is kept anyway, matching lib/ci/number.ts: a
  // NaN reaching the format would produce "L-260909-NaN".
  let seq = 1;
  for (const row of live) {
    if (!Number.isFinite(row.seq) || row.seq < seq) continue;
    if (row.seq > seq) break;
    seq += 1;
  }

  return { tripNumber: formatTripNumber(typeCode, tripDate, seq), typeCode, seq };
}

/**
 * The cancelled trips that once held this number, NEWEST CANCEL FIRST.
 *
 * Called after a create, for the "number reused" line in its activity row.
 * Usually empty; one name after a single cancel; more when the same number has
 * been cancelled more than once (03-C2, 03-C).
 */
export async function findPreviousHolders(tripDate: Date, typeCode: string, seq: number): Promise<string[]> {
  const rows = await prisma.trips.findMany({
    where: { tripDate, typeCode, seq, status: "cancelled" },
    orderBy: [{ cancelledAt: "desc" }, { id: "desc" }],
    select: { tripNumber: true },
  });
  return rows.map((r) => r.tripNumber);
}

/**
 * Allocate, run `create`, and RETRY ONCE on the race.
 *
 * The caller supplies a function that performs the actual insert with the
 * identity it is handed. That inversion is what keeps this module free of any
 * knowledge of the trip's other columns — it owns the NUMBER, not the row.
 *
 * ⚠ ONE RETRY, NOT A LOOP. Two planners is the real contention here; a loop
 * would turn a genuine constraint problem — a hand-inserted row with a
 * malformed number, or a cancelled trip that was never renamed — into a hang on
 * a serverless function with a 30-second statement timeout (CORE §4). If the
 * second attempt collides too, the error surfaces and the drawer says "please
 * try again", which is honest.
 *
 * Sequential awaits throughout, never prisma.$transaction (CORE §3).
 */
export async function allocateTripNumberWithRetry<T>(
  tripDate: Date,
  typeCode: string,
  create: (identity: TripIdentity) => Promise<T>,
): Promise<T> {
  const first = await allocateTripNumber(tripDate, typeCode);
  try {
    return await create(first);
  } catch (err) {
    if (!isTripNumberCollision(err)) throw err;
    // Re-read the live seqs — the winner's row is committed by now, so this
    // skips their seq rather than repeating ours.
    const second = await allocateTripNumber(tripDate, typeCode);
    return await create(second);
  }
}
