// lib/trips/number.ts
//
// Allocates `tripNumber` — {T}-{YYMMDD}-{NN}, e.g. L-260909-01.
//
// COPIED FROM lib/ci/number.ts, deliberately, and it keeps that file's three
// load-bearing choices: MAX+1 rather than COUNT+1, the clock passed IN rather
// than read inside, and the unique index as the real backstop instead of a lock.
// What differs is the scope — CI counts per YEAR over a text prefix, a trip
// counts per (tripDate, typeCode) over an integer column — so the query is an
// ordinary numeric `orderBy` instead of a lexicographic prefix scan.
//
// 🔴 NOT ATOMIC, AND THAT IS THE SAME ACCEPTED TRADE lib/ci/number.ts records.
// Two planners building a trip in the same second read the same maximum and
// collide. The difference here is that this module RETRIES ONCE (see
// allocateTripNumber), because a trip is built from a drawer the planner is
// standing in front of, and handing him "please try again" for a race he cannot
// see is worse than one extra round trip. Do NOT "fix" this with
// prisma.$transaction — it is banned (CORE §3: Vercel serverless + the Supabase
// pooler time out on it).
//
// 🔴 TWO UNIQUE CONSTRAINTS BACK THIS, AND THEY FAIL DIFFERENTLY:
//   trips_tripNumber_key      UNIQUE ("tripNumber")
//   trips_date_type_seq_key   UNIQUE ("tripDate","typeCode","seq")
// The first catches the race on the rendered text; the second catches a
// duplicate seq that a mis-formatted number would have let through. A caller
// must treat a P2002 on EITHER as the same retryable collision — which is why
// isTripNumberCollision() below names both and nothing hardcodes one.
//
// 🔴 AND A THIRD GUARD IN THE DATABASE: chk_trips_number_shape proves
//   "tripNumber" = "typeCode" || '-' || to_char("tripDate",'YYMMDD')
//                  || '-' || lpad(seq::text, 2, '0')
// so a number this module formats differently from the columns beside it is
// REJECTED at insert time rather than stored. formatTripNumber() below is the
// TypeScript half of that same rule; if you change one you must ALTER the other
// in the Supabase SQL Editor first (CORE §3).

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
 * ⚠ 'C' FOR CROSS IS PERMITTED HERE AND REFUSED BY THE DATABASE.
 * chk_trips_type_code admits only ('L','U','I') — Cross was outside the format
 * when the constraint was written (trip-schema draft §E, open owner question).
 * This map carries the letter anyway so the failure is a clean, named database
 * refusal at insert time rather than a confusing throw out of this function.
 * When Cross is settled, ALTER that CHECK; nothing here needs to change.
 */
const TYPE_CODE_BY_DELIVERY_TYPE: Record<string, string> = {
  Local: "L",
  Upcountry: "U",
  IGT: "I",
  Cross: "C",
};

/** Minimum width of the sequence half. */
const SEQ_MIN_WIDTH = 2;

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
 * unique index. The database says the same thing with lpad in
 * chk_trips_number_shape; both halves must agree.
 */
export function formatTripNumber(typeCode: string, tripDate: Date, seq: number): string {
  return `${typeCode}-${formatTripDatePart(tripDate)}-${String(seq).padStart(SEQ_MIN_WIDTH, "0")}`;
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
 */
export function isTripNumberCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  // Prisma reports the constraint in meta.target, as a string or a string[]
  // depending on the connector and the index shape. Normalise to one string and
  // look for either name rather than trusting the container type.
  const target = err.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return (
    asText.includes("trips_tripNumber_key") ||
    asText.includes("trips_date_type_seq_key") ||
    // Some Prisma versions report the FIELD names rather than the index name.
    asText.includes("tripNumber") ||
    (asText.includes("tripDate") && asText.includes("seq"))
  );
}

/**
 * Allocate the next trip number for `(tripDate, typeCode)`.
 *
 * MAX(seq)+1, never COUNT+1: a count collides the moment the sequence has a gap,
 * and a gap is expected the instant a trip row is ever deleted or a race loses.
 *
 * Scoped by the SAME pair the unique constraint is on, so the number it produces
 * and the constraint that protects it are asking the same question.
 *
 * The clock is NOT read here — `tripDate` is supplied. That keeps this testable
 * and lets a backfill allocate against a past day, exactly as lib/ci/number.ts
 * and lib/picking/picker-split.ts do.
 *
 * Sequential await, never prisma.$transaction (CORE §3).
 */
export async function allocateTripNumber(tripDate: Date, typeCode: string): Promise<TripIdentity> {
  const latest = await prisma.trips.findFirst({
    where: { tripDate, typeCode },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });

  // `seq` is a NOT NULL Int in the database, so a hit always yields a number.
  // Number.isFinite is kept anyway, matching lib/ci/number.ts: it costs nothing
  // and a NaN reaching the format would produce "L-260909-NaN", which passes
  // every unique index and poisons the sequence for that day.
  const lastSeq = latest?.seq ?? 0;
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;

  return { tripNumber: formatTripNumber(typeCode, tripDate, seq), typeCode, seq };
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
 * malformed number, say — into a hang on a serverless function with a 30-second
 * statement timeout (CORE §4). If the second attempt collides too, the error
 * surfaces and the drawer says "please try again", which is honest.
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
    // Re-read the maximum — the winner's row is committed by now, so this picks
    // up their seq rather than repeating ours.
    const second = await allocateTripNumber(tripDate, typeCode);
    return await create(second);
  }
}
