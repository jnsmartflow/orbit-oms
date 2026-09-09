/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STANDING EMAIL FIXTURES FOR /po-v2-8f4kd2 — THE WIRE'S ONLY GUARD.
 *
 *   npx tsx scripts/po-v2-email-fixtures.ts
 *
 * 🔴 RUN THIS BEFORE ANY COMMIT THAT TOUCHES THE SEND PATH — which is
 * app/po-v2-8f4kd2/v2-email.ts, lib/place-order/email.ts, the pack helpers in
 * lib/place-order/pack.ts, app/api/order/data/route.ts, or the three catalog
 * fields a cart line snapshots (product / baseColour / subProduct). A change
 * that alters either fixture's bytes is a change to what the depot receives,
 * and the failure mode is silent: the mail still sends, the upstream parser
 * (Parse-MailOrders-v6_5.ps1) just stops recognising the product.
 *
 * WHY IT EXISTS AS A COMMITTED SCRIPT. "115 bytes and 430 bytes,
 * hex-identical" was asserted in roughly twenty commit messages over two days
 * and lived in NO file. A guard that is only ever re-typed from a report is
 * not a guard — the numbers cannot be re-derived, so the next session either
 * trusts them or ignores them. This script is the guard.
 *
 * 🔴 THE 430 COULD NOT BE VERIFIED, AND IT IS GONE. The prose that recorded
 * fixture 2 named its dealer, dispatch, marker and note but NOT its twelve
 * product lines, so the body it measured cannot be rebuilt. Rather than invent
 * twelve lines that happen to sum to 430 — which would be a number dressed as
 * a fact — fixture 2 is DEFINED here, in full, and its baseline is whatever
 * that definition actually renders. See F2_BYTES.
 *
 * WHAT IS LIVE AND WHAT IS FIXED.
 *   LIVE  — every product line. The catalog rows come from the same two tables
 *           and the same mapping /api/order/data serves the page, so a renamed
 *           product, a re-cased baseColour or a dropped pack breaks this
 *           script by NAME rather than silently shortening an email.
 *   FIXED — the dealer, the dispatch, the marker and the note. Those are
 *           fixture INPUT, not catalog. Pinning them is what makes a byte
 *           count mean something; a real dealer's name changing in
 *           mo_customer_keywords would otherwise "fail" the guard for no
 *           reason at all.
 *
 * The body is emitted through the SHIPPED path and nothing is reimplemented:
 * buildV2Email (app/po-v2-8f4kd2/v2-email.ts) calling renderOrderBody,
 * emailLineLabel and emailCase (lib/place-order/email.ts).
 *
 * Read-only. Three SELECTs, sequential awaits, no $transaction — CORE §3.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import { buildV2Email } from "../app/po-v2-8f4kd2/v2-email";
import { buildBoard, formatPack } from "../app/po-v2-8f4kd2/v2-data";
import type { ApiCustomer, ApiPack, ApiProduct, V2CartLine, V2Order }
  from "../app/po-v2-8f4kd2/v2-data";
import { packToMl } from "../lib/place-order/pack";

/* ───────────────────────────────────────────────────────────────────────────
 * 1. THE PAYLOAD — a mirror of app/api/order/data/route.ts.
 *
 * ⚠ MIRRORED, NOT IMPORTED. That route is a Next request handler; calling it
 * outside the framework means standing up the runtime. The mapping below is
 * copied from it (read 2026-09-09) and must be re-checked whenever that file
 * changes — but a drift cannot pass unnoticed here, because every fixture line
 * asserts its row and its pack labels by name before any byte is counted.
 * ─────────────────────────────────────────────────────────────────────────── */

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
  log: ["error"],
});

/** route.ts:21-28 — ascending by millilitres, KG anchored last. */
function sortRawPacks(packs: ApiPack[]): ApiPack[] {
  return [...packs].sort((a, b) => {
    const aKg = (a.unit ?? "").toUpperCase() === "KG";
    const bKg = (b.unit ?? "").toUpperCase() === "KG";
    if (aKg !== bKg) return aKg ? 1 : -1;
    return packToMl(a.packCode, a.unit) - packToMl(b.packCode, b.unit);
  });
}

