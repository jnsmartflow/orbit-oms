// lib/access/notebook.test.ts — Node's built-in runner through tsx (no new
// dependency):  npx tsx --test lib/access/notebook.test.ts   (npm run test:access-notebook)
//
// Covers plan §I.1 (docs/prompts/drafts/code-plan-2026-09-29-auth-access-notebook.md)
// against the PURE modules only — lib/access/notebook.ts and
// lib/access/access-state.ts — so no database and no NextAuth are needed.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createNotebook,
  readRefreshClaims,
  MAX_AGE_MS,
  MAX_ENTRIES,
  UNKNOWN_VERSION_TTL_MS,
  type GlobalSettings,
  type RolePermRow,
  type UserBundle,
} from "./notebook";
import { parseAccessState } from "./access-state";

const ON = { canView: true, canImport: false, canExport: false, canEdit: true, canDelete: false };

function bundle(isActive = true, pages: [string, typeof ON][] = [["floor", ON]]): UserBundle {
  return {
    flags: {
      isActive,
      isSuperuser: false,
      attendanceTestUser: true,
      attendanceExempt: false,
      attendanceConsentVersion: "v1.0",
    },
    pages: new Map(pages),
  };
}

/** A notebook with a controllable clock, version and counting fetchers. */
function harness(opts: { fetchUser?: (id: number) => Promise<UserBundle> } = {}) {
  const h = {
    now: 1_000_000,
    version: "1" as string | null,
    userFetches: 0,
    settingsFetches: 0,
    roleFetches: 0,
    nextBundle: bundle(),
  };
  const nb = createNotebook({
    now: () => h.now,
    getVersion: async () => ({ version: h.version }),
    fetchUser: opts.fetchUser ?? (async () => {
      h.userFetches++;
      return h.nextBundle;
    }),
    fetchSettings: async (): Promise<GlobalSettings> => {
      h.settingsFetches++;
      return { rolloutStage: "ALL_USERS" };
    },
    fetchRoleRows: async (slugs: string[]): Promise<RolePermRow[]> => {
      h.roleFetches++;
      return slugs.map((s) => ({ roleSlug: s, pageKey: "floor", ...ON }));
    },
  });
  return { h, nb };
}

// 1
test("same version and age < 12 h → served from memory, no fetch", async () => {
  const { h, nb } = harness();
  await nb.getUserBundle(7);
  h.now += MAX_AGE_MS - 1;
  await nb.getUserBundle(7);
  assert.equal(h.userFetches, 1);
});

// 2
test("a version change drops every entry and the next call fetches", async () => {
  const { h, nb } = harness();
  await nb.getUserBundle(7);
  await nb.getGlobalSettings();
  await nb.getRoleRows(["billing_operator"]);
  h.version = "2";
  await nb.getUserBundle(7);
  assert.equal(h.userFetches, 2);
  assert.deepEqual(nb.size(), { users: 1, roleSets: 0, settings: false });
});

// 2b — comparison is !==, so a version going BACKWARDS (hand reset) also drops.
test("a version going backwards still drops the notebook", async () => {
  const { h, nb } = harness();
  h.version = "9";
  await nb.getUserBundle(7);
  h.version = "3";
  await nb.getUserBundle(7);
  assert.equal(h.userFetches, 2);
});

// 3
test("age ≥ 12 h → refetch even with the same version", async () => {
  const { h, nb } = harness();
  await nb.getUserBundle(7);
  h.now += MAX_AGE_MS;
  await nb.getUserBundle(7);
  assert.equal(h.userFetches, 2);
});

// 4
test("unknown version (missing row / failed read) → trusted < 30 s only", async () => {
  const { h, nb } = harness();
  h.version = null;
  await nb.getUserBundle(7);
  h.now += UNKNOWN_VERSION_TTL_MS - 1;
  await nb.getUserBundle(7);
  assert.equal(h.userFetches, 1, "still inside 30 s");
  h.now += 1;
  await nb.getUserBundle(7);
  assert.equal(h.userFetches, 2, "30 s passed → re-read");
});

// 4b — an entry written while the version was unknown is not trusted once a version is known.
test("an entry tagged 'unknown' is not valid once a version is known", async () => {
  const { h, nb } = harness();
  h.version = null;
  await nb.getUserBundle(7);
  h.version = "5";
  await nb.getUserBundle(7);
  assert.equal(h.userFetches, 2);
});

// 5
test("the tag is the version known BEFORE the read (a bump during the read → re-read next time)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let fetches = 0;
  const { h, nb } = harness({
    fetchUser: async () => {
      fetches++;
      await gate; // the admin's save + bump land while this read is in flight
      return bundle();
    },
  });
  const inFlight = nb.getUserBundle(7);
  h.version = "2"; // bumped mid-read
  release();
  await inFlight;
  await nb.getUserBundle(7);
  assert.equal(fetches, 2, "the entry carried tag 1, so version 2 forced a fresh read");
});

// 6
test("concurrent calls share one fetch", async () => {
  const { h, nb } = harness();
  await Promise.all([nb.getUserBundle(7), nb.getUserBundle(7), nb.getUserBundle(7)]);
  assert.equal(h.userFetches, 1);
});

test("a thrown fetch caches nothing and the error reaches the caller", async () => {
  let calls = 0;
  const { nb } = harness({
    fetchUser: async () => {
      calls++;
      if (calls === 1) throw new Error("pool timeout");
      return bundle();
    },
  });
  await assert.rejects(nb.getUserBundle(7), /pool timeout/);
  assert.equal(nb.size().users, 0);
  await nb.getUserBundle(7);
  assert.equal(calls, 2);
});

