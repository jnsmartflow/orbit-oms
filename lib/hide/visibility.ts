import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Hide feature (OBD visibility) — read-only / pure where-fragment builders.
//
// These produce Prisma `ordersWhereInput` fragments meant to be AND-merged into
// existing list queries. They DO NOT run the list query themselves and are not
// wired into any endpoint yet (that happens in a later phase).
//
// For queries that select splits / assignments rather than orders directly,
// apply the fragment THROUGH the relation, e.g.:
//   prisma.order_splits.findMany({ where: { order: { is: exclusion } } })
//   prisma.tint_assignments.findMany({ where: { order: { is: exclusion } } })
// where `exclusion = await getHideExclusion()`.
//
// V1 supports exactly two rule conditions; any other conditionTag/conditionType
// is silently skipped (never throws), so future rule kinds degrade safely.
// ─────────────────────────────────────────────────────────────────────────────

// Exact stored value of orders.dispatchStatus for a held OBD (lowercase).
// Source of truth: app/api/support/orders/[id]/hold/route.ts writes "hold".
const HOLD_DISPATCH_STATUS = "hold";

type HideRule = {
  id:              number;
  ruleName:        string;
  conditionType:   string;
  conditionTag:    string | null;
  conditionDaysGt: number | null;
  isActive:        boolean;
};

/** All currently active visibility rules. */
export async function getActiveHideRules(): Promise<HideRule[]> {
  return prisma.obd_visibility_rules.findMany({
    where: { isActive: true },
  });
}

/**
 * Translate a single active rule into an orders where-condition.
 * Returns null for unsupported / malformed rules so callers can skip them.
 */
function ruleToCondition(rule: HideRule): Prisma.ordersWhereInput | null {
  // Tag rule — only HOLD is supported in V1.
  if (rule.conditionType === "tag" && rule.conditionTag === "HOLD") {
    return { dispatchStatus: HOLD_DISPATCH_STATUS };
  }
  // Age rule — orders older than N days (by orderDateTime).
  if (rule.conditionType === "daysOld" && rule.conditionDaysGt != null) {
    const cutoff = new Date(Date.now() - rule.conditionDaysGt * 24 * 60 * 60 * 1000);
    return { orderDateTime: { lt: cutoff } };
  }
  return null;
}

/** Build the active-rule conditions list, dropping unsupported rules. */
async function getRuleConditions(): Promise<Prisma.ordersWhereInput[]> {
  const rules = await getActiveHideRules();
  return rules
    .map(ruleToCondition)
    .filter((c): c is Prisma.ordersWhereInput => c !== null);
}

/**
 * Translate a single active rule into a NULL-SAFE "keep" condition — the rows
 * this rule should NOT hide. Returns null for unsupported / malformed rules.
 *
 * Why not `NOT { match }`: dispatchStatus / orderDateTime are nullable. SQL
 * `NOT (col = x)` is UNKNOWN (≠ TRUE) when col IS NULL, so a plain NOT would
 * silently drop every null-column row, not just the matching ones. We instead
 * express the keep-set explicitly, always retaining NULL rows.
 */
function ruleToKeepCondition(rule: HideRule): Prisma.ordersWhereInput | null {
  // HOLD — keep everything that isn't actually on hold (incl. null status).
  if (rule.conditionType === "tag" && rule.conditionTag === "HOLD") {
    return {
      OR: [
        { dispatchStatus: null },
        { dispatchStatus: { not: HOLD_DISPATCH_STATUS } },
      ],
    };
  }
  // Age — keep everything not older than N days (incl. null orderDateTime).
  if (rule.conditionType === "daysOld" && rule.conditionDaysGt != null) {
    const cutoff = new Date(Date.now() - rule.conditionDaysGt * 24 * 60 * 60 * 1000);
    return {
      OR: [
        { orderDateTime: null },
        { orderDateTime: { gte: cutoff } },
      ],
    };
  }
  return null;
}

/**
 * EXCLUSION fragment — hides manually-hidden orders AND any order matching an
 * active rule. AND-merge this into list queries to drop hidden OBDs.
 *
 * NULL-safe: built as an AND of per-rule "keep" conditions, each of which
 * explicitly retains rows whose nullable column IS NULL. Avoids the
 * `NOT { OR }` trap where null-column rows evaluate to UNKNOWN and get dropped.
 *
 *   { AND: [ { isHidden: false }, ...keepConditions ] }
 *
 * When no rule conditions are active, returns simply `{ isHidden: false }`.
 */
export async function getHideExclusion(): Promise<Prisma.ordersWhereInput> {
  const rules = await getActiveHideRules();
  const keepConditions = rules
    .map(ruleToKeepCondition)
    .filter((c): c is Prisma.ordersWhereInput => c !== null);

  if (keepConditions.length === 0) {
    return { isHidden: false };
  }
  return {
    AND: [{ isHidden: false }, ...keepConditions],
  };
}

/**
 * INVERSE fragment — for the Hidden Orders admin list. Surfaces orders that are
 * manually hidden OR match an active rule.
 *
 *   { OR: [ { isHidden: true }, ...rule conditions... ] }
 *
 * The OR always carries at least the `{ isHidden: true }` member, so it is never
 * empty even when no rules are active.
 */
export async function getHiddenWhere(): Promise<Prisma.ordersWhereInput> {
  const conditions = await getRuleConditions();
  return {
    OR: [{ isHidden: true }, ...conditions],
  };
}

/**
 * In-memory single-rule matcher — the imperative twin of ruleToCondition.
 * Used to attribute WHY a (non-manually-hidden) order surfaces in the Hidden
 * Orders list, so the same rule logic lives in one place.
 *
 * orderDateTime is nullable in the DB; a daysOld rule can never match a null
 * timestamp, so we return false in that case.
 */
export function matchesRule(
  rule: HideRule,
  order: { dispatchStatus: string | null; orderDateTime: Date | null },
): boolean {
  if (rule.conditionType === "tag" && rule.conditionTag === "HOLD") {
    return order.dispatchStatus === HOLD_DISPATCH_STATUS;
  }
  if (rule.conditionType === "daysOld" && rule.conditionDaysGt != null) {
    if (!order.orderDateTime) return false;
    const cutoff = new Date(Date.now() - rule.conditionDaysGt * 24 * 60 * 60 * 1000);
    return order.orderDateTime < cutoff;
  }
  return false;
}