async function loadProducts(): Promise<ApiProduct[]> {
  const indexRows = await prisma.mo_order_form_index_v2.findMany({
    where:   { isActive: true },
    select: {
      id: true, family: true, section: true, subgroup: true, subProduct: true,
      product: true, uiGroup: true, baseColour: true, displayName: true,
      searchTokens: true, tinterType: true, productType: true, sortOrder: true,
      region: true,
    },
    orderBy: [{ family: "asc" }, { sortOrder: "asc" }],
  });

  const skuRows = await prisma.mo_sku_lookup_v2.findMany({
    where:  { isPrimary: true },
    select: { product: true, baseColour: true, packCode: true, unit: true, material: true },
  });

  // Dual-keyed pack map, deduped on the RENDERED size — route.ts:82-106.
  const packMap = new Map<string, ApiPack[]>();
  const seenComposite = new Set<string>();
  const addToPackMap = (key: string, pack: ApiPack): void => {
    const dedup = `${key}|||${formatPack(pack.packCode, pack.unit)}`;
    if (seenComposite.has(dedup)) return;
    seenComposite.add(dedup);
    const bucket = packMap.get(key);
    if (bucket) bucket.push(pack);
    else packMap.set(key, [pack]);
  };
  for (const r of skuRows) {
    if (!r.product || !r.packCode) continue;
    const pack: ApiPack = { packCode: String(r.packCode), unit: r.unit ?? null, material: r.material };
    addToPackMap(r.product, pack);
    if (r.baseColour) addToPackMap(`${r.product}|||${r.baseColour}`, pack);
  }

  return indexRows.map((row) => {
    const joinName = row.product ?? row.subProduct;
    const packKey = row.baseColour ? `${joinName}|||${row.baseColour}` : joinName;
    return {
      id: row.id, family: row.family, section: row.section, subgroup: row.subgroup,
      subProduct: row.subProduct, product: row.product ?? null,
      uiGroup: row.uiGroup ?? null, baseColour: row.baseColour ?? null,
      displayName: row.displayName, searchTokens: row.searchTokens,
      tinterType: row.tinterType ?? null, productType: row.productType ?? "PLAIN",
      sortOrder: row.sortOrder, region: row.region ?? null,
      packs: sortRawPacks(packMap.get(packKey) ?? []),
    };
  });
}

/* ───────────────────────────────────────────────────────────────────────────
 * 2. A FIXTURE LINE — named by catalog key, resolved against the live payload.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * `sap` is COALESCE(product, subProduct) — v2-data.ts's joinKey (:683),
 * one line, mirrored rather than imported because it is not exported.
 *
 * `option` is the baseColour EXACTLY as the catalog stores it, and the match
 * is raw equality. That is deliberate and it is the same rule pinned members
 * live under: the live rows carry "White" (id 21910) and "PINK" (id 21911),
 * so folding case here would hide the day two rows differ only by case.
 */
type Spec = {
  sap:    string;
  option: string | null;
  /** Rendered pack label -> units. Every label is asserted to exist. */
  qtys:   Record<string, number>;
};

const failures: string[] = [];

