import { prisma } from "@/lib/prisma";

/**
 * Which of these SO numbers are carried by MORE THAN ONE live order AND are
 * still undecided — i.e. not every current twin sits inside an active Billing
 * "All OK" set (pick_delete_decisions, 2026-09-27).
 *
 * The signal means "same SO, go check" — not "this is wrong". BILLING decides
 * (the Pick delete tab: All OK keeps every bill, Pick delete cancels one);
 * PICKING owns this rule, and Floor imports it. Nothing here blocks, edits or
 * ranks anything.
 *
 * WHEN THE FLAG CLEARS / COMES BACK:
 *   - All OK → cleared while every current twin is in that approved set.
 *   - a NEW bill joins the SO → it is not in the set → flagged again.
 *   - Pick delete → the bill is cancelled, so it is no longer a twin; the
 *     survivor clears by the twin rule alone (no decision read needed).
 *   - Undo of All OK → the set is no longer active → flagged again.
 *
 * ⚠ BOUNDED ON PURPOSE. It asks only about the SO numbers on the rows a board
 * is already returning (`soNumber: { in: [...] }`), never about the whole
 * table. Do NOT "improve" it into an unbounded `having: { _count: { gt: 1 } }`
 * scan across all ~16k orders: the boards call this on every fetch, and the
 * answer for a bill that is not on screen is not wanted. (Billing's Pick delete
 * read DOES need every open group — it no longer comes through here; see the
 * "ONE SQL COPY" note below.)
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
 * ⚠ BLANK AND NULL ARE NEVER FLAGGED. `orders.soNumber` is nullable, and an
 * unguarded read would lump every un-punched bill into ONE group and paint them
 * all as duplicates. nonBlankDistinct() drops null/whitespace-only values
 * BEFORE they can reach the `in` list, and getTwinIdsBySo() skips a null
 * soNumber, so the flag can never be set from a null-vs-null match.
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
 * SELECT-only, sequential awaits, never `prisma.$transaction` (CORE §3). At
 * most two bounded reads: the twins of the SOs asked about, and — only when a
 * group exists — the active All OK sets for those SOs. It is a POST-FETCH
 * enrichment: it adds no term to `buildPickingWhere` / `floorBoardWhere` /
 * `getFloorLiveMarkerWhere`, so no board's row set changes. (A decision moves
 * no order row; the Picking and Floor markers fold getDecisionsLatest() into
 * `latest` so an All OK or an Undo still refreshes the boards.)
 *
 * Signature and return type unchanged since 2026-08-20 — both callers
 * (lib/picking/queue.ts, lib/floor/queries.ts) are untouched by the All OK
 * change (build step 6, 2026-09-27).
 */
export async function getDuplicateSoNumbers(
  soNumbers: (string | null)[],
): Promise<Set<string>> {
  return new Set((await getDuplicateGroups(soNumbers)).keys());
}

// ═══════════════════════════════════════════════════════════════════════════
// The rule with bill ids + the All OK acknowledgement (Billing "Pick delete",
// 2026-09-27). getTwinIdsBySo() is the ONE place the twin rule is written IN
// TYPESCRIPT; getDuplicateSoNumbers() above and Billing's Pick delete WRITES
// (markAllOk / pickDelete in lib/billing/pick-delete.ts) read through it.
//
// ⚠ ONE SQL COPY (2026-09-30). Billing's Pick delete READS — the open-group
// list and its 10 s marker — no longer call this file: they ask every open SO,
// which through these helpers meant shipping every open orders row to Node
// (1,787 rows + 1,791 twin rows per call on 2026-09-30). They run the same
// rule as one statement instead (lib/billing/pick-delete.ts openGroupsCte),
// which cites the lines below term by term. If the twin rule, the blank test
// or isAcknowledged changes here, change that statement in the same commit
// and re-run scripts/parity-pick-delete.ts. The RULE stays Picking's; Billing
// only WRITES pick_delete_decisions.
// ═══════════════════════════════════════════════════════════════════════════

/** Postgres bind-parameter headroom for the `in` lists below. */
const SO_CHUNK = 1000;

function nonBlankDistinct(soNumbers: (string | null)[]): string[] {
  return Array.from(
    new Set(soNumbers.filter((s): s is string => s !== null && s.trim() !== "")),
  );
}

/**
 * Every live bill id per SO — THE TWIN RULE, written here and nowhere else (not
 * removed, not cancelled; dispatched counts — see getDuplicateSoNumbers' header)
 * — for the SO numbers asked about, INCLUDING single-bill SOs. Ids sorted
 * ascending. No acknowledgement filter: the All OK and Pick delete writes
 * re-check the live set against this.
 *
 * Bounded: an `in` list of the SOs asked about, never a scan (idx_orders_sonumber).
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

/**
 * The decisions clock: MAX(pick_delete_decisions.updatedAt), or null on an
 * empty table. The Picking and Floor markers fold it into `latest`, because an
 * All OK or an Undo changes the flag WITHOUT touching an order row — the same
 * later-of-two-clocks trick as app/api/picking/tint-workload/marker/route.ts.
 * Any decision anywhere refreshes every open board once (owner-accepted,
 * 2026-09-27). One aggregate on a small table; read-only.
 */
export async function getDecisionsLatest(): Promise<Date | null> {
  const agg = await prisma.pick_delete_decisions.aggregate({ _max: { updatedAt: true } });
  return agg._max.updatedAt ?? null;
}

/** The later of two marker clocks, as the ISO string the hook compares. */
export function laterIso(a: Date | null, b: Date | null): string | null {
  const t = [a, b].filter((d): d is Date => d !== null).map((d) => d.getTime());
  return t.length > 0 ? new Date(Math.max(...t)).toISOString() : null;
}
