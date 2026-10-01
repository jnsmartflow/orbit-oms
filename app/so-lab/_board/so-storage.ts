// /so-lab order storage — live draft, saved drafts, favourite tiles, two star
// lists. A FORK of app/po2/v2-storage.ts (C.2a 2026-10-01; server sync C.2b).
//
// 🔴 THE DATABASE IS THE SOURCE OF TRUTH SINCE C.2b (Schema v27.49: so_saved_drafts,
// so_live_drafts, so_fav_products, so_starred_dealers — see SERVER SYNC at the
// foot). The `sopage_{soId}_*` keys here are the instant cache and offline copy,
// SCOPED PER SALES OFFICER — set once by setStorageScope(so.id) before the board
// reads anything — so two salesmen sharing one phone never see each other's data.
//
// 🔴 THIS FILE NEVER READS OR WRITES A po2_* KEY (owner, 2026-10-01: no import
// of old /po2 phone data). /po2's two migration chains (po2_fav_customers →
// po2_my_dealers → po2_starred_dealers) are deliberately NOT carried over: an
// absent star list here is simply empty.
//
// 🔴 NO SENT LOG. Phase E reads sent orders from mo_orders; until then the Sent
// tab is a "coming soon" placeholder and Send writes nothing.
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

// ── Per-SO key scope ───────────────────────────────────────────────────────

let scopeSoId: number | null = null;

/** Called ONCE by the board, before any load, with the session's SO id. */
export function setStorageScope(salesOfficerId: number): void {
  scopeSoId = salesOfficerId;
}

/** `sopage_{soId}_{name}`, or null before the scope is set (reads → nothing,
 *  writes → dropped), so an unscoped call can never land in a shared key. */
function scopedKey(name: string): string | null {
  return scopeSoId === null ? null : `sopage_${scopeSoId}_${name}`;
}

const LIVE_KEY         = "draft";
const DRAFTS_KEY       = "saved";
const STAR_KEY         = "stars_dealer";
const SHIPTO_STAR_KEY  = "stars_shipto";
const FAV_PRODUCTS_KEY = "favs";

const MAX_DRAFTS   = 20;
const LIVE_TTL_MS  = 24 * 60 * 60 * 1000;

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

/**
 * A saved draft.
 *
 * 🔴 `name` IS OPTIONAL AND IS A LABEL AND NOTHING ELSE. It lets a salesman
 * call one "Wednesday route" instead of reading "MOHAN COLOUR CO 2" off a list
 * of four that all start the same way. It is not written into the snapshot, it
 * is not the dealer, and no part of the email path can see it — the wire is
 * built from each line's own product / baseColour / subProduct, which this does
 * not touch.
 *
 * OPTIONAL IS WHY NOTHING NEEDS MIGRATING. A draft stored before today has no
 * `name` key at all; it reads back as undefined, draftDisplayName falls to
 * `label`, and the row looks exactly as it looks now. No version bump, because
 * nothing about the SHAPE changed — a reader that does not know about `name`
 * ignores it, and a reader that does copes with its absence.
 */
export type V2SavedDraft = {
  id: string;
  /** Derived from the snapshot at save time — the dealer, or a fallback. */
  label: string;
  /** What the salesman called it, if he called it anything. */
  name?: string;
  savedAt: number;
  snapshot: V2Snapshot;
};
export type V2SentOrder  = { id: string; label: string; sentAt: number;  snapshot: V2Snapshot };

type LiveDraft   = V2Snapshot & { version: 1; updatedAt: number };
type DraftStore  = { version: 1; drafts: V2SavedDraft[] };
// ── Raw access, wrapped — every key goes through scopedKey ─────────────────

