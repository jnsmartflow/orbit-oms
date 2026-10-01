import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Server side of the /so-lab per-SO storage (C.2b, 2026-10-01, Schema v27.49):
// so_saved_drafts · so_live_drafts · so_fav_products · so_starred_dealers.
// Called ONLY by the /api/so-lab/* routes, AFTER requireSoApi(); the SO id is
// always the session's, never the request's.
//
// CAPS (a CHECK cannot count rows, so they live here):
//   • saved drafts — trimmed to the 20 newest per SO after every save
//   • favourite tiles — 8; the 9th is REFUSED (409 "full"), never evicted
//   • stars — 200 per list; the 201st is refused (409)
// Snapshots are stored RAW; migrateLine runs on the CLIENT on every read (it
// needs BOARD), exactly where /po2 migrates.
// 🔴 2026-10-01: no import of old po2_* phone data — owner decision; do not add one.
// Sequential awaits only — never prisma.$transaction (CORE §3).

export const MAX_SAVED_DRAFTS = 20;
export const MAX_FAV_PRODUCTS = 8;
export const MAX_STARS_PER_LIST = 200;
const MAX_SNAPSHOT_BYTES = 65_536; // = chk_*_snapshot_size

// ── Input validation (returns null on any problem) ─────────────────────────

export type SnapshotJson = Prisma.InputJsonObject;

/** An object with a lines[] array, ≤ 64 KB serialised — the two CHECKs. */
export function parseSnapshot(raw: unknown): SnapshotJson | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!Array.isArray((raw as { lines?: unknown }).lines)) return null;
  let text: string;
  try { text = JSON.stringify(raw); } catch { return null; }
  if (Buffer.byteLength(text, "utf8") > MAX_SNAPSHOT_BYTES) return null;
  return JSON.parse(text) as SnapshotJson;
}

/** The page mints "d{ms}{rand}"; accept 1-64 safe characters. */
export function parseClientId(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

/** A tile key (V2BoardTile.key — a catalogue sap, may hold "|||"). */
export function parseTileKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw;
  return k.length >= 1 && k.length <= 200 ? k : null;
}

export function parseList(raw: unknown): "dealer" | "shipto" | null {
  return raw === "dealer" || raw === "shipto" ? raw : null;
}

function clip(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.length > 0 && s.length <= max ? s : null;
}

export function parseCode(raw: unknown): string | null { return clip(raw, 40); }
export function parseText(raw: unknown, max: number): string | null { return clip(raw, max); }

// ── State, in ONE call ─────────────────────────────────────────────────────

export type SoState = {
  liveDraft: { snapshot: unknown; revision: number; updatedAt: number } | null;
  savedDrafts: { clientId: string; name: string | null; label: string; snapshot: unknown; savedAt: number }[];
  favProducts: { tileKey: string; addedAt: number }[];
  stars: {
    dealer: { customerCode: string; name: string; area: string | null; starredAt: number }[];
    shipto: { customerCode: string; name: string; area: string | null; starredAt: number }[];
  };
};

