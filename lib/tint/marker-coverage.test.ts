// lib/tint/marker-coverage.test.ts — npx tsx --test lib/tint/marker-coverage.test.ts (npm run test:tint-sync)
//
// Static audit for the Tint quick win (2026-09-30). The 60 s blind refetch on the Tint Manager is
// gone; the 15 s marker (app/api/tint/manager/marker) is now the ONLY thing that notices a change.
// It moves when MAX(updatedAt) of orders / tint_assignments / order_splits / delivery_challans
// moves. So every app/api/tint/** route that writes a table the board SHOWS must also create or
// update one of those four "stamp" tables — otherwise that write would sit invisible until
// something else changed. Fails naming the route.
//
// Writes are found as `prisma.<t>.<op>(` or `tx.<t>.<op>(` in the route file and in any
// `@/lib/tint/*` module it imports (one level). A `delete` never counts as a stamp: removing a row
// does not raise a MAX.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

/** The tables the marker reads a stamp from. Step 9 (2026-10-01) added the four
 *  tab sources: tint CIs, pick-delete decisions and the placeholder's TI rows
 *  (the TI tables stamp on createdAt — a create is what changes what is owed). */
const STAMP_TABLES = [
  "orders", "tint_assignments", "order_splits", "delivery_challans",
  "ci_returns", "pick_delete_decisions", "tinter_issue_entries", "tinter_issue_entries_b",
];

/**
 * Tables GET /api/tint/manager/orders READS (its finds + includes): a write to one changes what
 * the board shows. Customer / sales-officer masters are not written by tint routes.
 */
const BOARD_TABLES = [
  ...STAMP_TABLES,
  "split_line_items",      // splits.lineItems
  "tint_skip_events",      // skipEvents (latest)
  "tint_pause_events",     // pauseEvents (latest)
  "import_raw_line_items", // split lines' rawLineItem + the lines lookup
  "import_raw_summary",    // the SMU / summary lookup
  "import_obd_query_summary", // querySnapshot
  "manual_tint_entries",
  // The tabs (2026-10-01, tabs build steps 5–8) — Hold / CI / TI / Pick delete
  // read these; a write to one must move a stamp (each is a stamp itself now).
  "ci_returns",
  "pick_delete_decisions",
];

/**
 * Tables the brief lists as board-ish that the Manager board does NOT read (checked below against
 * the orders route source, so this exemption fails the moment the board starts reading them).
 * The TI tables feed the operator's own list and the base-pending panel, not the board reload.
 */
const NOT_ON_BOARD = ["tinter_issue_entries", "tinter_issue_entries_b"];

const WRITE_OPS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const STAMP_OPS = new Set(["create", "createMany", "update", "updateMany", "upsert"]);

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : name === "route.ts" ? [p] : [];
  });
}

type Write = { table: string; op: string; from: string };

function writesIn(src: string, from: string): Write[] {
  const re = new RegExp(`\\b(?:prisma|tx)\\s*\\.\\s*([a-z_]+)\\s*\\.\\s*(${WRITE_OPS.join("|")})\\s*\\(`, "g");
  const out: Write[] = [];
  for (const m of Array.from(src.matchAll(re))) out.push({ table: m[1], op: m[2], from });
  return out;
}

// The lib folders whose writes a tint route can reach (one level deep). Since
// the tabs build (2026-10-01) the Tint Manager's routes write through the SHARED
// Floor / Billing owners — lib/floor/bill-actions.ts, ship-to.ts, raise-ci.ts,
// lib/billing/pick-delete.ts — so the scan follows those imports too; otherwise
// those routes would look write-free and prove nothing.
const LIB_DIRS = ["tint", "floor", "billing"];

function routeWrites(file: string): Write[] {
  const src = stripComments(readFileSync(file, "utf8"));
  const out = writesIn(src, "route");
  for (const dir of LIB_DIRS) {
    const re = new RegExp(`from\\s+"@\\/lib\\/${dir}\\/([\\w\\-/]+)"`, "g");
    for (const m of Array.from(src.matchAll(re))) {
      const lib = path.join(ROOT, "lib", dir, `${m[1]}.ts`);
      if (existsSync(lib)) out.push(...writesIn(stripComments(readFileSync(lib, "utf8")), `lib/${dir}/${m[1]}.ts`));
    }
  }
  return out;
}

