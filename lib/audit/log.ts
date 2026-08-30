import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Admin audit trail — one insert into `admin_audit_log` (schema v27.18).
 *
 * WHY THIS EXISTS. The 2026-08-31 role census found 70 write paths that record
 * no actor anywhere — including `admin/permissions` POST, which writes the
 * permission grid itself, and `admin/users` create/update, which covers role
 * changes and password resets. Today the role gate narrows the suspect list to
 * "the one active admin"; under per-user access it stops narrowing anything.
 * Full list: docs/prompts/drafts/code-discovery-2026-08-31-role-census.md §6c.
 *
 * ── THE THREE RULES ────────────────────────────────────────────────────────
 *
 * RULE 1 — A FAILED LOG MUST NEVER BREAK THE USER'S ACTION.
 * The insert is wrapped in try/catch: on failure it console.errors and returns
 * normally. A customer edit that already SUCCEEDED must not be rolled back, or
 * reported as failed, because the audit write lost its connection. The audit
 * trail is evidence about the system, not part of it. This function therefore
 * returns void and never throws — callers do not need to guard it, and MUST NOT
 * wrap it in logic that treats its outcome as meaningful.
 *
 * RULE 2 — CALL IT *AFTER* THE BUSINESS WRITE SUCCEEDS, NEVER BEFORE.
 * A log line for a change that did not happen is worse than no line at all: it
 * is a false record that a later reader has no way to detect. Put the call after
 * the `await prisma.<thing>.update(...)` returns, not before it and not beside
 * it. (Sequential awaits only — never wrap the pair in prisma.$transaction,
 * CORE §3.)
 *
 * RULE 3 — 🔴 NEVER LOG A PASSWORD OR A PASSWORD HASH.
 * `redact()` below strips them out of BOTH `before` and `after` on every call,
 * so a caller that forgets is still safe. For a password reset, pass
 * `summary: "password reset"` and put NOTHING in the data fields — the fact of
 * the reset is the audit-worthy event; the value never is. A bcrypt hash is not
 * "already safe": it is offline-crackable and it is exactly what an audit table
 * must not accumulate.
 *
 * ── NOTES ──────────────────────────────────────────────────────────────────
 *
 * APPEND-ONLY BY CONVENTION. This is the only writer, and it only ever inserts.
 * There is no update or delete path and none should be added.
 *
 * `entityId` is TEXT, not Int — it has to hold a composite key
 * (`role_permissions` is keyed by roleSlug+pageKey), so numeric ids are
 * stringified by the caller.
 */

/** Keys stripped from every logged payload, matched case-insensitively. */
const SECRET_KEYS = ["password", "passwordhash", "password_hash", "newpassword", "hash"];

/**
 * RULE 3's enforcement point. Drops secret-ish keys from a flat payload.
 * Deliberately shallow: everything this helper is wired to passes a flat object,
 * and a recursive walk would invite callers to hand it whole nested records —
 * which is how PII ends up in an audit table by accident.
 */
function redact(data?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SECRET_KEYS.includes(k.toLowerCase())) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface AdminAuditEntry {
  /** The ACTOR — who did it. Never the subject of the change. */
  userId: number;
  /** Table or domain touched, e.g. "users", "role_permissions". */
  entity: string;
  /** Which row. Stringified; composite keys allowed. Omit for bulk actions. */
  entityId?: string | null;
  /** What happened: "create" | "update" | "delete" | a domain verb. */
  action: string;
  /** One human-readable line. The only field a reader skimming the log sees. */
  summary?: string | null;
  /** State before. Secrets are stripped; pass nothing for a password reset. */
  before?: Record<string, unknown> | null;
  /** State after. Same rules. */
  after?: Record<string, unknown> | null;
}

export async function logAdminAction(entry: AdminAuditEntry): Promise<void> {
  try {
    await prisma.admin_audit_log.create({
      data: {
        userId: entry.userId,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        action: entry.action,
        summary: entry.summary ?? null,
        // RULE 3 — redaction applied here, on every call, so a forgetful caller
        // still cannot write a password into the trail.
        //
        // The cast is required, not lazy: Prisma types a Json? input column as
        // `InputJsonValue`, which a plain `Record<string, unknown>` does not
        // satisfy (unknown is not assignable to Prisma's JSON union). The values
        // reaching here are already JSON-safe — redact() returns a flat object of
        // scalars — so the cast asserts what the callers guarantee.
        beforeData: redact(entry.before) as Prisma.InputJsonValue | undefined,
        afterData: redact(entry.after) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // RULE 1 — swallow. The user's action already succeeded; losing the audit
    // line is a monitoring problem, not a reason to fail their request.
    console.error("[audit] failed to write admin_audit_log entry:", entry.entity, entry.action, err);
  }
}
