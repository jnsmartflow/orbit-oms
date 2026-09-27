import { prisma } from "@/lib/prisma";

/**
 * Which of these SO numbers are carried by MORE THAN ONE live order.
 *
 * The signal means "same SO, go check" — not "this is wrong". A supervisor
 * opens the flagged bills and decides which is the real one; nothing here
 * blocks, edits or ranks anything.
 *
 * ⚠ BOUNDED ON PURPOSE. It asks only about the SO numbers on the rows a board
 * is already returning (`soNumber: { in: [...] }`), never about the whole
 * table. Do NOT "improve" it into an unbounded `having: { _count: { gt: 1 } }`
 * scan across all ~11k orders: the boards call this on every fetch, and the
 * answer for a bill that is not on screen is not wanted.
 *
 * WHAT COUNTS AS A TWIN — `isRemoved: false` AND `workflowStage <> 'cancelled'`,
 * and NOTHING else:
 *   - a DISPATCHED or legacy-'closed' twin DOES count. A re-punch of a bill
 *     that already shipped is precisely the case this exists for, so the stage
 *     ladder is deliberately NOT fenced at rank < 100.
 *   - `isRemoved` is the soft-delete read rule (CORE §3); a removed OBD is not
 *     a live bill.
 *   - no `dispatchStatus` term and no hide exclusion — a bill held, un-slotted,
 *     or admin-hidden is still a real bill sharing this SO, and Picking applies
 *     no hide filter at all (CORE §13 / PICKING §7). Both boards therefore get
 *     the same answer for the same SO.
 *
 * ⚠ BLANK AND NULL ARE NEVER FLAGGED. `orders.soNumber` is nullable and Postgres
 * groups every NULL into ONE group — an unguarded call would come back with a
 * single enormous group and paint every un-punched bill as a duplicate. The
 * filter below drops null/whitespace-only values BEFORE they can reach the
 * `in` list, and the result loop re-checks for null so the flag can never be
 * set from a null-vs-null match.
 *
 * ⚠ MATCHES THE RAW STORED VALUE — no trim, no normalisation. `.trim()` below
 * is a BLANKNESS TEST only; the value put into the `in` list is the untouched
 * string. A stored SO carrying a stray leading/trailing space would therefore
 * not match its clean twin. Verified 2026-08-20 by a read-only count: ZERO live
 * rows have `soNumber <> btrim(soNumber)`, so no normalisation is warranted —
 * inventing one would be guessing at data that does not exist.
 *
 * Owner: Picking. Floor imports it, the same way it imports assign/unassign and
 * the sort rule objects (PICKING §3/§4, FLOOR §"Ownership boundary") — one
 * owner per behaviour, so the two surfaces can never disagree about what a
 * duplicate is.
 *
 * SELECT-only, ONE query, sequential await, never `prisma.$transaction`
 * (CORE §3). It is a POST-FETCH enrichment: it adds no term to
 * `buildPickingWhere` / `floorLiveBaseWhere` / `getFloorLiveMarkerWhere`, so
 * neither live-sync marker moves and no board's row set changes.
 */
export async function getDuplicateSoNumbers(
  soNumbers: (string | null)[],
): Promise<Set<string>> {
  // Non-null, non-blank, de-duplicated. The `in` list is the raw values.
  const candidates = Array.from(
    new Set(soNumbers.filter((s): s is string => s !== null && s.trim() !== "")),
  );

  // Never query with an empty `in` list.
  if (candidates.length === 0) return new Set<string>();

  const groups = await prisma.orders.groupBy({
    by: ["soNumber"],
    where: {
      soNumber: { in: candidates },
      isRemoved: false,
      workflowStage: { not: "cancelled" },
    },
    _count: { _all: true },
  });

  const duplicates = new Set<string>();
  for (const g of groups) {
    if (g.soNumber !== null && g._count._all > 1) duplicates.add(g.soNumber);
  }
  return duplicates;
}

