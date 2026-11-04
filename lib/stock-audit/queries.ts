// lib/stock-audit/queries.ts — every read (and the catalog resolver) behind
// /api/stock-count/* and /api/stock-audit/*. Server-only.
//
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ SKUs ARE RESOLVED BY `sku_master_v2.material` AND NOTHING ELSE.
// ═══════════════════════════════════════════════════════════════════════════
// Never a catalog row id. `sku_master` and `sku_master_v2` assign COMPLETELY
// DIFFERENT ids to the same material code (zero overlap, verified against
// production — CORE §13, the id-space landmine). A stock-audit line stores the
// SAP code exactly as typed (trimmed, upper-cased) plus a SNAPSHOT of the
// description and pack, and has NO foreign key to the catalog at all. This is
// the fourth module resolver to carry this warning (picking, MRN, CI); keep it.
//
// 🔴 REMOVED LINES ARE EXCLUDED FROM EVERYTHING — my lines, counts, summary,
// ledger, progress, stats, export. Every lines read below filters
// isRemoved: false. The ONE exception is getAuditMarker, which must see a
// removal move (its count and MAX(updatedAt) include removed rows on purpose).
//
// 🔴 BLIND COUNT. The counter-side reads (getOpenAudit, getMyLines) are
// always narrowed to the session user's own rows. Nothing a counter can call
// returns another person's lines, a cross-counter total, or an expected qty.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { formatPack } from "@/lib/place-order/pack";
import { STOCK_AUDIT_STATUS, type StockAuditStatus } from "./status";
import { TAGGED_CODE } from "./sku-search";
// 🔴 `import type` — load-bearing (the lib/ci/queries.ts rule). A plain import
// would pull the `xlsx` bundle into every stock-audit route's module graph.
import type { StockAuditRegisterRow } from "./workbook";
import type {
  AuditDetail,
  AuditListItem,
  AuditMarker,
  CountLine,
  CounterProgress,
  MyAudit,
  SkuLedger,
  SkuSummaryRow,
} from "./types";

// ── Material + catalog ────────────────────────────────────────────────────────

/** Trimmed + upper-cased — the shape chk_stock_audit_lines_material demands. */
export function normaliseMaterial(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().toUpperCase();
  // A SAP code: letters, digits and '-', at most 40. Keeps free-typed
  // not-in-catalog codes sane without guessing at SAP's format.
  if (!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(m)) return null;
  return m;
}

/** Catalog snapshot for one material, or null when it is not a
 *  untagged catalog code. Matches on `material` ONLY. */
export async function resolveCatalogMaterial(
  material: string,
): Promise<{ description: string; pack: string } | null> {
  if (TAGGED_CODE.test(material)) return null;
  const row = await prisma.sku_master_v2.findUnique({
    where: { material },
    // No isActive check (Smart Flow, 2026-11-04): an inactive code can still be
    // on the floor, and a count of it is a catalogued line with its snapshot.
    select: { description: true, packCode: true, unit: true },
  });
  if (!row) return null;
  const description = row.description.trim();
  if (description === "") return null; // chk_stock_audit_lines_catalog would refuse it
  return { description, pack: formatPack(row.packCode, row.unit) };
}

// ── Lines → wire ─────────────────────────────────────────────────────────────