/** Four small indexed reads, sequential. */
export async function getSoState(soId: number): Promise<SoState> {
  const live = await prisma.so_live_drafts.findUnique({
    where: { salesOfficerId: soId },
    select: { snapshot: true, revision: true, updatedAt: true },
  });
  const drafts = await prisma.so_saved_drafts.findMany({
    where: { salesOfficerId: soId },
    orderBy: { savedAt: "desc" },
    take: MAX_SAVED_DRAFTS,
    select: { clientId: true, name: true, label: true, snapshot: true, savedAt: true },
  });
  const favs = await prisma.so_fav_products.findMany({
    where: { salesOfficerId: soId },
    orderBy: { addedAt: "asc" },
    take: MAX_FAV_PRODUCTS,
    select: { tileKey: true, addedAt: true },
  });
  const stars = await prisma.so_starred_dealers.findMany({
    where: { salesOfficerId: soId },
    orderBy: { starredAt: "desc" },
    take: MAX_STARS_PER_LIST * 2,
    select: { list: true, customerCode: true, name: true, area: true, starredAt: true },
  });

  const toStar = (s: (typeof stars)[number]) => ({
    customerCode: s.customerCode, name: s.name, area: s.area, starredAt: s.starredAt.getTime(),
  });
  return {
    liveDraft: live
      ? { snapshot: live.snapshot, revision: live.revision, updatedAt: live.updatedAt.getTime() }
      : null,
    savedDrafts: drafts.map((d) => ({
      clientId: d.clientId, name: d.name, label: d.label, snapshot: d.snapshot, savedAt: d.savedAt.getTime(),
    })),
    favProducts: favs.map((f) => ({ tileKey: f.tileKey, addedAt: f.addedAt.getTime() })),
    stars: {
      dealer: stars.filter((s) => s.list === "dealer").slice(0, MAX_STARS_PER_LIST).map(toStar),
      shipto: stars.filter((s) => s.list === "shipto").slice(0, MAX_STARS_PER_LIST).map(toStar),
    },
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// ── Live draft — one row per SO, optimistic concurrency on `revision` ──────

export type LiveDraftResult =
  | { ok: true; revision: number }
  | { ok: false; conflict: true; revision: number | null };

/**
 * expectedRevision = the revision this device last saw (null = it believes
 * there is no row). A mismatch is a 409: another device wrote in between, and
 * this device must not silently overwrite it.
 */
export async function putLiveDraft(
  soId: number, snapshot: SnapshotJson, expectedRevision: number | null, deviceId: string | null,
): Promise<LiveDraftResult> {
  if (expectedRevision === null) {
    try {
      const row = await prisma.so_live_drafts.create({
        data: { salesOfficerId: soId, snapshot, deviceId },
        select: { revision: true },
      });
      return { ok: true, revision: row.revision };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const cur = await prisma.so_live_drafts.findUnique({ where: { salesOfficerId: soId }, select: { revision: true } });
      return { ok: false, conflict: true, revision: cur?.revision ?? null };
    }
  }
  const upd = await prisma.so_live_drafts.updateMany({
    where: { salesOfficerId: soId, revision: expectedRevision },
    data: { snapshot, deviceId, revision: { increment: 1 } },
  });
  if (upd.count === 1) return { ok: true, revision: expectedRevision + 1 };
  const cur = await prisma.so_live_drafts.findUnique({ where: { salesOfficerId: soId }, select: { revision: true } });
  return { ok: false, conflict: true, revision: cur?.revision ?? null };
}

/** Empty order → no row. Idempotent. */
export async function deleteLiveDraft(soId: number): Promise<void> {
  await prisma.so_live_drafts.deleteMany({ where: { salesOfficerId: soId } });
}

// ── Saved drafts — upsert by (SO, clientId), keep the 20 newest ───────────

export async function upsertSavedDraft(
  soId: number,
  clientId: string,
  d: { name: string | null; label: string; snapshot: SnapshotJson; savedAt: Date },
): Promise<void> {
  await prisma.so_saved_drafts.upsert({
    where: { salesOfficerId_clientId: { salesOfficerId: soId, clientId } },
    create: { salesOfficerId: soId, clientId, name: d.name, label: d.label, snapshot: d.snapshot, savedAt: d.savedAt },
    update: { name: d.name, label: d.label, snapshot: d.snapshot, savedAt: d.savedAt },
  });
  // Trim: anything past the 20 newest goes (as /po2's upsertSavedDraft slices).
  const extra = await prisma.so_saved_drafts.findMany({
    where: { salesOfficerId: soId },
    orderBy: { savedAt: "desc" },
    skip: MAX_SAVED_DRAFTS,
    select: { id: true },
  });
  if (extra.length > 0) {
    await prisma.so_saved_drafts.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  }
}

/** null name = remove the name. Returns false if the draft does not exist. */
export async function renameSavedDraft(soId: number, clientId: string, name: string | null): Promise<boolean> {
  const upd = await prisma.so_saved_drafts.updateMany({
    where: { salesOfficerId: soId, clientId },
    data: { name },
  });
  return upd.count > 0;
}

export async function deleteSavedDraft(soId: number, clientId: string): Promise<void> {
  await prisma.so_saved_drafts.deleteMany({ where: { salesOfficerId: soId, clientId } });
}

// ── Favourite tiles — cap 8, the 9th REFUSED ───────────────────────────────

export async function addFavProduct(soId: number, tileKey: string): Promise<"added" | "full"> {
  const have = await prisma.so_fav_products.findMany({
    where: { salesOfficerId: soId },
    select: { tileKey: true },
  });
  if (have.some((f) => f.tileKey === tileKey)) return "added"; // idempotent
  if (have.length >= MAX_FAV_PRODUCTS) return "full";
  try {
    await prisma.so_fav_products.create({ data: { salesOfficerId: soId, tileKey } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err; // a double tap — already there
  }
  return "added";
}

export async function removeFavProduct(soId: number, tileKey: string): Promise<void> {
  await prisma.so_fav_products.deleteMany({ where: { salesOfficerId: soId, tileKey } });
}

// ── Stars — two lists, 200 each ────────────────────────────────────────────

export async function setStar(
  soId: number,
  list: "dealer" | "shipto",
  c: { customerCode: string; name: string; area: string | null },
  starred: boolean,
): Promise<"ok" | "full"> {
  if (!starred) {
    await prisma.so_starred_dealers.deleteMany({
      where: { salesOfficerId: soId, list, customerCode: c.customerCode },
    });
    return "ok";
  }
  const count = await prisma.so_starred_dealers.count({ where: { salesOfficerId: soId, list } });
  if (count >= MAX_STARS_PER_LIST) {
    const already = await prisma.so_starred_dealers.findFirst({
      where: { salesOfficerId: soId, list, customerCode: c.customerCode },
      select: { id: true },
    });
    return already ? "ok" : "full";
  }
  // INSERT … ON CONFLICT DO NOTHING (so_starred_dealers_so_list_code_key).
  await prisma.so_starred_dealers.createMany({
    data: [{ salesOfficerId: soId, list, customerCode: c.customerCode, name: c.name, area: c.area }],
    skipDuplicates: true,
  });
  return "ok";
}
