// Hidden v2 order storage — live draft, saved drafts, sent orders.
//
// 🔴 v2 HAS ITS OWN STORAGE, ITS OWN TYPES, ITS OWN KEYS. Every key here is
// `po2_*`. v2 never reads or writes a `po_*` or `orbitoms_*` key, and it does
// NOT import lib/place-order/saved-drafts.ts or sent-orders.ts — those import
// `PoDraft` from app/po/po-page, which would chain this folder to that
// 3,800-line monolith and make v2 undeletable. Their SHAPES and their pruning
// logic were read and reproduced; nothing was imported.
//
// Sharing a key with /po would be worse than duplication: two independent
// order books writing one slot means each silently eats the other's drafts.
//
// 🔴 EVERY READ AND EVERY WRITE IS WRAPPED. Private mode throws on ACCESS, not
// only on write, and a full quota throws on set. A failed save is silent; a
// failed read starts fresh. Losing a draft must never take the page down.

// 🔴 A VALUE IMPORT, AND THE ONLY ONE IN THIS FILE. Both of these are DERIVED
// indexes walked from BOARD at load — see the note on migrateLine below for
// why a hand-written table of stale codes would be wrong.
import { boardTile, tileKeyForMember } from "./v2-data";
import type {
  ApiCustomer, V2CallTarget, V2CartLine, V2Dispatch, V2Marker, V2Order,
} from "./v2-data";

const LIVE_KEY   = "po2_draft";
const DRAFTS_KEY = "po2_saved_drafts";
const SENT_KEY   = "po2_sent_orders";
const FAVS_KEY   = "po2_fav_customers";   // read once, for the seed below
const MINE_KEY   = "po2_my_dealers";       // read once, for the seed below
const STAR_KEY   = "po2_starred_dealers";

const MAX_FAVS     = 12;
const MAX_DRAFTS   = 20;
const LIVE_TTL_MS  = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS        = 24 * 60 * 60 * 1000;

/**
 * One order, minus the dealer's own record.
 *
 * `shipToCode` is a CODE, not a customer object: the dealer list is refetched
 * every load, and a stored copy would go stale the moment an area or a name
 * changes. The code is re-resolved against the live payload on restore.
 *
 * 🔴 `customer` IS NULLABLE, and that is the whole point of a draft. A salesman
 * standing in a shop builds the order first and often does not know yet whose
 * account it goes on — a draft that refused to save without a dealer would make
 * him answer a question he came here to defer. The dealer is asked for on
 * review, on the way out.
 *
 * A SENT order always has one, because Send will not fire without it.
 */
export type V2Snapshot = {
  customer:   ApiCustomer | null;
  lines:      V2CartLine[];
  shipToCode: string | null;
  dispatch:   V2Dispatch;
  callTarget: V2CallTarget;
  marker:     V2Marker;
  crossDepot: string;
  notes:      string;
};

export type V2SavedDraft = { id: string; label: string; savedAt: number; snapshot: V2Snapshot };
export type V2SentOrder  = { id: string; label: string; sentAt: number;  snapshot: V2Snapshot };

type LiveDraft   = V2Snapshot & { version: 1; updatedAt: number };
type DraftStore  = { version: 1; drafts: V2SavedDraft[] };
type SentStore   = { version: 1; orders: V2SentOrder[] };

// ── Raw access, wrapped ────────────────────────────────────────────────────

function readRaw(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode. Best-effort by design.
  }
}