// ═══════════════════════════════════════════════════════════════════════════
// Billing "Pick delete" (2026-09-27, build step 5) — the SAME rule with bill ids,
// and the All OK acknowledgement read. ADDITIVE: getDuplicateSoNumbers() above
// is deliberately untouched until build step 6 re-points it onto
// getDuplicateGroups() (docs/prompts/drafts/code-discovery-2026-09-27-pick-delete-build-plan.md §4).
//
// The RULE stays Picking's; Billing only WRITES pick_delete_decisions and reads
// its groups through these functions, so the three screens can never disagree
// about what a same-SO group is.
// ═══════════════════════════════════════════════════════════════════════════

/** Postgres bind-parameter headroom for the `in` lists below. */
const SO_CHUNK = 1000;

function nonBlankDistinct(soNumbers: (string | null)[]): string[] {
  return Array.from(
    new Set(soNumbers.filter((s): s is string => s !== null && s.trim() !== "")),
  );
}

/**
 * Every live bill id per SO — the twin rule of getDuplicateSoNumbers (not
 * removed, not cancelled; dispatched counts) — for the SO numbers asked about,
 * INCLUDING single-bill SOs. Ids sorted ascending. No acknowledgement filter:
 * the All OK and Pick delete writes re-check the live set against this.
 *
 * Bounded the same way: an `in` list of the SOs asked about, never a scan.
 * Sequential awaits per chunk, never prisma.$transaction (CORE §3).
 */
export async function getTwinIdsBySo(
  soNumbers: (string | null)[],
): Promise<Map<string, number[]>> {
  const candidates = nonBlankDistinct(soNumbers);
  const bySo = new Map<string, number[]>();
  for (let i = 0; i < candidates.length; i += SO_CHUNK) {
    const rows = await prisma.orders.findMany({
      where: {
        soNumber: { in: candidates.slice(i, i + SO_CHUNK) },
        isRemoved: false,
        workflowStage: { not: "cancelled" },
      },
      select: { id: true, soNumber: true },
    });
    for (const r of rows) {
      if (r.soNumber === null) continue;
      const list = bySo.get(r.soNumber);
      if (list) list.push(r.id);
      else bySo.set(r.soNumber, [r.id]);
    }
  }
  bySo.forEach((ids) => ids.sort((a, b) => a - b));
  return bySo;
}

/**
 * Is this group covered by an active All OK? Yes when EVERY current twin is in
 * one approved set (owner ruling 2026-09-27): a NEW bill joining the SO brings
 * the flag back; a twin that later leaves (cancelled / removed) does not. PURE.
 */
export function isAcknowledged(currentIds: readonly number[], ackSets: readonly (readonly number[])[]): boolean {
  return ackSets.some((ack) => currentIds.every((id) => ack.includes(id)));
}

/** Active (not undone) All OK sets per SO, for the SOs asked about. */
export async function getActiveAllOkSets(soNumbers: string[]): Promise<Map<string, number[][]>> {
  const bySo = new Map<string, number[][]>();
  for (let i = 0; i < soNumbers.length; i += SO_CHUNK) {
    const rows = await prisma.pick_delete_decisions.findMany({
      where: { kind: "all_ok", undoneAt: null, soNumber: { in: soNumbers.slice(i, i + SO_CHUNK) } },
      select: { soNumber: true, orderIds: true },
    });
    for (const r of rows) {
      const list = bySo.get(r.soNumber);
      if (list) list.push(r.orderIds);
      else bySo.set(r.soNumber, [r.orderIds]);
    }
  }
  return bySo;
}

/**
 * The flagged same-SO groups among these SO numbers: ≥ 2 live twins AND not
 * covered by an active All OK. SO → sorted bill ids. Two bounded reads; the
 * acknowledgement read runs only when a group exists.
 */
export async function getDuplicateGroups(
  soNumbers: (string | null)[],
): Promise<Map<string, number[]>> {
  const twins = await getTwinIdsBySo(soNumbers);
  const groups = new Map<string, number[]>();
  twins.forEach((ids, so) => {
    if (ids.length > 1) groups.set(so, ids);
  });
  if (groups.size === 0) return groups;

  const acks = await getActiveAllOkSets(Array.from(groups.keys()));
  acks.forEach((sets, so) => {
    const ids = groups.get(so);
    if (ids && isAcknowledged(ids, sets)) groups.delete(so);
  });
  return groups;
}
