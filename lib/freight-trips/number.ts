// lib/freight-trips/number.ts — allocate a freight trip number, insert, retry once.
//
// Rule (owner, 2026-10-02): seq = MAX(seq) + 1 over EVERY freight trip of that
// date, CANCELLED INCLUDED — a number is never handed out twice, so a sheet that
// says F-261002-03 always means one trip. Backed by two FULL uniques:
//   freight_trips_tripNumber_key   UNIQUE ("tripNumber")
//   freight_trips_tripDate_seq_key UNIQUE ("tripDate", seq)
// NOT ATOMIC — two people creating in the same second read the same MAX. The
// uniques are the backstop: the insert collides with P2002, we re-read and retry
// ONCE. Never a loop, never prisma.$transaction (CORE §3).
//
// Server-only (Prisma). The format itself lives in ./format.ts (client-safe).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatFreightTripNumber } from "./format";

export interface FreightTripIdentity {
  tripNumber: string;
  seq: number;
}

/** MAX(seq)+1 for the date, over all rows (cancelled included). */
export async function allocateFreightTripNumber(tripDate: Date): Promise<FreightTripIdentity> {
  const top = await prisma.freight_trips.findFirst({
    where: { tripDate },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const seq = (top?.seq ?? 0) + 1;
  return { tripNumber: formatFreightTripNumber(tripDate, seq), seq };
}

/**
 * Is this the number race? A P2002 on either unique. Prisma reports the FIELD
 * names in meta.target (measured on Prisma 5.22, lib/trips/number.ts header), the
 * index names are matched too in case a future version reports those.
 */
export function isFreightNumberCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return (
    text.includes("freight_trips_tripNumber_key") ||
    text.includes("freight_trips_tripDate_seq_key") ||
    text.includes("tripNumber") ||
    (text.includes("tripDate") && text.includes("seq"))
  );
}

/** Allocate, run `create`, and on the race re-allocate and retry ONCE. */
export async function createWithFreightNumber<T>(
  tripDate: Date,
  create: (identity: FreightTripIdentity) => Promise<T>,
): Promise<T> {
  const first = await allocateFreightTripNumber(tripDate);
  try {
    return await create(first);
  } catch (err) {
    if (!isFreightNumberCollision(err)) throw err;
    const second = await allocateFreightTripNumber(tripDate);
    return await create(second);
  }
}
