// lib/billing/telephonic.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// BILLING · TELEPHONIC — the tag list, add / remove, and the live-sync marker
// ═══════════════════════════════════════════════════════════════════════════
//
// A telephonic order has no mail order, so billing types its SO number here
// with a tag — Hold or CI (so_tags). The import applies live tags when the OBD
// lands (lib/billing/telephonic-apply.ts). ALL the tab's server logic lives in
// this file; the four /api/billing/telephonic/* routes are thin wrappers that
// gate on `billing_telephonic` and pass the session user id in.
//
// Design: docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md.
//
// 🔴 "EXPIRED" IS DERIVED, NEVER STORED: status 'waiting' AND expiresAt <= now.
// The CHECK on so_tags.status refuses 'expired'.
//
// 🔴 LIST AND MARKER SHARE THE WHERE BUILDERS BELOW. A marker watching a
// narrower set than the list misses updates (CLAUDE_CI.md §13 CI-10,
// CLAUDE_PICKING.md §10). The waiting band is ALL DATES, never month-fenced —
// the billing Picking tab once rendered empty over a real backlog.
//
// Reads are batched — never a query per row. Sequential awaits, never
// prisma.$transaction (CORE §3).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applySoTagHolds, type SoTagApplySummary } from "@/lib/billing/telephonic-apply";
import { currentIstMonth, normaliseSoNumber } from "@/lib/billing/telephonic-so";

/** Days a tag waits for its OBD before it expires. THE ONLY PLACE THE 15 LIVES. */
export const TELEPHONIC_TAG_TTL_DAYS = 15;

export const TELEPHONIC_TAGS = ["hold", "ci"] as const;
export type TelephonicTagKind = (typeof TELEPHONIC_TAGS)[number];

export type TelephonicTagState = "waiting" | "matched" | "expired";

// ── The SO number rule ───────────────────────────────────────────────────────

// Lives in lib/billing/telephonic-so.ts (pure) so the client entry bar imports
// the SAME rule. Re-exported here for server callers.
export { currentIstMonth, normaliseSoNumber };

// ── Shared WHERE builders (list AND marker) ──────────────────────────────────

/** A LIVE tag: the import will still apply it. Waiting OR matched — a matched
 *  tag keeps catching further OBDs on the same SO until it expires. */
export function liveTagWhere(now: Date): Prisma.so_tagsWhereInput {
  return { isRemoved: false, expiresAt: { gt: now }, status: { in: ["waiting", "matched"] } };
}

/** The WAITING band — ALL DATES, never month-fenced. */
export function waitingTagWhere(now: Date): Prisma.so_tagsWhereInput {
  return { isRemoved: false, status: "waiting", expiresAt: { gt: now } };
}

/** The MONTH band — everything not in the waiting band, added in the IST month. */
export function monthTagWhere(range: { start: Date; end: Date }, now: Date): Prisma.so_tagsWhereInput {
  return {
    isRemoved: false,
    addedAt: { gte: range.start, lt: range.end },
    NOT: waitingTagWhere(now),
  };
}

/** `YYYY-MM` → the IST month as a UTC instant range, or null when malformed. */
export function istMonthRange(month: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return {
    start: new Date(`${month}-01T00:00:00+05:30`),
    end: new Date(`${next}-01T00:00:00+05:30`),
  };
}


export function deriveTagState(t: { status: string; expiresAt: Date }, now: Date): TelephonicTagState {
  if (t.status === "matched") return "matched";
  return t.expiresAt.getTime() > now.getTime() ? "waiting" : "expired";
}

// ── The list ─────────────────────────────────────────────────────────────────

export interface TelephonicCi {
  ciId: number;
  ciNumber: string | null;
  status: string;
  sapCiNumber: string | null;
  source: string;
}

