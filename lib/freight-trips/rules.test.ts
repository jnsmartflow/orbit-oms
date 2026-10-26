// lib/freight-trips/rules.test.ts — npx tsx --test lib/freight-trips/rules.test.ts
// Pure; no database.

import test from "node:test";
import assert from "node:assert/strict";
import { splitLoadFreightRefusal } from "./rules";

test("a split-load bill is refused by its OBD number", () => {
  assert.equal(splitLoadFreightRefusal("9110345576"), "9110345576 is split across trucks — merge its parts back first");
});
