// lib/freight-trips/format.test.ts — npx tsx --test lib/freight-trips/format.test.ts
//
// The freight trip number must match chk_freight_trips_number_shape:
//   'F-' || YYMMDD || '-' || lpad(seq, greatest(2, length(seq)), '0')
// — padded to two, never truncated. Pure; no database.

import test from "node:test";
import assert from "node:assert/strict";
import { formatFreightTripNumber, parseFreightDate } from "./format";

const D = parseFreightDate("2026-10-02");

test("pads to two digits", () => {
  assert.equal(formatFreightTripNumber(D, 1), "F-261002-01");
  assert.equal(formatFreightTripNumber(D, 9), "F-261002-09");
  assert.equal(formatFreightTripNumber(D, 42), "F-261002-42");
});

test("never truncates at 100 and beyond", () => {
  assert.equal(formatFreightTripNumber(D, 100), "F-261002-100");
  assert.equal(formatFreightTripNumber(D, 137), "F-261002-137");
});

test("reads the @db.Date with UTC getters (no IST shift)", () => {
  assert.equal(formatFreightTripNumber(parseFreightDate("2026-01-01"), 3), "F-260101-03");
  assert.equal(formatFreightTripNumber(parseFreightDate("2026-12-31"), 3), "F-261231-03");
});

test("parseFreightDate refuses bad input", () => {
  assert.throws(() => parseFreightDate("2026-13-01"));
  assert.throws(() => parseFreightDate("2026-02-30"));
  assert.throws(() => parseFreightDate("02-10-2026"));
});
