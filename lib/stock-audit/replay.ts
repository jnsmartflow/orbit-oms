// lib/stock-audit/replay.ts — the POST /api/stock-count/audits/[id]/lines
// idempotency rules (offline queue, Schema v27.80), as pure functions so they
// are tested without a database.
//
// 🔴 PURE — no Prisma, no server imports, no React.

/** The bits of an existing line the replay decision needs. */
export interface ExistingByClientId {
  auditId: number;
  countedById: number;
}

/**
 * What to do with a POST that carries a clientId.
 *   "new"      — no line has this id: carry on with the normal create path.
 *   "replay"   — MY line in THIS audit already has it: answer 200 with that
 *                line. Decided BEFORE the audit-open check, so a count that
 *                landed just before the close (its reply lost) is still a
 *                success, and EVEN IF the line was removed since.
 *   "conflict" — someone else's line, or another audit's: 409
 *                CLIENT_ID_CONFLICT (never a v4 collision in practice — a bug
 *                or a tampered body).
 */
export type ReplayDecision = "new" | "replay" | "conflict";

export function decideReplay(
  existing: ExistingByClientId | null,
  auditId: number,
  userId: number,
): ReplayDecision {
  if (existing === null) return "new";
  if (existing.auditId === auditId && existing.countedById === userId) return "replay";
  return "conflict";
}

/**
 * The body's `userId` assertion. The actor is ALWAYS the session user; this
 * only refuses a phone tab that queued entries for user A from posting them on
 * user B's cookie. Absent (an old tab) → accepted.
 */
export function userAssertionOk(raw: unknown, sessionUserId: number): boolean {
  if (raw === undefined || raw === null) return true;
  return typeof raw === "number" && raw === sessionUserId;
}

/**
 * The phone's Submit time → a Date, or null. Display only — the server never
 * trusts it for anything else. An ISO date-time WITH a `Z` or `±HH:MM` offset
 * only: an offset-less string would be read in the host's timezone (CORE §3,
 * the Date.parse landmine). Anything else → null (the desk falls back to
 * createdAt). No range check: phone clocks can be off (Smart Flow, 2026-11-04).
 */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseCountedAt(raw: unknown): Date | null {
  if (typeof raw !== "string" || !ISO_WITH_OFFSET.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms) : null;
}