export interface TelephonicBill {
  orderId: number;
  obdNumber: string;
  /** The billing Picking list's rule: ship-to override first, then SAP's name. */
  customerName: string | null;
  /** LIVE off the order — SAP may send it after the tag was applied. */
  invoiceNo: string | null;
  /** LIVE — so a bill that is not actually held (Floor released it, or the
   *  hold failed) is visible on the tab. */
  dispatchStatus: string | null;
  workflowStage: string;
  isRemoved: boolean;
  appliedAt: string;
  /** Why the tag was not fully applied — auto-CI refused, hold failed, bill
   *  already dispatched / removed / cancelled. Null when fully applied. */
  ciSkipReason: string | null;
  /** Any live non-draft CI on the bill, whoever raised it (a hand-raised one
   *  shows too). The earliest if there are several. */
  ci: TelephonicCi | null;
}

export interface TelephonicRow {
  id: number;
  soNumber: string;
  tag: string;
  state: TelephonicTagState;
  addedByName: string | null;
  addedAt: string;
  matchedAt: string | null;
  expiresAt: string;
  bills: TelephonicBill[];
}

export interface TelephonicList {
  /** ALL DATES — never month-fenced. */
  waiting: TelephonicRow[];
  /** Settled rows (matched or expired) added in the requested IST month. */
  month: TelephonicRow[];
}

const TAG_SELECT = {
  id: true, soNumber: true, tag: true, status: true, addedById: true,
  addedAt: true, matchedAt: true, expiresAt: true,
} as const;

/**
 * Both bands for one IST month. Five batched reads: tags → their matches →
 * those orders → CIs on those orders → user names.
 */
export async function listTelephonic(month: string, now: Date): Promise<TelephonicList> {
  const range = istMonthRange(month);
  if (range === null) throw new Error(`Invalid month "${month}" — expected YYYY-MM`);

  const waitingTags = await prisma.so_tags.findMany({
    where: waitingTagWhere(now), select: TAG_SELECT, orderBy: { addedAt: "desc" },
  });
  const monthTags = await prisma.so_tags.findMany({
    where: monthTagWhere(range, now), select: TAG_SELECT, orderBy: { addedAt: "desc" },
  });
  const tags = [...waitingTags, ...monthTags];
  if (tags.length === 0) return { waiting: [], month: [] };

  // Matches for BOTH bands: a tag still 'waiting' can carry a match when its
  // hold failed, and that bill must be visible.
  const matches = await prisma.so_tag_matches.findMany({
    where: { soTagId: { in: tags.map((t) => t.id) } },
    select: { soTagId: true, orderId: true, obdNumber: true, appliedAt: true, ciSkipReason: true },
    orderBy: { appliedAt: "asc" },
  });
  const orderIds = Array.from(new Set(matches.map((m) => m.orderId)));

  const orders = orderIds.length === 0 ? [] : await prisma.orders.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true, invoiceNo: true, dispatchStatus: true, workflowStage: true, isRemoved: true,
      shipToCustomerName: true,
      shipToOverrideCustomer: { select: { customerName: true } },
    },
  });
  const cis = orderIds.length === 0 ? [] : await prisma.ci_returns.findMany({
    where: { orderId: { in: orderIds }, isVoided: false, status: { not: "draft" } },
    select: { id: true, orderId: true, ciNumber: true, status: true, sapCiNumber: true, source: true },
    orderBy: { id: "asc" },
  });
  const users = await prisma.users.findMany({
    where: { id: { in: Array.from(new Set(tags.map((t) => t.addedById))) } },
    select: { id: true, name: true },
  });

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const ciByOrder = new Map<number, (typeof cis)[number]>();
  for (const c of cis) if (!ciByOrder.has(c.orderId)) ciByOrder.set(c.orderId, c);
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const matchesByTag = new Map<number, typeof matches>();
  for (const m of matches) {
    const arr = matchesByTag.get(m.soTagId) ?? [];
    arr.push(m);
    matchesByTag.set(m.soTagId, arr);
  }

  const toRow = (t: (typeof tags)[number]): TelephonicRow => ({
    id: t.id,
    soNumber: t.soNumber,
    tag: t.tag,
    state: deriveTagState(t, now),
    addedByName: nameById.get(t.addedById) ?? null,
    addedAt: t.addedAt.toISOString(),
    matchedAt: t.matchedAt ? t.matchedAt.toISOString() : null,
    expiresAt: t.expiresAt.toISOString(),
    bills: (matchesByTag.get(t.id) ?? []).map((m): TelephonicBill => {
      const o = orderById.get(m.orderId);
      const ci = ciByOrder.get(m.orderId);
      return {
        orderId: m.orderId,
        obdNumber: m.obdNumber,
        customerName: o ? (o.shipToOverrideCustomer?.customerName ?? o.shipToCustomerName) : null,
        invoiceNo: o?.invoiceNo ?? null,
        dispatchStatus: o?.dispatchStatus ?? null,
        workflowStage: o?.workflowStage ?? "",
        isRemoved: o?.isRemoved ?? false,
        appliedAt: m.appliedAt.toISOString(),
        ciSkipReason: m.ciSkipReason,
        ci: ci
          ? { ciId: ci.id, ciNumber: ci.ciNumber, status: ci.status, sapCiNumber: ci.sapCiNumber, source: ci.source }
          : null,
      };
    }),
  });

  return { waiting: waitingTags.map(toRow), month: monthTags.map(toRow) };
}