const routes = walk(path.join(ROOT, "app", "api", "tint"));

test("the audit found the tint routes", () => {
  assert.ok(routes.length >= 30, `only ${routes.length} route files found`);
});

test("no tint route writes through raw SQL (the audit could not see it)", () => {
  for (const f of routes) {
    const src = stripComments(readFileSync(f, "utf8"));
    assert.equal(/\$executeRaw/.test(src), false, `${path.relative(ROOT, f)} uses $executeRaw`);
  }
});

test("every tint route that writes a board table also moves a marker stamp", () => {
  const failures: string[] = [];
  for (const f of routes) {
    const writes = routeWrites(f);
    const boardWrites = writes.filter((w) => BOARD_TABLES.includes(w.table));
    if (boardWrites.length === 0) continue;
    const stamped = writes.some((w) => STAMP_TABLES.includes(w.table) && STAMP_OPS.has(w.op));
    if (!stamped) {
      failures.push(`${path.relative(ROOT, f)} writes ${boardWrites.map((w) => `${w.table}.${w.op}`).join(", ")} but no stamp table`);
    }
  }
  assert.deepEqual(failures, []);
});

test("the NOT_ON_BOARD exemption still holds: the board reload does not read the TI tables", () => {
  const src = stripComments(readFileSync(path.join(ROOT, "app", "api", "tint", "manager", "orders", "route.ts"), "utf8"));
  for (const t of NOT_ON_BOARD) {
    assert.equal(src.includes(t), false, `the orders route now reads ${t} — move it into BOARD_TABLES`);
  }
  assert.equal(/tinterIssue/i.test(src), false, "the orders route now includes a tinter-issue relation");
});

test("the marker route reads every stamp table", () => {
  const src = stripComments(readFileSync(path.join(ROOT, "app", "api", "tint", "manager", "marker", "route.ts"), "utf8"));
  // max("updatedAt") or max(alias."updatedAt"/"createdAt") FROM <table>.
  for (const t of STAMP_TABLES.filter((x) => x !== "orders")) {
    assert.ok(
      new RegExp(`max\\((?:\\w+\\.)?"(?:updatedAt|createdAt)"\\)\\s+FROM\\s+${t}\\b`).test(src),
      `marker does not read ${t}`,
    );
  }
  assert.ok(/_max:\s*\{\s*updatedAt:\s*true\s*\}/.test(src), "marker does not read MAX(orders.updatedAt)");
});

test("the scanner sees prisma. and tx. writes, and ignores reads and comments", () => {
  const src = stripComments(`
    await prisma.tint_pause_events.create({});
    await tx .order_splits .update({});
    await prisma.orders.findMany({});
    // await prisma.delivery_challans.update({});
  `);
  assert.deepEqual(writesIn(src, "t").map((w) => `${w.table}.${w.op}`), ["tint_pause_events.create", "order_splits.update"]);
});

// Tabs build step 9 (2026-10-01): every Tint Manager WRITE route added in steps
// 2–8 must reach a stamp table — through its own code or the shared lib it calls
// (lib/floor/*, lib/billing/*, lib/tint/*). Named, so a route that stops
// stamping (or that the scanner can no longer follow) fails by name.
test("every tabs-build Tint Manager write route moves a marker stamp", () => {
  const tabsRoutes = [
    "actions", "ship-to", "cancel", "restore", "ci",
    "pick-delete/all-ok", "pick-delete/delete", "pick-delete/undo",
    // Shop delivery (2026-10-01) — writes through lib/floor/ship-to.ts.
    "shop-delivery",
  ];
  const failures: string[] = [];
  for (const r of tabsRoutes) {
    const file = path.join(ROOT, "app", "api", "tint", "manager", ...r.split("/"), "route.ts");
    assert.ok(existsSync(file), `missing route ${r}`);
    const stamps = routeWrites(file).filter((w) => STAMP_TABLES.includes(w.table) && STAMP_OPS.has(w.op));
    if (stamps.length === 0) failures.push(`${r}: no stamp write found (route + lib/tint|floor|billing)`);
  }
  assert.deepEqual(failures, []);
});
