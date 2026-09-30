// lib/tint/live-feed.ts — the SQL half of Tint's live-feed narrowing (tint step 3, 2026-09-30).
// Rules and why: lib/tint/live-feed-rule.ts. Plan: docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md §D.
//
// Each function is ONE parameterised statement over the changed ids (orders PK), with EXISTS probes on
// tint_assignments (tint_assignments_orderId_idx) and order_splits (9 rows at mint). Read-only.
//
// ⚠ The predicates MIRROR the two routes and must move with them:
//   Manager  — app/api/tint/manager/orders Sets A–E. Superset on purpose: hide rules are ignored (they only
//              narrow), Set B's stage list and Set E's "Base — No Tint" exclusion are dropped (both only
//              narrow), so "on board" here is never narrower than the board.
//   Operator — app/api/tint/operator/my-orders Queries 1–4, same superset rule (hide ignored).
// A bill LEAVING either set is covered by the client's `held` ids, not by these predicates.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import {
  decideTintManager,
  decideTintOperator,
  managerStartOfToday,
  operatorStartOfToday,
  type TintManagerDecision,
} from "@/lib/tint/live-feed-rule";

const OPEN_TINT_STAGES = ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"];
const ACTIVE_SPLIT_STATUSES = ["tint_assigned", "tinting_in_progress"];
// my-orders Query 1: the order's own stage (the same two words as the split statuses — a different column).
const OPERATOR_ORDER_STAGES = ["tint_assigned", "tinting_in_progress"];

/** Manager: which changed ids are on the board now + which have customerMissing. One statement. */
export async function classifyTintManager(
  ids: number[],
  held: readonly number[],
  missingHeld: readonly number[],
  now: Date = new Date(),
): Promise<TintManagerDecision> {
  if (ids.length === 0) return { keep: [], missingTouched: false };
  const start = managerStartOfToday(now);
  const rows = await prisma.$queryRaw<{ id: number; onBoard: boolean; missing: boolean }[]>`
    SELECT o.id,
           ( (o."orderType" = 'tint' AND o."isRemoved" = false
               AND o."workflowStage" IN (${Prisma.join(OPEN_TINT_STAGES)}))
          OR (o."isRemoved" = false AND EXISTS (
               SELECT 1 FROM tint_assignments a
                WHERE a."orderId" = o.id AND a.status = ${TINT_STATUS_DONE} AND a."completedAt" >= ${start}))
          OR (o."isRemoved" = false AND EXISTS (
               SELECT 1 FROM order_splits s
                WHERE s."orderId" = o.id
                  AND (s.status IN (${Prisma.join(ACTIVE_SPLIT_STATUSES)})
                       OR (s.status = ${TINT_STATUS_DONE} AND s."completedAt" >= ${start}))))
           ) AS "onBoard",
           o."customerMissing" AS missing
      FROM orders o
     WHERE o.id = ANY(${ids}::int[])`;
  return decideTintManager(ids, rows, held, missingHeld);
}

/** Operator face: changed ids in the session user's my-orders set now, or held. One statement. */
export async function filterTintOperatorOrderIds(
  ids: number[],
  userId: number,
  seesAll: boolean,
  held: readonly number[],
  now: Date = new Date(),
): Promise<number[]> {
  if (ids.length === 0) return [];
  const start = operatorStartOfToday(now);
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT o.id
      FROM orders o
     WHERE o.id = ANY(${ids}::int[])
       AND o."isRemoved" = false
       AND (
             (o."workflowStage" IN (${Prisma.join(OPERATOR_ORDER_STAGES)}) AND EXISTS (
               SELECT 1 FROM tint_assignments a
                WHERE a."orderId" = o.id AND (${seesAll} OR a."assignedToId" = ${userId})
                  AND a.status NOT IN ('done', 'skipped')))
          OR EXISTS (
               SELECT 1 FROM order_splits s
                WHERE s."orderId" = o.id AND (${seesAll} OR s."assignedToId" = ${userId})
                  AND s.status IN (${Prisma.join(ACTIVE_SPLIT_STATUSES)}))
          OR EXISTS (
               SELECT 1 FROM tint_assignments a
                WHERE a."orderId" = o.id AND (${seesAll} OR a."assignedToId" = ${userId})
                  AND a.status = ${TINT_STATUS_DONE} AND a."completedAt" >= ${start})
          OR EXISTS (
               SELECT 1 FROM order_splits s
                WHERE s."orderId" = o.id AND (${seesAll} OR s."assignedToId" = ${userId})
                  AND s.status IN (${TINT_STATUS_DONE}, 'pending_support', 'dispatch_confirmation', 'dispatched')
                  AND s."completedAt" >= ${start})
           )`;
  return decideTintOperator(ids, rows.map((r) => r.id), held);
}