// ── Add ──────────────────────────────────────────────────────────────────────

export type AddTelephonicResult =
  | {
      ok: true;
      tag: { id: number; soNumber: string; tag: TelephonicTagKind; expiresAt: string };
      /** Set when OBDs for this SO already existed and the tag was applied at
       *  once (the late-tag case); null otherwise. */
      applied: SoTagApplySummary | null;
    }
  | { ok: false; status: 400; error: string }
  | {
      ok: false;
      status: 409;
      error: string;
      existingTag: string;
      addedByName: string | null;
      addedAt: string;
    };

async function duplicateOf(soNumber: string): Promise<AddTelephonicResult | null> {
  const existing = await prisma.so_tags.findFirst({
    where: { soNumber, isRemoved: false },
    select: { tag: true, addedAt: true, addedBy: { select: { name: true } } },
  });
  if (existing === null) return null;
  return {
    ok: false,
    status: 409,
    error: `SO ${soNumber} is already tagged ${existing.tag === "ci" ? "CI" : "Hold"}. Remove it first to change the tag.`,
    existingTag: existing.tag,
    addedByName: existing.addedBy?.name ?? null,
    addedAt: existing.addedAt.toISOString(),
  };
}

/**
 * Add one tag.
 *   1. validate the SO number (normaliseSoNumber) and the tag → 400
 *   2. a non-removed row for that SO → 409 naming it (expired ones included:
 *      the partial unique index covers them, so "remove + re-add" is the way)
 *   3. insert, expiresAt = now + TELEPHONIC_TAG_TTL_DAYS; a P2002 from the
 *      partial unique index (two operators, same second) → the same 409
 *   4. LATE TAG — if OBDs for the SO already exist, apply the tag to them now
 *      through the same applySoTagHolds the import uses.
 */