function readRaw(name: string): unknown {
  const key = scopedKey(name);
  if (key === null || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeRaw(name: string, value: unknown): void {
  const key = scopedKey(name);
  if (key === null || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode. Best-effort by design.
  }
}

function removeRaw(name: string): void {
  const key = scopedKey(name);
  if (key === null || typeof window === "undefined") return;
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

/**
 * Local write every time (the page debounces it at 400 ms); the SERVER copy
 * follows the C.2b rules in liveSync — "edit" is throttled to once a minute,
 * "screen" and "hide" go now (hide with fetch keepalive).
 */
export function saveLiveDraft(snapshot: V2Snapshot, reason: LiveSyncReason = "edit"): void {
  const entry: LiveDraft = { ...snapshot, version: 1, updatedAt: Date.now() };
  writeRaw(LIVE_KEY, entry);
  liveSync(snapshot, reason);
}

/** This phone's copy with its stamp, 24 h-expired — for loadLiveDraftSynced. */
function readLocalLive(): { snapshot: V2Snapshot; updatedAt: number } | null {
  const parsed = readRaw(LIVE_KEY) as Partial<LiveDraft> | null;
  if (!parsed || typeof parsed.updatedAt !== "number") return null;
  const updatedAt = parsed.updatedAt;
  const snapshot = loadLiveDraft();
  return snapshot ? { snapshot, updatedAt } : null;
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

/** Empty order: local key removed; the server row is DELETEd once (liveSync). */
export function clearLiveDraft(reason: LiveSyncReason = "edit"): void {
  removeRaw(LIVE_KEY);
  liveSync(null, reason);
}

// ── 2. Saved drafts — upsert by id, cap 20, newest first ──────────────────

function readDrafts(): V2SavedDraft[] {
  const parsed = readRaw(DRAFTS_KEY) as Partial<DraftStore> | null;
  if (!parsed || !Array.isArray(parsed.drafts)) return [];
  return parsed.drafts
    .filter((d) => !!d && typeof d.id === "string" && validSnapshot(d.snapshot))
    // The spread carries the optional name through when it is there and leaves
    // it absent when it is not — validSnapshot is unchanged and still asks
    // only about lines and customer, so no stored draft can start failing it.
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
  const prev = readDrafts();
  const next = [draft, ...prev.filter((d) => d.id !== draft.id)].slice(0, MAX_DRAFTS);
  writeRaw(DRAFTS_KEY, { version: 1, drafts: next } satisfies DraftStore);
  // C.2b: optimistic — the server keeps the 20 newest too.
  syncOrRevert(
    callApi("PUT", draftPath(draft.id), {
      name: draft.name ?? null, label: draft.label, snapshot: draft.snapshot, savedAt: draft.savedAt,
    }),
    revertDrafts(prev),
  );
  return next;
}

export function removeSavedDraft(id: string): V2SavedDraft[] {
  const prev = readDrafts();
  const next = prev.filter((d) => d.id !== id);
  writeRaw(DRAFTS_KEY, { version: 1, drafts: next } satisfies DraftStore);
  syncOrRevert(callApi("DELETE", draftPath(id)), revertDrafts(prev));
  return next;
}

/**
 * What a draft row should SAY. The salesman's own name if he gave one,
 * otherwise the derived label — which is what every row shows today.
 *
 * Trimmed, and a name that trims to nothing is treated as no name at all: a
 * field cleared to spaces must not leave a row captioned with whitespace.
 */
export function draftDisplayName(draft: V2SavedDraft): string {
  const name = draft.name?.trim();
  return name && name.length > 0 ? name : draft.label;
}

/**
 * Rename one draft in place, or clear its name with "".
 *
 * 🔴 IT REWRITES ONE FIELD AND SPREADS THE REST. The snapshot object is carried
 * across by reference, so the lines, the dealer, the packs and the three fields
 * the email reads cannot be touched by a rename however this is called.
 *
 * A name is capped at 40 characters — long enough for "Wednesday route, Adajan"
 * and short enough that a draft row never has to wrap. Silently trimmed rather
 * than rejected: a rename is a caption, and refusing one at 41 characters would
 * be a dialog about nothing.
 */
export function renameSavedDraft(id: string, name: string): V2SavedDraft[] {
  const clean = name.trim().slice(0, 40);
  const prev = readDrafts();
  const next = prev.map((d) =>
    d.id === id ? (clean.length > 0 ? { ...d, name: clean } : stripName(d)) : d);
  writeRaw(DRAFTS_KEY, { version: 1, drafts: next } satisfies DraftStore);
  syncOrRevert(callApi("PATCH", draftPath(id), { name: clean.length > 0 ? clean : null }), revertDrafts(prev));
  return next;
}

/** Clearing a name REMOVES the key rather than storing "", so a cleared draft
 *  is byte-identical to one that never had a name. */
function stripName(draft: V2SavedDraft): V2SavedDraft {
  const { name: _dropped, ...rest } = draft;
  return rest;
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
 * WHICH STAR LIST. Two of them, one per picker, and they share nothing.
 *
 * 🔴 THEY ARE ANSWERS TO DIFFERENT QUESTIONS. "dealer" is whose account the
 * order is billed to — his own shortlist, the twenty or so shops he actually
 * serves. "shipto" is where the goods physically go, which is routinely a
 * THIRD PARTY he has never billed and never will: LAKHANI PAINTS shipping
 * against MOHAN COLOUR CO is a real cross-billing order. One list served both
 * screens until now, so starring a ship-to address put it at the top of the
 * list of people he sells to, and starring a customer offered that customer as
 * a delivery address. Both were wrong in the same way.
 *
 * 🔴 THE SAME DEALER CAN BE IN BOTH, IN EITHER, OR IN NEITHER, and each screen
 * must show its own answer. Never compute a row's star from a merged set or
 * from "is this code starred anywhere" — the fill is per LIST, and that is the
 * whole point of the split.
 *
 * (Fork: neither list carries a migration chain — see loadStarred.)
 */
export type V2StarList = "dealer" | "shipto";

function starKey(list: V2StarList): string {
  return list === "shipto" ? SHIPTO_STAR_KEY : STAR_KEY;
}

/**
 * A storage bound, not a product rule. Nothing evicts at forty; this exists so
 * a corrupted or scripted write cannot grow localStorage without limit.
 */
const MAX_STARRED = 200;

/**
 * 🔴 NO SEED AND NO MIGRATION CHAIN — either list (fork change, 2026-10-01).
 * /po2 seeds its customer list from po2_my_dealers / po2_fav_customers; this
 * page never reads a po2_* key, so an absent list here is EMPTY and stays
 * absent until the salesman stars someone. Nothing is written on read.
 */
export function loadStarred(list: V2StarList = "dealer"): V2Star[] {
  const parsed = readRaw(starKey(list)) as Partial<StarStore> | null;
  if (parsed && Array.isArray(parsed.dealers)) return cleanStars(parsed.dealers);
  return [];
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

/**
 * One tap. Starred becomes unstarred and back, and returns the new list.
 *
 * 🔴 IT READS AND WRITES ONE LIST — the one named. Toggling a dealer on the
 * ship-to picker must not touch, reorder or unstar anything on the customer
 * picker, and the reverse. The `list` argument is the whole guarantee, so it
 * is threaded from the screen that is on and never inferred here.
 */
export function toggleStarred(
  c: { name: string; code: string; area: string | null },
  list: V2StarList = "dealer",
): V2Star[] {
  const current = loadStarred(list);
  const starring = !current.some((d) => d.code === c.code);
  const next = starring
    ? cleanStars([{ name: c.name, code: c.code, area: c.area ?? null, at: Date.now() }, ...current])
    : current.filter((d) => d.code !== c.code);
  writeRaw(starKey(list), { version: 1, dealers: next } satisfies StarStore);
  // C.2b: optimistic — one INSERT … ON CONFLICT DO NOTHING or one DELETE.
  syncOrRevert(
    callApi("POST", "/api/so-lab/stars", {
      list, customerCode: c.code, name: c.name, area: c.area ?? null, starred: starring,
    }),
    () => {
      writeRaw(starKey(list), { version: 1, dealers: current } satisfies StarStore);
      handlers?.onStars(list, current);
    },
    "Star list full — remove one first",
  );
  return next;
}

// ── List-row summaries ─────────────────────────────────────────────────────

// ── Favourite PRODUCTS ─────────────────────────────────────────────────────
// 🔴 TILES, NOT DEALERS. Own key (sopage_{soId}_favs), no seed, no chain,
// absent means empty.
//
// ⚠ A COMMENT HERE USED TO SAY "v2-storage imports nothing from v2-data and
// must not, or the two files become circular". THAT WAS WRONG. This file has
// imported boardTile and tileKeyForMember as VALUES since migrateLine was
// written — see the import at the top — and there is no cycle, because v2-data
// imports nothing at all. The favourite helpers below call them directly
// rather than taking injected callbacks, which is what that false claim had
// forced.

/**
 * 🔴 A FAVOURITE IS A BOARD TILE — version 2, and version 1 was a MEMBER.
 *
 * v1 stored member saps and it was the wrong unit, seen the moment it shipped:
 * "PU Prime Matt", "PU Prime Sealer" and "PU Prime Gloss" each burned one of
 * eight slots for what a salesman thinks of as one product, and the picker had
 * to list 98 rows to offer them. Starring the TILE brings the whole drawer, and
 * the picker drops to 37 rows.
 *
 * `key` is V2BoardTile.key, which under Scheme A is members[0].sap — the top
 * seller's own catalog join key, not a synthetic string. Still never a rowId:
 * the seed reassigns ids on every reseed.
 *
 * 🔴 NO LABEL AND NO ART ARE STORED. Both are derived at render from
 * boardTile(key), so a tile that is re-labelled or given a photograph follows
 * on the next load with nothing to migrate.
 */
export type V2FavProduct = { key: string; at: number };
type FavProductStore  = { version: 2; favs: V2FavProduct[] };
/** The shape on disk before 2026-09-09. Read once, migrated, replaced. */
type FavProductStoreV1 = { version: 1; favs: { sap: string; at: number }[] };

/**
 * 🔴 EIGHT, AND THE NINTH IS REFUSED RATHER THAN EVICTED — /po's rule
 * (lib/place-order/fav-customers.ts, FAV_CAP), kept because it is right for the
 * same reason: this is a list the salesman CURATED. Silently dropping his
 * oldest choice to make room for a new one deletes a decision he made, and he
 * has no way to know it happened. Refusing is the honest answer.
 */
const MAX_FAV_PRODUCTS = 8;

/**
 * The favourites as TILE KEYS — migrated from v1 if that is what is on the
 * phone, and dead entries pruned.
 *
 * 🔴 THE v1 LIST IS MIGRATED, NOT DISCARDED. It is a day old and nobody would
 * have lost much — but "the stored shape changed so we dropped it" is a habit,
 * not a decision, and the next migration will not be a day old. Each stored sap
 * goes through tileKeyForMember, the results are DEDUPED (three PU Prime
 * members collapse to one PU Prime, which is the whole point of the new grain)
 * and the list is truncated at eight. It is written back in v2 shape
 * immediately, so the mapping runs exactly once per phone.
 *
 * A v1 entry whose member has since left the board maps to null and is dropped
 * — the same fate it would meet on the prune below.
 *
 * PRUNING IS ON READ, NEVER ON WRITE, exactly as loadSentOrders prunes:
 * localStorage can hold a list written by an older build at any moment, and
 * pruning on write would only ever fix what this build happens to touch.
 *
 * ⚠ SORTING IS NOT DONE HERE. The board sorts A-Z on the tile LABEL, and the
 * order this returns is storage order.
 */
export function loadFavProducts(): V2FavProduct[] {
  const raw = readRaw(FAV_PRODUCTS_KEY) as
    (Partial<FavProductStore> & Partial<FavProductStoreV1>) | null;
  if (!raw || !Array.isArray(raw.favs)) return [];

  let clean: V2FavProduct[];
  if (raw.version === 1) {
    // MEMBER saps -> TILE keys. First occurrence wins; the list is re-sorted
    // A-Z at render anyway, so the surviving `at` only has to be plausible.
    // The split handles a PINNED member's composite key ("WOOD PRIMER|||White"),
    // which MEMBER_TILE is not indexed on.
    const seen = new Set<string>();
    clean = [];
    for (const f of (raw.favs as { sap?: unknown; at?: unknown }[])) {
      if (!f || typeof f.sap !== "string") continue;
      const key = tileKeyForMember(f.sap.split("|||")[0]);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      clean.push({ key, at: typeof f.at === "number" ? f.at : 1 });
    }
    clean = clean.slice(0, MAX_FAV_PRODUCTS);
    writeRaw(FAV_PRODUCTS_KEY, { version: 2, favs: clean } satisfies FavProductStore);
  } else {
    clean = (raw.favs as { key?: unknown; at?: unknown }[])
      .filter((f): f is V2FavProduct => !!f && typeof f.key === "string")
      .map((f) => ({ key: f.key, at: typeof f.at === "number" ? f.at : 1 }))
      .slice(0, MAX_FAV_PRODUCTS);
  }

  const live = clean.filter((f) => boardTile(f.key) !== null);
  // Only write back when something actually went, so a plain read is a read.
  if (live.length !== clean.length) {
    writeRaw(FAV_PRODUCTS_KEY, { version: 2, favs: live } satisfies FavProductStore);
  }
  return live;
}

/** True when this tile is already a favourite. Cheap enough to call per row. */
export function isFavProduct(key: string, favs: V2FavProduct[]): boolean {
  return favs.some((f) => f.key === key);
}

/**
 * Add one. Returns the new list, or "full" when the cap is reached.
 *
 * Idempotent — favouriting something already favourited reports "added" and
 * writes nothing, mirroring /po's addFav. The caller shows the amber message
 * only on "full".
 */
export function addFavProduct(key: string, favs: V2FavProduct[]):
  { result: "added"; favs: V2FavProduct[] } | { result: "full"; favs: V2FavProduct[] } {
  if (favs.some((f) => f.key === key)) return { result: "added", favs };
  if (favs.length >= MAX_FAV_PRODUCTS)  return { result: "full",  favs };
  const next = [...favs, { key, at: Date.now() }];
  writeRaw(FAV_PRODUCTS_KEY, { version: 2, favs: next } satisfies FavProductStore);
  // C.2b: optimistic. The server refuses a 9th too (another device may have
  // filled the list) — then this add is undone with /po2's "full" message.
  syncOrRevert(callApi("POST", "/api/so-lab/favourites", { tileKey: key }), revertFavs(favs), FAV_FULL_TOAST);
  return { result: "added", favs: next };
}

/** Remove one. Never confirms — un-starring is not destructive. */
export function removeFavProduct(key: string, favs: V2FavProduct[]): V2FavProduct[] {
  const next = favs.filter((f) => f.key !== key);
  writeRaw(FAV_PRODUCTS_KEY, { version: 2, favs: next } satisfies FavProductStore);
  syncOrRevert(callApi("DELETE", "/api/so-lab/favourites", { tileKey: key }), revertFavs(favs));
  return next;
}

function revertFavs(prev: V2FavProduct[]): () => void {
  return () => {
    writeRaw(FAV_PRODUCTS_KEY, { version: 2, favs: prev } satisfies FavProductStore);
    handlers?.onFavs(prev);
  };
}

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

// ══ SERVER SYNC (C.2b, 2026-10-01, Schema v27.49) ═════════════════════════
//
// The so_* tables are the SOURCE OF TRUTH; the sopage_{soId}_* keys above are
// the instant cache and the offline copy. 🔴 No polling anywhere:
//   • ONE GET /api/so-lab/state per board load (serverState(), memoised);
//   • saved drafts / favourites / stars: the local write happens first
//     (optimistic), the server call follows; on failure the local copy is put
//     back, the page is told (setSyncHandlers) and a toast says why;
//   • the live draft goes to the server ONLY on screen change, on page hide
//     (fetch keepalive) and at most once per 60 s while editing — never when
//     the JSON is identical to the last one sent. Empty order → DELETE once.
// 🔴 2026-10-01: no import of old po2_* phone data — owner decision; do not add one.

export type LiveSyncReason = "edit" | "screen" | "hide";

type SyncHandlers = {
  onDrafts: (drafts: V2SavedDraft[]) => void;
  onFavs:   (favs: V2FavProduct[]) => void;
  onStars:  (list: V2StarList, stars: V2Star[]) => void;
  onToast:  (message: string, tone: "info" | "warn") => void;
};
let handlers: SyncHandlers | null = null;

/** Registered once by the board so a failed write can be reverted on screen. */
export function setSyncHandlers(h: SyncHandlers): void {
  handlers = h;
}

const OFFLINE_TOAST = "Not saved to your account — check the connection and try again";
const FAV_FULL_TOAST = "Favourites full (8 of 8) — remove one first";

async function callApi(
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  keepalive = false,
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      keepalive,
    });
    let data: Record<string, unknown> | null = null;
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      try { data = (await res.json()) as Record<string, unknown>; } catch { data = null; }
    }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

function deviceId(): string | null {
  const existing = readRaw("device");
  if (typeof existing === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) return existing;
  const fresh = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  writeRaw("device", fresh);
  return readRaw("device") === fresh ? fresh : null;
}

// ── The one state read ─────────────────────────────────────────────────────

type ServerState = {
  live: { snapshot: V2Snapshot; updatedAt: number } | null;
  drafts: V2SavedDraft[];
  favs: V2FavProduct[];
  stars: { dealer: V2Star[]; shipto: V2Star[] };
};

let stateLoaded = false;
let statePromise: Promise<ServerState | null> | null = null;

function toSnapshot(raw: unknown): V2Snapshot | null {
  const s = raw as Partial<V2Snapshot> | null;
  if (!validSnapshot(s)) return null;
  return migrateSnapshot({
    customer: s.customer ?? null, lines: s.lines,
    shipToCode: typeof s.shipToCode === "string" ? s.shipToCode : null,
    dispatch:   s.dispatch   ?? "Normal",
    callTarget: s.callTarget ?? "SO",
    marker:     s.marker     ?? null,
    crossDepot: typeof s.crossDepot === "string" ? s.crossDepot : "",
    notes:      typeof s.notes === "string" ? s.notes : "",
  });
}

async function fetchServerState(): Promise<ServerState | null> {
  const { status, data } = await callApi("GET", "/api/so-lab/state");
  if (status !== 200 || !data) return null;

  type RawDraft = { clientId?: unknown; name?: unknown; label?: unknown; snapshot?: unknown; savedAt?: unknown };
  const rawDrafts: RawDraft[] = Array.isArray(data.savedDrafts) ? (data.savedDrafts as RawDraft[]) : [];
  const drafts: V2SavedDraft[] = [];
  for (const d of rawDrafts) {
    if (typeof d.clientId !== "string" || typeof d.label !== "string" || typeof d.savedAt !== "number") continue;
    const snapshot = toSnapshot(d.snapshot);
    if (!snapshot) continue;
    drafts.push({
      id: d.clientId, label: d.label, savedAt: d.savedAt, snapshot,
      ...(typeof d.name === "string" && d.name.trim() ? { name: d.name } : {}),
    });
  }

  type RawFav = { tileKey?: unknown; addedAt?: unknown };
  const rawFavs: RawFav[] = Array.isArray(data.favProducts) ? (data.favProducts as RawFav[]) : [];
  // Dead tile keys are dropped from the VIEW only — no write on read.
  const favs: V2FavProduct[] = rawFavs
    .filter((f): f is { tileKey: string; addedAt?: unknown } =>
      typeof f.tileKey === "string" && boardTile(f.tileKey) !== null)
    .map((f) => ({ key: f.tileKey, at: typeof f.addedAt === "number" ? f.addedAt : 1 }))
    .slice(0, MAX_FAV_PRODUCTS);

  type RawStar = { customerCode?: unknown; name?: unknown; area?: unknown; starredAt?: unknown };
  const toStars = (raw: unknown): V2Star[] =>
    cleanStars((Array.isArray(raw) ? (raw as RawStar[]) : [])
      .map((s) => ({ code: s.customerCode, name: s.name, area: s.area, at: s.starredAt })));
  const starsRaw = (data.stars ?? {}) as { dealer?: unknown; shipto?: unknown };
  const stars = { dealer: toStars(starsRaw.dealer), shipto: toStars(starsRaw.shipto) };

  let live: ServerState["live"] = null;
  const rawLive = data.liveDraft as { snapshot?: unknown; revision?: unknown; updatedAt?: unknown } | null;
  liveRevision = null;
  serverHasLive = false;
  if (rawLive && typeof rawLive.revision === "number" && typeof rawLive.updatedAt === "number") {
    liveRevision = rawLive.revision;
    serverHasLive = true;
    const snap = toSnapshot(rawLive.snapshot);
    if (snap && Date.now() - rawLive.updatedAt <= LIVE_TTL_MS) {
      live = { snapshot: snap, updatedAt: rawLive.updatedAt };
      lastSentJson = JSON.stringify(snap);
    }
  }

  // The server is the source of truth: refresh the local cache from it.
  writeRaw(DRAFTS_KEY, { version: 1, drafts } satisfies DraftStore);
  writeRaw(FAV_PRODUCTS_KEY, { version: 2, favs } satisfies FavProductStore);
  writeRaw(STAR_KEY, { version: 1, dealers: stars.dealer } satisfies StarStore);
  writeRaw(SHIPTO_STAR_KEY, { version: 1, dealers: stars.shipto } satisfies StarStore);
  stateLoaded = true;
  return { live, drafts, favs, stars };
}

/** The board's one server read, memoised for the page's life. null = offline / failed. */
export function serverState(): Promise<ServerState | null> {
  if (!statePromise) statePromise = fetchServerState();
  return statePromise;
}

/**
 * The in-progress order to restore: the NEWER of this phone's copy and the
 * server's (each already 24 h-expired on read). A server winner is also written
 * to the local cache so the two agree.
 */
export async function loadLiveDraftSynced(): Promise<V2Snapshot | null> {
  const local = readLocalLive();
  const server = (await serverState())?.live ?? null;
  if (server && (!local || server.updatedAt > local.updatedAt)) {
    writeRaw(LIVE_KEY, { ...server.snapshot, version: 1, updatedAt: server.updatedAt } satisfies LiveDraft);
    return server.snapshot;
  }
  return local ? local.snapshot : null;
}

// ── The live draft's server copy ──────────────────────────────────────────

const LIVE_MIN_GAP_MS = 60_000;    // at most once a minute while editing
const LIVE_FIRST_EDIT_MS = 15_000; // a lone edit still reaches the server soon

let liveRevision: number | null = null;
let serverHasLive = false;
let lastSentJson: string | null = null;
let lastSentAt = 0;
let liveConflict = false;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLive: V2Snapshot | null | undefined = undefined;

function liveSync(snapshot: V2Snapshot | null, reason: LiveSyncReason): void {
  pendingLive = snapshot;
  if (reason === "edit" && snapshot !== null) {
    if (liveTimer) return; // already scheduled; it sends the newest pending
    const delay = Math.max(LIVE_FIRST_EDIT_MS, lastSentAt + LIVE_MIN_GAP_MS - Date.now());
    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (pendingLive !== undefined) void pushLive(pendingLive, false);
    }, delay);
    return;
  }
  // Screen change, page hide, or the order was emptied — now.
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
  void pushLive(snapshot, reason === "hide");
}

async function pushLive(snapshot: V2Snapshot | null, keepalive: boolean): Promise<void> {
  // Before the state read lands this device does not know the server revision;
  // writing then would only manufacture a conflict. The phone copy is safe.
  if (liveConflict || !stateLoaded) return;

  if (snapshot === null) {
    if (!serverHasLive) return;
    serverHasLive = false;
    const { status } = await callApi("DELETE", "/api/so-lab/live-draft", undefined, keepalive);
    if (status === 200) { liveRevision = null; lastSentJson = null; }
    else serverHasLive = true; // retried on the next trigger
    return;
  }

  const json = JSON.stringify(snapshot);
  if (json === lastSentJson) return;
  lastSentAt = Date.now();
  const { status, data } = await callApi(
    "PUT", "/api/so-lab/live-draft",
    { snapshot, expectedRevision: liveRevision, deviceId: deviceId() },
    keepalive,
  );
  if (status === 200 && data && typeof data.revision === "number") {
    liveRevision = data.revision;
    serverHasLive = true;
    lastSentJson = json;
    return;
  }
  if (status === 409) {
    // Another device wrote the in-progress order first. Never overwrite it
    // silently: stop sending for this page's life (the phone copy stays).
    liveConflict = true;
    handlers?.onToast("This order was changed on another device — reload to see the latest", "warn");
  }
  // Anything else (offline, 5xx): left for the next trigger.
}

// ── Optimistic writes for drafts, favourites, stars ────────────────────────

/** Runs the server call; on failure restores `revert()` and toasts. */
function syncOrRevert(
  call: Promise<{ status: number; data: Record<string, unknown> | null }>,
  revert: () => void,
  fullToast?: string,
): void {
  void call.then(({ status }) => {
    if (status === 200) return;
    revert();
    handlers?.onToast(status === 409 && fullToast ? fullToast : OFFLINE_TOAST, "warn");
  });
}

function draftPath(id: string): string {
  return `/api/so-lab/drafts/${encodeURIComponent(id)}`;
}

function revertDrafts(prev: V2SavedDraft[]): () => void {
  return () => {
    writeRaw(DRAFTS_KEY, { version: 1, drafts: prev } satisfies DraftStore);
    handlers?.onDrafts(prev);
  };
}
