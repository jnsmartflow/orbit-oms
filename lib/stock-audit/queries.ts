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
// 🔴 BLIND COUNT. The counter-side reads (getMyOpenAudits, getMyLines) are
// always narrowed to the session user's own rows. Nothing a counter can call
// returns another person's lines, a cross-counter total, or an expected qty.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { checkAnyPermissionForUser } from "@/lib/permissions";
import { effectiveRoleSlugs } from "@/lib/access/role-baseline";
import { formatPack } from "@/lib/place-order/pack";
import { formatWorking } from "./calc";
import { COUNT_MODE, STOCK_AUDIT_STATUS, type CountMode, type StockAuditStatus } from "./status";
// 🔴 `import type` — load-bearing (the lib/ci/queries.ts rule). A plain import
// would pull the `xlsx` bundle into every stock-audit route's module graph.
import type { StockAuditRegisterRow } from "./workbook";
import type {
  AssignableUser,
  AuditDetail,
  AuditListItem,
  AuditMarker,
  CountLine,
  CounterProgress,
  MyAudit,
  SkuHit,
  SkuLedger,
  SkuSummaryRow,
} from "./types";

// ── Material + catalog ────────────────────────────────────────────────────────

/** A tagged duplicate ("12345-…") — excluded from search and resolution; all 19
 *  live ones have a plain twin (Smart Flow, 2026-11-02). */
const TAGGED_CODE = /^[0-9]+-/;

/** Trimmed + upper-cased — the shape chk_stock_audit_lines_material demands. */
export function normaliseMaterial(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().toUpperCase();
  // A SAP code: letters, digits and '-', at most 40. Keeps free-typed
  // not-in-catalog codes sane without guessing at SAP's format.
  if (!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(m)) return null;
  return m;
}

/** Catalog snapshot for one material, or null when it is not an active,
 *  untagged catalog code. Matches on `material` ONLY. */
export async function resolveCatalogMaterial(
  material: string,
): Promise<{ description: string; pack: string } | null> {
  if (TAGGED_CODE.test(material)) return null;
  const row = await prisma.sku_master_v2.findUnique({
    where: { material },
    select: { description: true, packCode: true, unit: true, isActive: true },
  });
  if (!row || !row.isActive) return null;
  const description = row.description.trim();
  if (description === "") return null; // chk_stock_audit_lines_catalog would refuse it
  return { description, pack: formatPack(row.packCode, row.unit) };
}

/** SKU search: q CONTAINED in material, active, untagged, isPrimary first, ≤ 20. */
export async function searchSkus(q: string): Promise<SkuHit[]> {
  const rows = await prisma.sku_master_v2.findMany({
    where: { isActive: true, material: { contains: q } },
    orderBy: [{ isPrimary: "desc" }, { material: "asc" }],
    // Over-fetch so dropping tagged codes (≤ 19 exist) never starves the 20.
    take: 60,
    select: { material: true, description: true, packCode: true, unit: true, piecesPerCarton: true },
  });
  return rows
    .filter((r) => !TAGGED_CODE.test(r.material))
    .slice(0, 20)
    .map((r) => {
      const ppc = typeof r.piecesPerCarton === "number" && r.piecesPerCarton > 0 ? r.piecesPerCarton : null;
      return {
        material: r.material,
        description: r.description,
        pack: formatPack(r.packCode, r.unit),
        piecesPerCarton: ppc,
        defaultMode: ppc !== null ? COUNT_MODE.cartons : COUNT_MODE.pieces,
      };
    });
}

// ── Lines → wire ─────────────────────────────────────────────────────────────

const LINE_SELECT = {
  id: true,
  auditId: true,
  material: true,
  inCatalog: true,
  skuDescription: true,
  skuPack: true,
  mode: true,
  stack: true,
  rows: true,
  depth: true,
  pcsPerCarton: true,
  loose: true,
  totalPcs: true,
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
  mode: string;
  stack: number;
  rows: number;
  depth: number;
  pcsPerCarton: number | null;
  loose: number;
  totalPcs: number;
  createdAt: Date;
  updatedAt: Date;
};

