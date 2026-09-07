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

import type {
  ApiCustomer, V2CallTarget, V2CartLine, V2Dispatch, V2Marker, V2Order,
} from "./v2-data";

const LIVE_KEY   = "po2_draft";
const DRAFTS_KEY = "po2_saved_drafts";
const SENT_KEY   = "po2_sent_orders";
const FAVS_KEY   = "po2_fav_customers";   // read once, for the seed below
const MINE_KEY   = "po2_my_dealers";

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
  return {
    customer: parsed.customer ?? null, lines: parsed.lines,
    shipToCode: typeof parsed.shipToCode === "string" ? parsed.shipToCode : null,
    dispatch:   parsed.dispatch   ?? "Normal",
    callTarget: parsed.callTarget ?? "SO",
    marker:     parsed.marker     ?? null,
    crossDepot: typeof parsed.crossDepot === "string" ? parsed.crossDepot : "",
    notes:      typeof parsed.notes === "string" ? parsed.notes : "",
  };
}

export function clearLiveDraft(): void {
  removeRaw(LIVE_KEY);
}

// ── 2. Saved drafts — upsert by id, cap 20, newest first ──────────────────

function readDrafts(): V2SavedDraft[] {
  const parsed = readRaw(DRAFTS_KEY) as Partial<DraftStore> | null;
  if (!parsed || !Array.isArray(parsed.drafts)) return [];
  return parsed.drafts.filter((d) => !!d && typeof d.id === "string" && validSnapshot(d.snapshot));
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
  return parsed.orders.filter((o) => !!o && typeof o.id === "string" && validSnapshot(o.snapshot));
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

// ── My dealers ─────────────────────────────────────────────────────────────
//
// The list BUILDS ITSELF: sending an order puts that dealer on it. Nothing to
// star, nothing to curate, and no all-dealers list behind it — a dealer who is
// not on it is reached by typing his name. A salesman covers the same forty
// shops; a list he had to maintain would be a list he stopped maintaining.

/** Newest first. `at` is the last time an order went out to them. */
export type V2Dealer = { name: string; code: string; area: string | null; at: number };
type MineStore = { version: 1; dealers: V2Dealer[] };

const MAX_MINE = 60;

/**
 * 🔴 SEEDED ONCE FROM THE OLD FAVOURITES, THEN NEVER AGAIN.
 *
 * Starring is gone, but somebody has twelve dealers pinned on their phone right
 * now and they must not quietly vanish on the next deploy. So the FIRST read
 * after this ships — recognised by po2_my_dealers being absent, not by a flag
 * that could itself fail to write — folds po2_fav_customers in and saves the
 * result, after which the seed can never run twice.
 *
 * po2_fav_customers is LEFT IN PLACE. It costs nothing and it is the only copy
 * if this merge turns out to be wrong.
 */
export function loadMyDealers(): V2Dealer[] {
  const parsed = readRaw(MINE_KEY) as Partial<MineStore> | null;
  if (parsed && Array.isArray(parsed.dealers)) return clean(parsed.dealers);

  const seeded = loadFavs().map((f, i) => ({
    name: f.name, code: f.code, area: f.area,
    // Ordered behind anything sent later, but keeping the order they were
    // starred in. 1 not 0, so a seeded dealer is never mistaken for unset.
    at: 1 + (MAX_MINE - i),
  }));
  writeRaw(MINE_KEY, { version: 1, dealers: seeded } satisfies MineStore);
  return seeded;
}

function clean(rows: V2Dealer[]): V2Dealer[] {
  return rows
    .filter((r): r is V2Dealer => !!r && typeof r.name === "string" && typeof r.code === "string")
    .map((r) => ({
      name: r.name, code: r.code,
      area: typeof r.area === "string" ? r.area : null,
      at: typeof r.at === "number" ? r.at : 1,
    }))
    .sort((x, y) => y.at - x.at)
    .slice(0, MAX_MINE);
}

/** Called when an order is SENT — not when a dealer is merely opened. */
export function addMyDealer(c: { name: string; code: string; area: string | null }): V2Dealer[] {
  const rest = loadMyDealers().filter((d) => d.code !== c.code);
  const next = clean([{ name: c.name, code: c.code, area: c.area ?? null, at: Date.now() }, ...rest]);
  writeRaw(MINE_KEY, { version: 1, dealers: next } satisfies MineStore);
  return next;
}

export function removeMyDealer(code: string): V2Dealer[] {
  const next = loadMyDealers().filter((d) => d.code !== code);
  writeRaw(MINE_KEY, { version: 1, dealers: next } satisfies MineStore);
  return next;
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