function removeRaw(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * A stored snapshot is usable if it still has LINES. The dealer is optional.
 *
 * 🔴 THIS USED TO DEMAND `customer.code`, which would have silently discarded
 * every dealer-less draft on read — saved fine, gone on reopen, nothing logged.
 * Old snapshots all carry a customer object and still pass unchanged.
 */
function validSnapshot(v: Partial<V2Snapshot> | null | undefined): v is V2Snapshot {
  if (!v || !Array.isArray(v.lines)) return false;
  return v.customer === null || v.customer === undefined || typeof v.customer.code === "string";
}

// ── Migrating a stored line onto the current board ────────────────────────
//
// 🔴 WHAT tileSap MEANS CHANGED, AND STORAGE STILL HOLDS THE OLD MEANING.
//
// Until 1129427d a tile was one product, and a cart line's `tileSap` was that
// product's own join key. A tile can now hold several products, so `tileSap`
// is the TILE's key and `label` is the MEMBER's name. Every line written
// before that commit carries the old pair.
//
// An unmigrated line is not merely cosmetic. It still renders and it still
// emits byte-identical email — the three fields the wire reads (product,
// baseColour, subProduct) are untouched by any of this. But po-v2-page's
// addLines replaces by `tileSap`, so a line filed under a code the board no
// longer recognises is KEPT while the edit writes a second one beside it: two
// lines, same product, both sent, and nothing on screen says so.
//
// 🔴 AND THE MIRROR IMAGE OF THAT, ADDED 2026-09-07: a line parked under a key
// that IS still live but whose product has since LEFT that tile. The first
// version of this migration left it alone — its rule was "a sap on no tile
// keeps its stored key" — and the next edit of that tile deleted it. Three
// cases now, not two. See migrateLine.
//
// ⚠ ON READ, NEVER ON WRITE. localStorage can hold data written by an older
// build at any moment — a phone that has not reloaded, a tab left open since
// yesterday, a draft restored after a rollback. Migrating on write would fix
// only what this build happens to touch.
//
// NO VERSION BUMP. The stored SHAPE is unchanged; one field's value is
// corrected. `version: 1` still describes the data honestly, and bumping it
// would make every older build treat these records as unreadable.

/**
 * One line, moved onto the current board. Returns the SAME OBJECT when there
 * is nothing to do, so idempotence is visible rather than asserted.
 *
 * 🔴 THE MEMBER IS IDENTIFIED FROM THE ROW, NOT FROM tileSap. `product ??
 * subProduct` is the catalog join key — exactly what addLines snapshotted off
 * the menu row — and it means the same thing on an old line and a new one. On
 * an old line `tileSap` happens to hold it too; on a new line `tileSap` is
 * the tile, which may be a different product entirely. Reading the row makes
 * the function correct in both directions and idempotent by construction.
 *
 * 🔴 tileKeyForMember() IS DERIVED, WALKED FROM BOARD. It is deliberately NOT
 * a table of the three codes this happens to move today. A tile's key is its
 * TOP MEMBER's code, so the key changes the day sales reorder a merged tile's
 * members — and a new set of stored codes goes stale with it. A derived lookup
 * absorbs that forever, because whatever the key used to be it is still a
 * member. A list of three would be right for exactly one ranking, and the bug
 * would come back silently on the next one.
 *
 * 🔴 THREE CASES, NOT TWO. "On no tile, so leave it alone" was right for a
 * product whose stored key is DEAD and wrong for one whose stored key is still
 * ALIVE but belongs to a tile the product is not in — see case 3.
 */
function migrateLine(line: V2CartLine): V2CartLine {
  const sap = line.product ?? line.subProduct;
  const key = tileKeyForMember(sap);

  // ── 1. The product IS a member of some tile ─────────────────────────────
  if (key !== null) {
    const label = boardTile(key)?.members.find((m) => m.sap === sap)?.label ?? line.label;
    if (line.tileSap === key && line.label === label) return line;
    // Spread, so product / baseColour / subProduct / qtys / packOrder / rowId /
    // option / id pass through byte for byte. Only the two board-facing fields
    // are rewritten, and neither reaches the email.
    return { ...line, tileSap: key, label };
  }

  // ── 2. On no tile, and its stored key is dead too ───────────────────────
  //
  // Leave it exactly as it is. It renders, it sends, it does not badge, and
  // nothing can delete it because no tile replaces by a key that no longer
  // exists. That is the correct end state for a product that left the board.
  if (boardTile(line.tileSap) === null) return line;

  // ── 3. 🔴 ON NO TILE, BUT PARKED UNDER A KEY THAT IS STILL ALIVE ────────
  //
  // This is the one that ate an order. VT Diamond Glo and VAF were members of
  // the VT Specialty tile until 2026-09-07; a line saved then carries
  // tileSap "VELVETINO", and VELVETINO is still that tile's key. Case 2 read
  // it as "already correct" and left it — and then po-v2-page's addLines,
  // which replaces every line whose tileSap matches the tile being edited,
  // DELETED it the next time anybody touched VT Specialty. The drawer could
  // not save it either: it seeds a member the tile no longer has, rowFor()
  // returns null for it, and the pick is filtered out before Add.
  //
  // 🔴 THE FIX IS TO FILE IT UNDER ITS OWN PRODUCT KEY, which is exactly where
  // a line added by SEARCHING for that product is filed (po-v2-page's group
  // path writes tileSap = the resolved product's sap). So the line stops being
  // a stranger on somebody else's tile and becomes an ordinary search-only
  // line — the thing it now is.
  //
  // Every reader of tileSap lands right by construction:
  //   addLines      no tile has this key, so the replace filter never sees it
  //   existingFor   never seeded into a drawer that would drop it
  //   countsByTile  no badge, which is correct — it is not on the board
  //   tileArtFor    the neutral fill, as any off-board product already gets
  //
  // AND IT IS IDEMPOTENT BY CONSTRUCTION. A tile's key IS its top member's
  // sap, so if `sap` were itself a live tile key the product would be a member
  // of that tile and we would have returned at case 1. It therefore cannot be
  // one here, which means the second pass takes case 2 and changes nothing.
  //
  // DERIVED, NOT A LIST. Nothing here names a product. The next membership
  // change makes new orphans and this already handles them — proved by
  // removing an arbitrary member from a scratch copy of the board and running
  // this same code against it.
  return { ...line, tileSap: sap };
}

/** The same, for a whole order. Identity-stable when nothing moved. */
function migrateLines(lines: V2CartLine[]): V2CartLine[] {
  let moved = false;
  const next = lines.map((line) => {
    const after = migrateLine(line);
    if (after !== line) moved = true;
    return after;
  });
  return moved ? next : lines;
}

function migrateSnapshot(snap: V2Snapshot): V2Snapshot {
  const lines = migrateLines(snap.lines);
  return lines === snap.lines ? snap : { ...snap, lines };
}

export function snapshotOf(
  customer: ApiCustomer | null, lines: V2CartLine[], shipTo: ApiCustomer | null, order: V2Order,
): V2Snapshot {
  return {
    customer, lines,
    shipToCode: shipTo && shipTo.code !== customer?.code ? shipTo.code : null,
    dispatch: order.dispatch, callTarget: order.callTarget,
    marker: order.marker, crossDepot: order.crossDepot, notes: order.notes,
  };
}

/**
 * Generated, never typed — "AMBIKA PAINTS · 3 lines".
 *
 * A dealer-less draft is labelled by its contents instead, so the row still
 * says something useful: "No dealer yet · 3 lines".
 */
export function labelFor(snapshot: V2Snapshot): string {
  const n = snapshot.lines.length;
  const who = snapshot.customer?.name ?? "No dealer yet";
  return `${who} · ${n} ${n === 1 ? "line" : "lines"}`;
}

// ── 1. The live draft — one object, overwritten as the order changes ───────

export function saveLiveDraft(snapshot: V2Snapshot): void {
  const entry: LiveDraft = { ...snapshot, version: 1, updatedAt: Date.now() };
  writeRaw(LIVE_KEY, entry);
}

/**
 * Restores the in-progress order, or null.
 *
 * A draft older than 24 h is DISCARDED AND THE KEY CLEARED, not just ignored —
 * leaving it would resurrect a stale order the next time the clock happened to
 * suit, which is a worse failure than losing it.
 */
export function loadLiveDraft(): V2Snapshot | null {
  const parsed = readRaw(LIVE_KEY) as Partial<LiveDraft> | null;
  if (!parsed || typeof parsed.updatedAt !== "number") return null;
  // Read the stamp out BEFORE the type guard — validSnapshot() narrows `parsed`
  // to V2Snapshot, which has no updatedAt of its own.
  const updatedAt = parsed.updatedAt;
  if (!validSnapshot(parsed)) return null;
  if (Date.now() - updatedAt > LIVE_TTL_MS) {
    removeRaw(LIVE_KEY);
    return null;
  }
  // Migrated on the way out — see migrateLine. The live draft is the one a
  // salesman is standing in the middle of, so it matters most.
  return migrateSnapshot({
    customer: parsed.customer ?? null, lines: parsed.lines,
    shipToCode: typeof parsed.shipToCode === "string" ? parsed.shipToCode : null,
    dispatch:   parsed.dispatch   ?? "Normal",
    callTarget: parsed.callTarget ?? "SO",
    marker:     parsed.marker     ?? null,
    crossDepot: typeof parsed.crossDepot === "string" ? parsed.crossDepot : "",
    notes:      typeof parsed.notes === "string" ? parsed.notes : "",
  });
}

export function clearLiveDraft(): void {
  removeRaw(LIVE_KEY);
}

// ── 2. Saved drafts — upsert by id, cap 20, newest first ──────────────────

function readDrafts(): V2SavedDraft[] {
  const parsed = readRaw(DRAFTS_KEY) as Partial<DraftStore> | null;
  if (!parsed || !Array.isArray(parsed.drafts)) return [];
  return parsed.drafts
    .filter((d) => !!d && typeof d.id === "string" && validSnapshot(d.snapshot))
    .map((d) => ({ ...d, snapshot: migrateSnapshot(d.snapshot) }));
}

export function loadSavedDrafts(): V2SavedDraft[] {
  return readDrafts();
}

export function newDraftId(): string {
  return `d${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/** Upsert: saving a REOPENED draft under its own id replaces it in place. */
export function upsertSavedDraft(draft: V2SavedDraft): V2SavedDraft[] {
  const next = [draft, ...readDrafts().filter((d) => d.id !== draft.id)].slice(0, MAX_DRAFTS);
  writeRaw(DRAFTS_KEY, { version: 1, drafts: next } satisfies DraftStore);
  return next;
}

export function removeSavedDraft(id: string): V2SavedDraft[] {
  const next = readDrafts().filter((d) => d.id !== id);
  writeRaw(DRAFTS_KEY, { version: 1, drafts: next } satisfies DraftStore);
  return next;
}

// ── 3. Sent orders — append-only, pruned to today + yesterday IST ─────────

/**
 * The IST calendar day for a UTC timestamp, at a FIXED +05:30 offset.
 *
 * Fixed, not the device's zone, and by calendar DAY rather than elapsed hours.
 * A phone carried to another timezone — or one whose clock zone is simply
 * wrong — then prunes to exactly the same set of orders the depot would see.
 * India has no DST, so the fixed offset is exact rather than an approximation.
 */
function istDateKey(epochMs: number): string {
  const ist = new Date(epochMs + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
}

function pruneToRecent(orders: V2SentOrder[], nowMs: number): V2SentOrder[] {
  const todayKey     = istDateKey(nowMs);
  const yesterdayKey = istDateKey(nowMs - DAY_MS);
  return orders.filter((o) => {
    const key = istDateKey(o.sentAt);
    return key === todayKey || key === yesterdayKey;
  });
}

function readSentRaw(): V2SentOrder[] {
  const parsed = readRaw(SENT_KEY) as Partial<SentStore> | null;
  if (!parsed || !Array.isArray(parsed.orders)) return [];
  // Sent orders too: "Send again" loads one back onto the board through the
  // same applySnapshot every draft uses, so an unmigrated sent line would
  // duplicate on the next edit exactly as a draft line would. The thumbnail
  // and the tile badge are read off tileSap as well.
  return parsed.orders
    .filter((o) => !!o && typeof o.id === "string" && validSnapshot(o.snapshot))
    .map((o) => ({ ...o, snapshot: migrateSnapshot(o.snapshot) }));
}

/** Prunes on READ and writes the pruned result back, so storage actually shrinks. */
export function loadSentOrders(): V2SentOrder[] {
  const raw = readSentRaw();
  const pruned = pruneToRecent(raw, Date.now());
  if (pruned.length !== raw.length) writeRaw(SENT_KEY, { version: 1, orders: pruned } satisfies SentStore);
  return pruned;
}

export function newSentId(): string {
  return `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/** Append-only — every Send is its own event, never overwriting a prior one. */
export function addSentOrder(order: V2SentOrder): V2SentOrder[] {
  const next = [order, ...pruneToRecent(readSentRaw(), Date.now())];
  writeRaw(SENT_KEY, { version: 1, orders: next } satisfies SentStore);
  return next;
}

// ── Display helpers ────────────────────────────────────────────────────────
// Device-local, and deliberately so: these are cosmetic row captions, not the
// IST pruning key above and not anything that reaches an email.

export function formatSavedAt(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}, ${time}`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

// ── Favourite dealers ──────────────────────────────────────────────────────

/** No timestamp — favourites are a set, not a history. Order is recency of add. */
export type V2Fav = { name: string; code: string; area: string | null };
type FavStore = { version: 1; favs: V2Fav[] };

export function loadFavs(): V2Fav[] {
  const parsed = readRaw(FAVS_KEY) as Partial<FavStore> | null;
  if (!parsed || !Array.isArray(parsed.favs)) return [];
  return parsed.favs
    .filter((f): f is V2Fav => !!f && typeof f.name === "string" && typeof f.code === "string")
    .map((f) => ({ name: f.name, code: f.code, area: typeof f.area === "string" ? f.area : null }))
    .slice(0, MAX_FAVS);
}

// ── Starred dealers ────────────────────────────────────────────────────────
//
// HE CURATES THIS LIST HIMSELF, with one tap on a star. That is both the add
// and the remove, which is the whole reason the star is back: the previous
// list built itself from what he SENT and gave him no way to take anything off
// it, so it only ever grew.
//
// 🔴 SENDING AN ORDER DOES NOT STAR ANYBODY. A dealer he served once is not a
// dealer he wants at the top of his list forever, and a list that adds itself
// is a list he cannot trust to mean anything.

/** `at` is when it was starred — newest first, so a fresh star is findable. */
export type V2Star = { name: string; code: string; area: string | null; at: number };
type StarStore = { version: 1; dealers: V2Star[] };

/**
 * A storage bound, not a product rule. Nothing evicts at forty; this exists so
 * a corrupted or scripted write cannot grow localStorage without limit.
 */
const MAX_STARRED = 200;

/**
 * 🔴 MIGRATED ONCE FROM po2_my_dealers, WHICH WAS ITSELF MIGRATED ONCE FROM
 * po2_fav_customers. Nobody loses their list twice in one night.
 *
 * The chain runs in order, so a phone that skipped a version still arrives
 * here: loadMyDealers() seeds itself from the old favourites if it has to, and
 * this seeds from that. Recognised by po2_starred_dealers being ABSENT rather
 * than by a flag, which could itself fail to write.
 *
 * Both older keys are LEFT IN PLACE. They cost nothing and they are the only
 * copies if a migration turns out to be wrong.
 */
export function loadStarred(): V2Star[] {
  const parsed = readRaw(STAR_KEY) as Partial<StarStore> | null;
  if (parsed && Array.isArray(parsed.dealers)) return cleanStars(parsed.dealers);

  const seeded = cleanStars(loadMyDealers());
  writeRaw(STAR_KEY, { version: 1, dealers: seeded } satisfies StarStore);
  return seeded;
}

function cleanStars(rows: { name?: unknown; code?: unknown; area?: unknown; at?: unknown }[]): V2Star[] {
  return rows
    .filter((r): r is V2Star => !!r && typeof r.name === "string" && typeof r.code === "string")
    .map((r) => ({
      name: r.name, code: r.code,
      area: typeof r.area === "string" ? r.area : null,
      at: typeof r.at === "number" ? r.at : 1,
    }))
    .sort((x, y) => y.at - x.at)
    .slice(0, MAX_STARRED);
}

/** One tap. Starred becomes unstarred and back, and returns the new list. */
export function toggleStarred(c: { name: string; code: string; area: string | null }): V2Star[] {
  const current = loadStarred();
  const next = current.some((d) => d.code === c.code)
    ? current.filter((d) => d.code !== c.code)
    : cleanStars([{ name: c.name, code: c.code, area: c.area ?? null, at: Date.now() }, ...current]);
  writeRaw(STAR_KEY, { version: 1, dealers: next } satisfies StarStore);
  return next;
}

// ── The old send-built list — READ ONLY, and only to seed the stars above ──
//
// Nothing writes it any more. It stays readable so the one-time migration in
// loadStarred() has something to read, and stays written on the phones that
// already have it so that migration can be undone if it was wrong.

type MineStore = { version: 1; dealers: V2Star[] };

function loadMyDealers(): V2Star[] {
  const parsed = readRaw(MINE_KEY) as Partial<MineStore> | null;
  if (parsed && Array.isArray(parsed.dealers)) return cleanStars(parsed.dealers);
  // …and one level further back: the original starred favourites.
  return loadFavs().map((f, i) => ({
    name: f.name, code: f.code, area: f.area,
    at: 1 + (MAX_STARRED - i),
  }));
}

// ── List-row summaries ─────────────────────────────────────────────────────

/**
 * "Gloss, Cement SB, Damp 2in1 +2 more" — what is actually IN a stored order.
 *
 * Names are DEDUPED first: three Gloss lines in different bases are one
 * product to someone scanning a list, and "Gloss, Gloss, Gloss" would burn the
 * whole line saying nothing. The "+N" counts distinct products left over.
 */
export function summaryLine(snapshot: V2Snapshot): string {
  const names: string[] = [];
  for (const line of snapshot.lines) {
    if (!names.includes(line.label)) names.push(line.label);
  }
  const shown = names.slice(0, 3).join(", ");
  const rest  = names.length - 3;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

/** Total units in a stored order — the right-hand figure on a list row. */
export function unitsOf(snapshot: V2Snapshot): number {
  let units = 0;
  for (const line of snapshot.lines) {
    for (const qty of Object.values(line.qtys)) if (qty > 0) units += qty;
  }
  return units;
}