function workingOf(r: { mode: string; stack: number; rows: number; depth: number; pcsPerCarton: number | null; loose: number }): string {
  return formatWorking({
    mode: r.mode as CountMode,
    stack: r.stack,
    rows: r.rows,
    depth: r.depth,
    pcsPerCarton: r.pcsPerCarton,
    loose: r.loose,
  });
}

export function toCountLine(r: LineRow): CountLine {
  return {
    id: r.id,
    auditId: r.auditId,
    material: r.material,
    inCatalog: r.inCatalog,
    skuDescription: r.skuDescription,
    skuPack: r.skuPack,
    mode: r.mode as CountMode,
    stack: r.stack,
    rows: r.rows,
    depth: r.depth,
    pcsPerCarton: r.pcsPerCarton,
    loose: r.loose,
    totalPcs: r.totalPcs,
    working: workingOf(r),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export { LINE_SELECT };

// ── Counter reads (always narrowed to the session user) ─────────────────────

export async function getMyOpenAudits(userId: number): Promise<MyAudit[]> {
  const rows = await prisma.stockAuditCounter.findMany({
    where: { userId, audit: { status: STOCK_AUDIT_STATUS.open } },
    select: { audit: { select: { id: true, auditNumber: true, createdAt: true } } },
    orderBy: { audit: { createdAt: "desc" } },
  });
  const ids = rows.map((r) => r.audit.id);
  const counts =
    ids.length > 0
      ? await prisma.stockAuditLine.groupBy({
          by: ["auditId"],
          where: { auditId: { in: ids }, countedById: userId, isRemoved: false },
          _count: { _all: true },
        })
      : [];
  const byAudit = new Map(counts.map((c) => [c.auditId, c._count._all]));
  return rows.map((r) => ({
    id: r.audit.id,
    auditNumber: r.audit.auditNumber,
    createdAt: r.audit.createdAt.toISOString(),
    myLines: byAudit.get(r.audit.id) ?? 0,
  }));
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
      _count: { select: { counters: true } },
    },
  });
  const ids = audits.map((a) => a.id);
  const lineCounts =
    ids.length > 0
      ? await prisma.stockAuditLine.groupBy({
          by: ["auditId"],
          where: { auditId: { in: ids }, isRemoved: false },
          _count: { _all: true },
        })
      : [];
  const byAudit = new Map(lineCounts.map((c) => [c.auditId, c._count._all]));
  return audits.map((a) => ({
    id: a.id,
    auditNumber: a.auditNumber,
    status: a.status as StockAuditStatus,
    createdAt: a.createdAt.toISOString(),
    closedAt: a.closedAt ? a.closedAt.toISOString() : null,
    createdByName: a.createdBy.name,
    counters: a._count.counters,
    lines: byAudit.get(a.id) ?? 0,
  }));
}

