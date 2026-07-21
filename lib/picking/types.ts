// Picking queue row shape — all fields already resolved upstream (route/area/
// key-customer/dealer come from the effective ship-to dealer, per step 1
// discovery). This module does no joining and no DB access.
export interface PickingQueueRow {
  orderId: number;
  obdNumber: string;
  dealerName: string;
  isShipToOverride: boolean;
  windowId: number | null;
  windowTime: string | null;
  windowSortOrder: number | null;
  deliveryType: string | null;
  route: string | null;
  area: string | null;
  priorityLevel: number | null;
  isKeyCustomer: boolean;
  articleTag: string | null;
  volumeLitres: number | null;
  weightKg: number | null;
  // ── Product-family fields (Picking card redesign, 2026-07-21) ──────────────
  // True when the whole OBD is a tint order. Sourced from orders.orderType
  // === 'tint' (the canonical order-type set at import) — NOT from any tint
  // skuId, which aliases rawLineItemId and is a known false positive
  // (CLAUDE_CORE.md §13). Order-level, so it is the same value on every tab.
  isTint: boolean;
  // Distinct product families on the bill, display-resolved and stable
  // alpha-sorted (locale "en") so chip order never shuffles across refreshes.
  // Each family is COALESCE(sku_master_v2.displayCategory, category), matched
  // import_raw_line_items.skuCodeRaw -> sku_master_v2.material (the natural
  // key, never the skuId FK — CLAUDE_CORE.md §13 id-space landmine). Empty
  // array when no active line resolved to a family; never null.
  families: string[];
  // Raw count of ACTIVE + VALID lines whose skuCodeRaw matched no family
  // (unmastered code, or a resolved-blank family) — a LINE count, not a
  // distinct-code count (2 unmatched tins on one OBD = 2). Powers the
  // mockup's "+N unlisted" honesty chip. 0 when every active line resolved.
  unresolvedLineCount: number;
  obdDateTime: Date | string | null;
  isAssigned: boolean;
  // True at exactly PICK_DONE. Added 2026-07-17 for the picker "My Picks"
  // Done tab — NOT part of the byAssigned sort signal (isAssigned above is
  // unchanged, still strictly PICK_ASSIGNED-only). See queue.ts's WHERE
  // clause comment for the known gap this leaves in the desktop board,
  // the mobile Assign/Check tabs, and lib/picking/sort.ts once PICK_DONE
  // starts being written.
  isDone: boolean;
  // True at exactly PICK_CHECKED. Added 2026-07-18 for the supervisor
  // board's Checked tab. Same strict-per-stage shape as isDone above — a
  // consumer that filters "waiting" on !isAssigned && !isDone must ALSO
  // exclude !isChecked, or a checked bill reappears as if untouched (the
  // same leak class isDone caused before every "waiting" filter was
  // patched — see lib/picking/queue.ts's doc comment).
  isChecked: boolean;
  assignedAt: Date | string | null;
  // pick_assignments.pickedAt — set by POST /api/picking/done. Added
  // 2026-07-17 for the "Needs check" pill ("Picked Xm ago") and the picker
  // "My Picks" Done card's timestamp. null until PICK_DONE is written.
  pickedAt: Date | string | null;
  // pick_assignments.checkedAt / checkedBy.name — set by POST
  // /api/picking/approve. Added 2026-07-18 for the Checked tab's "checked
  // {time}" line and its newest-first ordering. Both null until
  // PICK_CHECKED is written.
  checkedAt: Date | string | null;
  checkedByName: string | null;
  // Numeric FK, added 2026-07-17 for server-side "my bills only" scoping
  // (picker "My Picks") — a display-name match is not a scope boundary.
  // null when the row has no pick_assignments row at all.
  pickerId: number | null;
  assignedToName: string | null;
  assignedByName: string | null;
  // ── Date-zone fields (2026-07-20) ─────────────────────────────────────────
  // Added for the mobile board's locked/unlocked zone split. Computed
  // server-side in lib/picking/queue.ts against today in IST, and populated
  // in BOTH scopes (they are non-optional) — but only MEANINGFUL in the
  // all-dates 'openPending' scope. In the single-date scope every row shares
  // one dispatchTargetDate, so zone/ageDays are constant across the payload
  // and the desktop board ignores all three.
  //
  // 'due'      = dispatchTargetDate <= today (IST), OR the date is null
  // 'upcoming' = dispatchTargetDate  > today (IST) — the LOCKED zone, which
  //              auto-unlocks when the IST day rolls over into its date
  zone: "due" | "upcoming";
  // True when dispatchTargetDate IS NULL. Locked rule: a null date sorts to
  // 'due', never 'upcoming' — unscheduled work must never hide behind a lock.
  // This flag exists so the UI can still mark it ("no date" chip) rather than
  // silently presenting it as due today. Zero such rows existed in production
  // on 2026-07-20; this is future-proofing for imports that omit the date.
  noDispatchDate: boolean;
  // Whole days between dispatchTargetDate and today (IST), floored at 0 — so
  // a future-dated ('upcoming') row is 0, not negative. null when there is no
  // dispatch date (noDispatchDate: true), because "how stale" is unanswerable
  // without one — never 0, which would read as "fresh".
  ageDays: number | null;
  // The raw dispatch-target day as an ISO date-only string ("2026-07-23"),
  // or null when there is none. Added 2026-07-20 for the Assign tab's
  // Upcoming zone, whose badge reads "for Thu 23 Jul" — a label that is
  // NOT derivable from ageDays above, because ageDays is floored at 0 and
  // therefore reads 0 for EVERY future row regardless of distance.
  //
  // Deliberately a string, not a Date: this crosses a JSON boundary to a
  // client component, where a Date would arrive as a string anyway but with
  // a misleading type. Date-only (no time), so the consumer must parse it
  // the Date.UTC(y, m-1, d) way — never new Date(str). See
  // formatDispatchDay() in components/picking/picking-board-mobile.tsx.
  dispatchTargetDate: string | null;
  // Manual early release (5b, 2026-07-20) — true when a supervisor unlocked
  // this future-dated bill for picking today (orders.pickEarlyReleasedAt is
  // set). Such a row reports zone "due", NOT "upcoming": it behaves as
  // ordinary assignable work everywhere. This flag exists only so the UI can
  // still SHOW that it arrived there by override rather than by its date —
  // do not re-derive lock state from it, `zone` is the single authority.
  isEarlyReleased: boolean;
  // Who released it. Cross-supervisor provenance is the entire reason the
  // release is persisted rather than session-local: any of the three
  // supervisors may find a bill in Due now that its own date says is not due
  // yet, and needs to see whose call that was. null when never released.
  earlyReleasedByName: string | null;
}

export type SortRule = {
  key: string;
  label: string;
  compare: (a: PickingQueueRow, b: PickingQueueRow) => number;
};