const LINE_SELECT = {
  id: true,
  auditId: true,
  material: true,
  inCatalog: true,
  skuDescription: true,
  skuPack: true,
  qty: true,
  clientId: true,
  countedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type LineRow = {
  id: number;
  auditId: number;
  material: string;
  inCatalog: boolean;
  skuDescription: string | null;
  skuPack: string | null;
  qty: number;
  clientId: string | null;
  countedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toCountLine(r: LineRow): CountLine {
  return {
    id: r.id,
    auditId: r.auditId,
    material: r.material,
    inCatalog: r.inCatalog,
    skuDescription: r.skuDescription,
    skuPack: r.skuPack,
    qty: r.qty,
    clientId: r.clientId,
    countedAt: r.countedAt ? r.countedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export { LINE_SELECT };

// ── Counter reads (always narrowed to the session user) ─────────────────────

/**
 * THE open audit (open counting — at most one is open; newest first if a race
 * ever left two), with MY live line count. null when none is open.
 */
export async function getOpenAudit(userId: number): Promise<MyAudit | null> {
  const audit = await prisma.stockAudit.findFirst({
    where: { status: STOCK_AUDIT_STATUS.open },
    orderBy: { createdAt: "desc" },
    select: { id: true, auditNumber: true, createdAt: true },
  });
  if (!audit) return null;
  const myLines = await prisma.stockAuditLine.count({
    where: { auditId: audit.id, countedById: userId, isRemoved: false },
  });
  return {
    id: audit.id,
    auditNumber: audit.auditNumber,
    createdAt: audit.createdAt.toISOString(),
    myLines,
  };
}

/** MY live lines in one audit, newest first. */
export async function getMyLines(auditId: number, userId: number): Promise<CountLine[]> {
  const rows = await prisma.stockAuditLine.findMany({
    where: { auditId, countedById: userId, isRemoved: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: LINE_SELECT,
  });
  return rows.map(toCountLine);
}

// ── Desk reads ───────────────────────────────────────────────────────────────

export async function getAuditList(): Promise<AuditListItem[]> {
  const audits = await prisma.stockAudit.findMany({
    // Open first, then newest: 'open' > 'closed' as text, so status DESC.
    orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      auditNumber: true,
      status: true,
      createdAt: true,
      closedAt: true,
      createdBy: { select: { name: true } },
    },
  });
  const ids = audits.map((a) => a.id);
  // One row per (audit, person) with live lines → lines per audit AND people
  // who counted, in one query.
  const perPerson =
    ids.length > 0
      ? await prisma.stockAuditLine.groupBy({
          by: ["auditId", "countedById"],
          where: { auditId: { in: ids }, isRemoved: false },
          _count: { _all: true },
        })
      : [];
  const byAudit = new Map<number, number>();
  const people = new Map<number, number>();
  for (const c of perPerson) {
    byAudit.set(c.auditId, (byAudit.get(c.auditId) ?? 0) + c._count._all);
    people.set(c.auditId, (people.get(c.auditId) ?? 0) + 1);
  }
  return audits.map((a) => ({
    id: a.id,
    auditNumber: a.auditNumber,
    status: a.status as StockAuditStatus,
    createdAt: a.createdAt.toISOString(),
    closedAt: a.closedAt ? a.closedAt.toISOString() : null,
    createdByName: a.createdBy.name,
    counted: people.get(a.id) ?? 0,
    lines: byAudit.get(a.id) ?? 0,
  }));
}

/** Header + stats + SKU summary (optionally filtered by q) + per-person progress. */
export async function getAuditDetail(auditId: number, q: string | null): Promise<AuditDetail | null> {
  const audit = await prisma.stockAudit.findUnique({
    where: { id: auditId },
    select: {
      id: true,
      auditNumber: true,
      status: true,
      createdAt: true,
      closedAt: true,
      createdBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });
  if (!audit) return null;

  const lines = await prisma.stockAuditLine.findMany({
    where: { auditId, isRemoved: false },
    select: {
      material: true,
      inCatalog: true,
      skuDescription: true,
      skuPack: true,
      qty: true,
      countedById: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // SKU summary — the LATEST line's snapshot names the row (ordered asc above).
  const skuMap = new Map<string, SkuSummaryRow>();
  for (const l of lines) {
    const row = skuMap.get(l.material);
    if (!row) {
      skuMap.set(l.material, {
        material: l.material,
        description: l.skuDescription,
        pack: l.skuPack,
        inCatalog: l.inCatalog,
        qty: l.qty,
        lines: 1,
      });
    } else {
      row.qty += l.qty;
      row.lines += 1;
      if (l.skuDescription !== null) row.description = l.skuDescription;
      if (l.skuPack !== null) row.pack = l.skuPack;
      row.inCatalog = row.inCatalog || l.inCatalog;
    }
  }
  let skus = Array.from(skuMap.values()).sort((a, b) => a.material.localeCompare(b.material));
  const needle = q?.trim().toUpperCase() ?? "";
  if (needle !== "") {
    skus = skus.filter(
      (s) => s.material.includes(needle) || (s.description ?? "").toUpperCase().includes(needle),
    );
  }

  // Progress — one row per person with live lines (open counting: no list).
  const progress = new Map<number, CounterProgress>();
  const lastAt = new Map<number, number>();
  for (const l of lines) {
    let p = progress.get(l.countedById);
    if (!p) {
      p = { userId: l.countedById, name: "", lines: 0, pieces: 0, lastEntryAt: null };
      progress.set(l.countedById, p);
    }
    p.lines += 1;
    p.pieces += l.qty;
    const t = Math.max(l.createdAt.getTime(), l.updatedAt.getTime());
    if (t > (lastAt.get(l.countedById) ?? 0)) lastAt.set(l.countedById, t);
  }
  const personIds = Array.from(progress.keys());
  if (personIds.length > 0) {
    const users = await prisma.users.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } });
    for (const u of users) {
      const p = progress.get(u.id);
      if (p) p.name = u.name;
    }
  }
  for (const [uid, t] of Array.from(lastAt)) {
    const p = progress.get(uid);
    if (p) p.lastEntryAt = new Date(t).toISOString();
  }
  const progressRows = Array.from(progress.values()).sort((a, b) => a.name.localeCompare(b.name));

  return {
    audit: {
      id: audit.id,
      auditNumber: audit.auditNumber,
      status: audit.status as StockAuditStatus,
      createdAt: audit.createdAt.toISOString(),
      createdByName: audit.createdBy.name,
      closedAt: audit.closedAt ? audit.closedAt.toISOString() : null,
      closedByName: audit.closedBy?.name ?? null,
    },
    stats: {
      skus: skuMap.size,
      pieces: lines.reduce((s, l) => s + l.qty, 0),
      lines: lines.length,
      countersActive: progress.size,
    },
    skus,
    progress: progressRows,
  };
}

/** Every live line of one SKU in one audit, oldest first, with who counted it. */
export async function getSkuLedger(auditId: number, material: string): Promise<SkuLedger> {
  const rows = await prisma.stockAuditLine.findMany({
    where: { auditId, material, isRemoved: false },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      inCatalog: true,
      skuDescription: true,
      skuPack: true,
      qty: true,
      countedById: true,
      countedBy: { select: { name: true } },
      countedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  let description: string | null = null;
  let pack: string | null = null;
  let inCatalog = false;
  for (const r of rows) {
    if (r.skuDescription !== null) description = r.skuDescription;
    if (r.skuPack !== null) pack = r.skuPack;
    inCatalog = inCatalog || r.inCatalog;
  }
  return {
    material,
    description,
    pack,
    inCatalog,
    rows: rows.map((r) => ({
      lineId: r.id,
      countedById: r.countedById,
      countedByName: r.countedBy.name,
      qty: r.qty,
      countedAt: r.countedAt ? r.countedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    qty: rows.reduce((s, r) => s + r.qty, 0),
  };
}

/**
 * The desk's cheap change marker { count, latest }.
 *   count  = live lines — an add or a removal moves it.
 *   latest = MAX of every line's updatedAt (⚠ REMOVED lines included, on
 *            purpose — the soft delete stamps updatedAt) and the audit row's
 *            updatedAt (close).
 * An edit moves `latest`; nothing the screen shows can change without one of
 * the two moving.
 */
export async function getAuditMarker(auditId: number): Promise<AuditMarker | null> {
  const audit = await prisma.stockAudit.findUnique({ where: { id: auditId }, select: { updatedAt: true } });
  if (!audit) return null;
  const allLines = await prisma.stockAuditLine.aggregate({
    where: { auditId },
    _max: { updatedAt: true },
  });
  const liveLines = await prisma.stockAuditLine.count({ where: { auditId, isRemoved: false } });
  const stamps = [audit.updatedAt, allLines._max.updatedAt]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  return {
    count: liveLines,
    latest: stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : null,
  };
}

/** One row per SKU for the XLS, live lines only, sorted by material. */
export async function getRegisterRows(auditId: number): Promise<StockAuditRegisterRow[]> {
  const lines = await prisma.stockAuditLine.findMany({
    where: { auditId, isRemoved: false },
    orderBy: { createdAt: "asc" },
    select: { material: true, skuDescription: true, skuPack: true, qty: true },
  });
  const map = new Map<string, StockAuditRegisterRow>();
  for (const l of lines) {
    const row = map.get(l.material);
    if (!row) {
      map.set(l.material, {
        material: l.material,
        description: l.skuDescription,
        pack: l.skuPack,
        qty: l.qty,
        lines: 1,
      });
    } else {
      row.qty += l.qty;
      row.lines += 1;
      if (l.skuDescription !== null) row.description = l.skuDescription;
      if (l.skuPack !== null) row.pack = l.skuPack;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.material.localeCompare(b.material));
}