function buildLine(products: ApiProduct[], spec: Spec, i: number): V2CartLine | null {
  const row = products.find(
    (r) => (r.product ?? r.subProduct) === spec.sap && r.baseColour === spec.option,
  );
  if (!row) {
    failures.push(`row not found: sap=${spec.sap} option=${JSON.stringify(spec.option)}`);
    return null;
  }
  const labels = row.packs.map((p) => formatPack(p.packCode, p.unit));
  for (const label of Object.keys(spec.qtys)) {
    if (!labels.includes(label)) {
      failures.push(
        `pack "${label}" is gone from ${spec.sap} ${JSON.stringify(spec.option)} ` +
        `(row ${row.id} now has [${labels.join(", ")}])`,
      );
    }
  }
  // Built exactly as po-v2-page.tsx's addLines does (:626-644): the three wire
  // fields come off the ROW, packOrder off the row's own pack array, and
  // `label` is deliberately nonsense — it must never reach the email.
  return {
    id: `fixture-${i}`,
    tileSap: spec.sap,
    label: "LABEL THAT MUST NOT REACH THE WIRE",
    option: spec.option,
    rowId: row.id,
    product: row.product,
    baseColour: row.baseColour,
    subProduct: row.subProduct,
    qtys: spec.qtys,
    packOrder: labels,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * 3. THE TWO FIXTURES.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 A SYNTHETIC DEALER, ON BOTH FIXTURES, AND THAT IS THE POINT.
 *
 * A real dealer would tie a byte count to mo_customer_keywords, where a name
 * or a code can be edited by anyone at any time — and the guard would then
 * fail on a day nothing in the send path had moved. The dealer is fixture
 * INPUT. It is 24 characters rendered ("Shreeji Paints (SU10024)") and
 * changing it changes both baselines.
 */
const DEALER: ApiCustomer = { name: "Shreeji Paints", code: "SU10024", area: "Katargam" };

const ORDER_PLAIN: V2Order = {
  dispatch: "Normal", callTarget: "SO", marker: null, crossDepot: "", notes: "",
};

/**
 * FIXTURE 1 — three lines, no dispatch, no remark, no note. 115 bytes.
 *
 * 🔴 THE 115 IS INHERITED AND IT WAS PARTLY RECONSTRUCTED. The prose recorded
 * three facts about this body: its length (115), its opening hex (42696c6c,
 * "Bill") and its closing hex (314c2a36, "1L*6"), plus the three products and
 * their packs. All five are reproduced below and all five are asserted. What
 * was NOT recorded is the dealer, so DEALER above was chosen to make the
 * header 24 characters and land the total on 115. Every other byte is derived
 * from the live catalog. Stated here rather than left to be discovered.
 */
const F1: Spec[] = [
  { sap: "GLOSS",       option: "BLACK",   qtys: { "1L": 6, "4L": 4 } },
  { sap: "GLOSS",       option: "90 BASE", qtys: { "20L": 2 } },
  { sap: "SUPER SATIN", option: "BROWN",   qtys: { "1L": 6 } },
];

const F1_BYTES = 115;
const F1_HEX_HEAD = "42696c6c";   // "Bill"
const F1_HEX_TAIL = "314c2a36";   // "1L*6"

/**
 * FIXTURE 2 — twelve lines, Urgent + Truck + a note.
 *
 * ITS JOB IS THE FIGURE SPACE. Past nine items renderOrderBody right-aligns
 * the serial with U+2007 (e2 80 87), not an ordinary space. That single
 * character is the one thing in this format a well-meaning cleanup would
 * "normalise", and the parser would stop matching. Twelve lines is the
 * smallest order that forces it.
 *
 * The twelve are not arbitrary — each one guards a branch that has already
 * cost something:
 *   WOOD PRIMER White / PINK   the pinned twins. Two members, ONE sap,
 *                             different rows. Raw case-sensitive equality:
 *                             the catalog really does store "White" and
 *                             "PINK". They must print as two distinct lines.
 *   PROMISE PRIMER            emailLineLabel's named special case — the
 *                             product/base overlap that would print
 *                             "Promise Primer 2in1 Primer".
 *   GVA                       a KEEP_CAPS_3 token. emailCase must NOT
 *                             title-case it to "Gva".
 *   CEMENT PRIMER SB          a NULL baseColour — name alone, no colour.
 *   MULTI PURPOSE THINNER     the other null, and the category tile's leader.
 *   ACOTONE "NO1"             an option that is a code, not a colour.
 *   GLOSS "90 BASE"           a numbered base, which the board displays as
 *                             "90" and must still SEND as "90 BASE".
 *
 * ⚠ TWO OUTPUTS BELOW LOOK LIKE TYPOS AND ARE NOT. emailCase upper-cases any
 * token carrying a digit, so "2in1 Primer" prints "2IN1 Primer"; and it
 * upper-cases any token of two letters or fewer, so "VT" and "WS" stay caps.
 * Both are /po's shipped behaviour and the parser is trained on them. Do not
 * "correct" either without changing lib/place-order/email.ts, which sends the
 * desktop order too.
 */
const F2: Spec[] = [
  { sap: "GLOSS",                 option: "BLACK",           qtys: { "1L": 6, "4L": 4 } },
  { sap: "GLOSS",                 option: "90 BASE",         qtys: { "20L": 2 } },
  { sap: "SUPER SATIN",           option: "BROWN",           qtys: { "1L": 6 } },
  { sap: "WOOD PRIMER",           option: "White",           qtys: { "1L": 6 } },
  { sap: "WOOD PRIMER",           option: "PINK",            qtys: { "1L": 6 } },
  { sap: "PROMISE PRIMER",        option: "2in1 Primer",     qtys: { "4L": 4 } },
  { sap: "VT PEARL GLO",          option: "BRILLIANT WHITE", qtys: { "20L": 1 } },
  { sap: "WS PROTECT DUSTPROOF",  option: "90 BASE",         qtys: { "10L": 1, "20L": 2 } },
  { sap: "GVA",                   option: "RED OXIDE",       qtys: { "1L": 12 } },
  { sap: "CEMENT PRIMER SB",      option: null,              qtys: { "20L": 1 } },
  { sap: "MULTI PURPOSE THINNER", option: null,              qtys: { "1L": 6, "20L": 1 } },
  { sap: "ACOTONE",               option: "NO1",             qtys: { "1L": 3 } },
];

const ORDER_LOADED: V2Order = {
  dispatch: "Urgent", callTarget: "SO", marker: "Truck",
  crossDepot: "", notes: "Send with the 4 pm truck",
};

/**
 * 🔴 THE NEW BASELINE, MEASURED 2026-09-09 — IT REPLACES THE UNVERIFIABLE 430.
 *
 * 430 came from a fixture whose twelve lines were never written down. This
 * number is what the definition above actually renders against the live
 * catalog, printed by this script on the day it was committed. It is a
 * baseline, not a target: if it moves, something in the send path or in the
 * catalog moved, and the diff below the assertion says which.
 */
const F2_BYTES = 499;
const FIGURE_SPACE = Buffer.from([0xe2, 0x80, 0x87]);   // U+2007

/* ───────────────────────────────────────────────────────────────────────────
 * 4. RUN.
 * ─────────────────────────────────────────────────────────────────────────── */

function render(tag: string, body: string): Buffer {
  const buf = Buffer.from(body, "utf8");
  console.log(`\n══ ${tag} ${"═".repeat(Math.max(0, 60 - tag.length))}`);
  console.log(body);
  console.log(`── bytes : ${buf.length}`);
  console.log(`── hex   : ${buf.toString("hex")}`);
  console.log(`── U+2007: ${buf.includes(FIGURE_SPACE) ? "present" : "absent"}`);
  return buf;
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${what}`);
  if (!ok) failures.push(what);
}

async function main(): Promise<void> {
  const products = await loadProducts();
  console.log(`live catalog: ${products.length} rows from mo_order_form_index_v2`);

  // Not needed to render an email — run for its own sake. buildBoard throws on
  // a mis-authored BOARD (the invariants list) and on a categorised member
  // that still has something to choose, so a board edit that would reach a
  // phone broken stops here instead.
  const { byKey } = buildBoard(products);
  let members = 0;
  for (const tile of Array.from(byKey.values())) members += tile.members.length;
  console.log(`board builds: ${byKey.size} tiles · ${members} members\n`);

  const f1Lines = F1.map((s, i) => buildLine(products, s, i)).filter((l): l is V2CartLine => l !== null);
  const f2Lines = F2.map((s, i) => buildLine(products, s, i)).filter((l): l is V2CartLine => l !== null);

  const f1 = buildV2Email({ dealer: DEALER, shipTo: null, lines: f1Lines, order: ORDER_PLAIN });
  const f2 = buildV2Email({ dealer: DEALER, shipTo: null, lines: f2Lines, order: ORDER_LOADED });

  const b1 = render("FIXTURE 1 · three lines, plain", f1.body);
  const b2 = render("FIXTURE 2 · twelve lines, Urgent + Truck + note", f2.body);

  console.log("\n══ ASSERTIONS ═══════════════════════════════════════════════");
  check(f1Lines.length === F1.length, `fixture 1 resolved all ${F1.length} lines`);
  check(b1.length === F1_BYTES, `fixture 1 is ${F1_BYTES} bytes (got ${b1.length})`);
  check(b1.toString("hex").startsWith(F1_HEX_HEAD), `fixture 1 hex opens ${F1_HEX_HEAD}`);
  check(b1.toString("hex").endsWith(F1_HEX_TAIL), `fixture 1 hex closes ${F1_HEX_TAIL}`);
  check(f2Lines.length === F2.length, `fixture 2 resolved all ${F2.length} lines`);
  check(b2.length === F2_BYTES, `fixture 2 is ${F2_BYTES} bytes (got ${b2.length})`);
  check(b2.includes(FIGURE_SPACE), "fixture 2 carries U+2007 (e2 80 87)");
  check(!f1.body.includes("LABEL"), "fixture 1 carries no cart label");
  check(!f2.body.includes("LABEL"), "fixture 2 carries no cart label");

  await prisma.$disconnect();

  if (failures.length > 0) {
    console.log(`\n🔴 ${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`   - ${f}`);
    console.log("\nA byte count that moved is a change to what the depot receives.");
    process.exitCode = 1;
    return;
  }
  console.log("\nBoth fixtures hold. The wire has not moved.");
}

void main();