// 7
test("absent page key stays absent (the resolver maps it to all-false); stored keys only", async () => {
  const { nb } = harness();
  const b = await nb.getUserBundle(7);
  assert.equal(b.pages.get("billing_print"), undefined);
  assert.deepEqual(Array.from(b.pages.keys()), ["floor"]);
});

// 8
test("role rows are cached per SORTED slug set; a version change drops them", async () => {
  const { h, nb } = harness();
  await nb.getRoleRows(["picker", "floor_supervisor"]);
  await nb.getRoleRows(["floor_supervisor", "picker"]);
  assert.equal(h.roleFetches, 1, "same set, different order → one entry");
  await nb.getRoleRows(["picker"]);
  assert.equal(h.roleFetches, 2, "a different set is its own entry");
  h.version = "2";
  await nb.getRoleRows(["picker", "floor_supervisor"]);
  assert.equal(h.roleFetches, 3);
});

test("global settings are one entry for every user", async () => {
  const { h, nb } = harness();
  await nb.getGlobalSettings();
  await nb.getGlobalSettings();
  assert.equal(h.settingsFetches, 1);
});

// 9 — the kill switch and the source rules (pure parser used by lib/access/source.ts)
test("ACCESS_CACHE: only the exact 'on' turns the notebook on", () => {
  const read = (v: string | null | undefined) =>
    parseAccessState(new Map(v === undefined ? [] : [["ACCESS_CACHE", v]]), null).cacheOn;
  assert.equal(read("on"), true);
  assert.equal(read(" ON "), true, "trimmed and lower-cased, like ACCESS_SOURCE");
  assert.equal(read("off"), false);
  assert.equal(read(undefined), false, "missing row → off");
  assert.equal(read(null), false);
  assert.equal(read("true"), false);
  assert.equal(read("1"), false);
  assert.equal(read("onn"), false);
});

test("a failed read keeps this instance's last known switch, else off; source → role; version unknown", () => {
  assert.deepEqual(parseAccessState(null, true), { source: "role", version: null, cacheOn: true, ok: false });
  assert.deepEqual(parseAccessState(null, false), { source: "role", version: null, cacheOn: false, ok: false });
  assert.deepEqual(parseAccessState(null, null), { source: "role", version: null, cacheOn: false, ok: false });
});

test("ACCESS_SOURCE semantics unchanged: only the exact 'user' enables user mode", () => {
  const src = (v: string | undefined) =>
    parseAccessState(new Map(v === undefined ? [] : [["ACCESS_SOURCE", v]]), null).source;
  assert.equal(src("user"), "user");
  assert.equal(src(" User "), "user");
  assert.equal(src("role"), "role");
  assert.equal(src(undefined), "role");
  assert.equal(src("users"), "role");
});

test("ACCESS_VERSION: trimmed value, or null when missing / blank", () => {
  const ver = (v: string | undefined) =>
    parseAccessState(new Map(v === undefined ? [] : [["ACCESS_VERSION", v]]), null).version;
  assert.equal(ver(" 12 "), "12");
  assert.equal(ver(undefined), null);
  assert.equal(ver("  "), null);
});

// 10 — the jwt refresh decision
test("isActive = false → 'inactive' (the jwt callback returns null)", async () => {
  const { h, nb } = harness();
  h.nextBundle = bundle(false);
  assert.deepEqual(await readRefreshClaims(nb, 7), { kind: "inactive" });
});

test("no users row → 'inactive'", async () => {
  const { h, nb } = harness();
  h.nextBundle = { flags: null, pages: new Map() };
  assert.deepEqual(await readRefreshClaims(nb, 7), { kind: "inactive" });
});

test("a thrown read → 'failed' (the token keeps its own claims) and nothing is cached", async () => {
  const { nb } = harness({ fetchUser: async () => { throw new Error("db down"); } });
  const r = await readRefreshClaims(nb, 7);
  assert.equal(r.kind, "failed");
  assert.equal(nb.size().users, 0);
});

test("an active user → the five claims, straight from the bundle and the global row", async () => {
  const { nb } = harness();
  assert.deepEqual(await readRefreshClaims(nb, 7), {
    kind: "claims",
    claims: {
      rolloutStage: "ALL_USERS",
      attendanceTestUser: true,
      attendanceExempt: false,
      attendanceConsentVersion: "v1.0",
      isSuperuser: false,
    },
  });
});

// 11
test(`the user map is capped at ${MAX_ENTRIES} entries, oldest dropped first`, async () => {
  const { h, nb } = harness();
  for (let id = 1; id <= MAX_ENTRIES + 5; id++) await nb.getUserBundle(id);
  assert.equal(nb.size().users, MAX_ENTRIES);
  const before = h.userFetches;
  await nb.getUserBundle(1); // the oldest was evicted
  assert.equal(h.userFetches, before + 1);
  await nb.getUserBundle(MAX_ENTRIES + 5); // the newest is still there
  assert.equal(h.userFetches, before + 1);
});

// update() path and sign-in: invalidateUser forgets exactly one user on this instance.
test("invalidateUser forces that user's next read and leaves others alone", async () => {
  const { h, nb } = harness();
  await nb.getUserBundle(7);
  await nb.getUserBundle(8);
  nb.invalidateUser(7);
  await nb.getUserBundle(7);
  await nb.getUserBundle(8);
  assert.equal(h.userFetches, 3);
});

// Note only — enforced in SQL, not here: a consent (users."attendanceConsentVersion")
// does NOT bump ACCESS_VERSION (the column is left out of the trigger's UPDATE OF
// list, sql/2026-09-30-access-notebook.sql). The update() branch invalidates only
// that user's entry on the serving instance — the test above.
test("clock stepping backwards → entry not trusted", async () => {
  const { h, nb } = harness();
  await nb.getUserBundle(7);
  h.now -= 1;
  await nb.getUserBundle(7);
  assert.equal(h.userFetches, 2);
});