export async function addTelephonicTag(args: {
  soNumber: string;
  tag: string;
  userId: number;
  now: Date;
}): Promise<AddTelephonicResult> {
  const soNumber = normaliseSoNumber(args.soNumber);
  if (soNumber === null) {
    return { ok: false, status: 400, error: "An SO number is 10 digits, e.g. 1046880241." };
  }
  if (!(TELEPHONIC_TAGS as readonly string[]).includes(args.tag)) {
    return { ok: false, status: 400, error: "Pick Hold or CI." };
  }
  const tag = args.tag as TelephonicTagKind;

  const dup = await duplicateOf(soNumber);
  if (dup !== null) return dup;

  let created: { id: number; expiresAt: Date };
  try {
    created = await prisma.so_tags.create({
      data: {
        soNumber,
        tag,
        addedById: args.userId,
        addedAt: args.now,
        expiresAt: new Date(args.now.getTime() + TELEPHONIC_TAG_TTL_DAYS * 86_400_000),
      },
      select: { id: true, expiresAt: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await duplicateOf(soNumber);
      if (raced !== null) return raced;
    }
    throw err;
  }

  // LATE TAG — the OBD may already be here (the tag is normally typed before
  // it). Same hook, same rules, never throws.
  const existing = await prisma.orders.findMany({
    where: { soNumber, isRemoved: false },
    select: { obdNumber: true },
  });
  const applied = existing.length === 0
    ? null
    : await applySoTagHolds(existing.map((o) => o.obdNumber), args.now);

  return {
    ok: true,
    tag: { id: created.id, soNumber, tag, expiresAt: created.expiresAt.toISOString() },
    applied,
  };
}

// ── Remove ───────────────────────────────────────────────────────────────────

export type RemoveTelephonicResult =
  | { ok: true; alreadyRemoved: boolean }
  | { ok: false; status: 404; error: string };

/**
 * Soft-remove a tag. Idempotent. Stops FUTURE OBDs from matching — it does NOT
 * release a held bill or void a CI; those stay Floor's and billing's jobs.
 */
export async function removeTelephonicTag(args: {
  id: number;
  userId: number;
  now: Date;
}): Promise<RemoveTelephonicResult> {
  const res = await prisma.so_tags.updateMany({
    where: { id: args.id, isRemoved: false },
    data: { isRemoved: true, removedAt: args.now, removedById: args.userId },
  });
  if (res.count > 0) return { ok: true, alreadyRemoved: false };

  const row = await prisma.so_tags.findUnique({ where: { id: args.id }, select: { id: true } });
  if (row === null) return { ok: false, status: 404, error: "Tag not found." };
  return { ok: true, alreadyRemoved: true };
}

// ── Marker ───────────────────────────────────────────────────────────────────

export interface TelephonicMarker {
  /** Waiting-live tags — the same set the waiting band renders. */
  count: number;
  /** The newest change across every source the list renders from. */
  latest: string | null;
  /** so_tag_matches has no updatedAt, so a match row edited in place (its
   *  ciSkipReason set after the claim) moves only these two. The client must
   *  compare ALL FOUR fields, not just count + latest. */
  matchCount: number;
  skipReasonCount: number;
  /** `${matchCount}:${skipReasonCount}` — the same two numbers as one token,
   *  in the field usePickingMarker compares (lib/hooks/use-picking-marker.ts),
   *  so the shared hook refetches when EITHER moves. */
  signature: string;
}

/**
 * The cheap "has anything changed?" probe. Its sets are SUPERSETS of what the
 * list renders — never narrower (CI-10):
 *   count           COUNT over waitingTagWhere — the waiting band's own predicate
 *   latest          MAX of so_tags.updatedAt (every tag), so_tag_matches.appliedAt,
 *                   orders.updatedAt of every matched bill (live dispatchStatus /
 *                   invoiceNo), ci_returns.updatedAt on those bills (a CI raised,
 *                   closed or given its SAP number)
 *   matchCount / skipReasonCount — see TelephonicMarker.
 * READ-ONLY: it adds no write, ever.
 */
export async function getTelephonicMarker(now: Date): Promise<TelephonicMarker> {
  const count = await prisma.so_tags.count({ where: waitingTagWhere(now) });
  const tagMax = await prisma.so_tags.aggregate({ _max: { updatedAt: true } });
  const matchAgg = await prisma.so_tag_matches.aggregate({ _max: { appliedAt: true }, _count: true });
  const skipReasonCount = await prisma.so_tag_matches.count({ where: { ciSkipReason: { not: null } } });

  const matchedOrderIds = (
    await prisma.so_tag_matches.findMany({ select: { orderId: true }, distinct: ["orderId"] })
  ).map((m) => m.orderId);
  let orderMax: Date | null = null;
  let ciMax: Date | null = null;
  if (matchedOrderIds.length > 0) {
    orderMax = (await prisma.orders.aggregate({
      where: { id: { in: matchedOrderIds } }, _max: { updatedAt: true },
    }))._max.updatedAt;
    ciMax = (await prisma.ci_returns.aggregate({
      where: { orderId: { in: matchedOrderIds } }, _max: { updatedAt: true },
    }))._max.updatedAt;
  }

  const stamps = [tagMax._max.updatedAt, matchAgg._max.appliedAt, orderMax, ciMax]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  return {
    count,
    latest: stamps.length === 0 ? null : new Date(Math.max(...stamps)).toISOString(),
    matchCount: matchAgg._count,
    skipReasonCount,
    signature: `${matchAgg._count}:${skipReasonCount}`,
  };
}