/** Header + stats + SKU summary (optionally filtered by q) + per-counter progress. */
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

  const counters = await prisma.stockAuditCounter.findMany({
    where: { auditId },
    select: { userId: true, user: { select: { name: true } } },
  });
  const lines = await prisma.stockAuditLine.findMany({
    where: { auditId, isRemoved: false },
    select: {
      material: true,
      inCatalog: true,
      skuDescription: true,
      skuPack: true,
      totalPcs: true,
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
        totalPcs: l.totalPcs,
        lines: 1,
      });
    } else {
      row.totalPcs += l.totalPcs;
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

  // Progress — every assigned counter, plus anyone taken off who still has lines.
  const progress = new Map<number, CounterProgress>();
  for (const c of counters) {
    progress.set(c.userId, { userId: c.userId, name: c.user.name, assigned: true, lines: 0, pieces: 0, lastEntryAt: null });
  }
  const lastAt = new Map<number, number>();
  for (const l of lines) {
    let p = progress.get(l.countedById);
    if (!p) {
      p = { userId: l.countedById, name: "", assigned: false, lines: 0, pieces: 0, lastEntryAt: null };
      progress.set(l.countedById, p);
    }
    p.lines += 1;
    p.pieces += l.totalPcs;
    const t = Math.max(l.createdAt.getTime(), l.updatedAt.getTime());
    if (t > (lastAt.get(l.countedById) ?? 0)) lastAt.set(l.countedById, t);
  }
  const unnamed = Array.from(progress.values()).filter((p) => !p.assigned).map((p) => p.userId);
  if (unnamed.length > 0) {
    const users = await prisma.users.findMany({ where: { id: { in: unnamed } }, select: { id: true, name: true } });
    for (const u of users) {
      const p = progress.get(u.id);
      if (p) p.name = u.name;
    }
  }
  for (const [uid, t] of Array.from(lastAt)) {
    const p = progress.get(uid);
    if (p) p.lastEntryAt = new Date(t).toISOString();
  }
  const progressRows = Array.from(progress.values()).sort(
    (a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name),
  );

  const assignedIds = new Set(counters.map((c) => c.userId));
  const activeAssigned = new Set(lines.map((l) => l.countedById).filter((id) => assignedIds.has(id)));

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
      pieces: lines.reduce((s, l) => s + l.totalPcs, 0),
      lines: lines.length,
      countersActive: activeAssigned.size,
      counters: counters.length,
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
      mode: true,
      stack: true,
      rows: true,
      depth: true,
      pcsPerCarton: true,
      loose: true,
      totalPcs: true,
      countedById: true,
      countedBy: { select: { name: true } },
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
      mode: r.mode as CountMode,
      working: workingOf(r),
      totalPcs: r.totalPcs,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    totalPcs: rows.reduce((s, r) => s + r.totalPcs, 0),
  };
}

/**
 * The desk's cheap change marker { count, latest }.
 *   count  = live lines + assigned counters — an add or a removal moves it, and
 *            so does taking a counter off (no timestamp would).
 *   latest = MAX of every line's updatedAt (⚠ REMOVED lines included, on
 *            purpose — the soft delete stamps updatedAt), the newest counter's
 *            addedAt, and the audit row's updatedAt (close).
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
  const counters = await prisma.stockAuditCounter.aggregate({
    where: { auditId },
    _count: { _all: true },
    _max: { addedAt: true },
  });
  const stamps = [audit.updatedAt, allLines._max.updatedAt, counters._max.addedAt]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  return {
    count: liveLines + counters._count._all,
    latest: stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : null,
  };
}

/** One row per SKU for the XLS, live lines only, sorted by material. */
export async function getRegisterRows(auditId: number): Promise<StockAuditRegisterRow[]> {
  const lines = await prisma.stockAuditLine.findMany({
    where: { auditId, isRemoved: false },
    orderBy: { createdAt: "asc" },
    select: { material: true, skuDescription: true, skuPack: true, totalPcs: true },
  });
  const map = new Map<string, StockAuditRegisterRow>();
  for (const l of lines) {
    const row = map.get(l.material);
    if (!row) {
      map.set(l.material, {
        material: l.material,
        description: l.skuDescription,
        pack: l.skuPack,
        totalPcs: l.totalPcs,
        lines: 1,
      });
    } else {
      row.totalPcs += l.totalPcs;
      row.lines += 1;
      if (l.skuDescription !== null) row.description = l.skuDescription;
      if (l.skuPack !== null) row.pack = l.skuPack;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.material.localeCompare(b.material));
}

// ── Who may be assigned as a counter ─────────────────────────────────────────

/**
 * Active users who would pass `stock_audit_count` canView — asked through
 * checkAnyPermissionForUser, the SAME resolver body checkAnyPermission runs
 * (admin role → superuser flag → user_page_access in user mode, or the role
 * path). Never a hand-rolled permission query. One call per active user,
 * sequential (≈40 users; each is a single indexed read, or a notebook hit).
 */
export async function getAssignableUsers(): Promise<AssignableUser[]> {
  const users = await prisma.users.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      isSuperuser: true,
      role: { select: { name: true } },
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });
  const out: AssignableUser[] = [];
  for (const u of users) {
    const ok = await checkAnyPermissionForUser(
      { userId: u.id, roleSlugs: effectiveRoleSlugs(u), isSuperuser: u.isSuperuser },
      "stock_audit_count",
      "canView",
    );
    if (ok) out.push({ id: u.id, name: u.name });
  }
  return out;
}
