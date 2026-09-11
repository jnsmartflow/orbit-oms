import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { getAllTagRows } from "@/lib/hide/tag-settings";
import { TAG_CATALOG } from "@/lib/hide/tag-catalog";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Tag on/off switches (Feature B) — admin read + audience write.
//
// A tag's AUDIENCE is expressed as one of four modes, and the rows are derived
// from it rather than edited individually. The screen sends the mode it wants;
// this route makes the stored rows say exactly that.
//
//   everyone → everyone row isEnabled=true,  no exception rows
//   nobody   → everyone row isEnabled=false, no exception rows
//   except   → everyone row isEnabled=true  + exception rows isEnabled=false
//   only     → everyone row isEnabled=false + exception rows isEnabled=true
//
// Deriving rows from a mode, instead of exposing raw rows, is what keeps the two
// halves in step: the resolver folds user > role > everyone, and a hand-built row
// set could express combinations the sentence under the dropdown cannot describe.
// Switching mode therefore CLEARS the previous mode's exceptions — they mean the
// opposite thing under the new one.
//
// 🔴 NO upsert ANYWHERE IN THIS FILE. The live uniqueness guarantee is three
// PARTIAL unique indexes (sql/2026-09-11-hide-tag-scope.sql), which Prisma cannot
// model, so `tagKey` is no longer @unique and the old
// `upsert({ where: { tagKey } })` cannot compile — and its native path would emit
// ON CONFLICT against a constraint that no longer exists (42P10). Every write
// below is findFirst → update-by-id / create / deleteMany, as sequential awaits.
// Never prisma.$transaction (CORE §3).
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "everyone" | "nobody" | "except" | "only";

interface ExceptionInput {
  kind:      "role" | "user";
  roleSlug?: unknown;
  userId?:   unknown;
}

/** Normalised exception, after validation. */
interface Exception {
  scope:    "role" | "user";
  roleSlug: string | null;
  userId:   number | null;
}

const MODES: Mode[] = ["everyone", "nobody", "except", "only"];

/** Does the everyone row read true in this mode? */
function everyoneEnabledFor(mode: Mode): boolean {
  return mode === "everyone" || mode === "except";
}

/** Do exception rows read true in this mode? */
function exceptionEnabledFor(mode: Mode): boolean {
  return mode === "only";
}

/** A stable, human-readable address for one audience row, for the audit trail. */
function auditId(tagKey: string, e: { scope: string; roleSlug: string | null; userId: number | null }): string {
  if (e.scope === "role") return `${tagKey}|role:${e.roleSlug}`;
  if (e.scope === "user") return `${tagKey}|user:${e.userId}`;
  return `${tagKey}|everyone`;
}

// ── GET — every stored row, for the admin screen ────────────────────────────
//
// Returns ROWS, not the old flat { tagKey: isEnabled } map: a tag can now carry
// several rows and the map shape could only ever show one of them.
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isSuperuser(session)) {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const rows = await getAllTagRows();
  return NextResponse.json({ ok: true, rows });
}

// ── PUT — set one tag's whole audience ──────────────────────────────────────
export async function PUT(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isSuperuser(session)) {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { tagKey, mode, exceptions } = (body ?? {}) as {
    tagKey?: unknown; mode?: unknown; exceptions?: unknown;
  };

  // ── Validation ────────────────────────────────────────────────────────────
  // The tag must be one the app actually renders. An unknown key would store a
  // row nothing reads, which looks like a switch that does not work.
  if (typeof tagKey !== "string" || !TAG_CATALOG.some((e) => e.tagKey === tagKey)) {
    return NextResponse.json(
      { ok: false, error: `Unknown tag "${String(tagKey)}".` },
      { status: 400 },
    );
  }
  if (typeof mode !== "string" || !MODES.includes(mode as Mode)) {
    return NextResponse.json(
      { ok: false, error: `mode must be one of ${MODES.join(" | ")}` },
      { status: 400 },
    );
  }
  const theMode = mode as Mode;

  const rawList = Array.isArray(exceptions) ? (exceptions as ExceptionInput[]) : [];
  if ((theMode === "everyone" || theMode === "nobody") && rawList.length > 0) {
    return NextResponse.json(
      { ok: false, error: `mode "${theMode}" takes no exceptions.` },
      { status: 400 },
    );
  }
  if ((theMode === "except" || theMode === "only") && rawList.length === 0) {
    return NextResponse.json(
      { ok: false, error: `mode "${theMode}" needs at least one role or person.` },
      { status: 400 },
    );
  }

  // Shape each exception to match chk_app_tag_settings_scope exactly — the live
  // CHECK rejects a half-filled row, and a 500 from a constraint is a worse
  // message than a 400 from here.
  const wanted: Exception[] = [];
  for (const raw of rawList) {
    if (raw?.kind === "role") {
      if (typeof raw.roleSlug !== "string" || raw.roleSlug.trim().length === 0) {
        return NextResponse.json({ ok: false, error: "A role exception needs a roleSlug." }, { status: 400 });
      }
      wanted.push({ scope: "role", roleSlug: raw.roleSlug.trim(), userId: null });
    } else if (raw?.kind === "user") {
      const id = typeof raw.userId === "number" ? raw.userId : Number.NaN;
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ ok: false, error: "A person exception needs a numeric userId." }, { status: 400 });
      }
      wanted.push({ scope: "user", roleSlug: null, userId: id });
    } else {
      return NextResponse.json({ ok: false, error: 'Each exception needs kind "role" or "user".' }, { status: 400 });
    }
  }

  // Duplicates would race the partial unique indexes against each other within a
  // single save. Caught here so the message names the cause.
  const seen = new Set<string>();
  for (const e of wanted) {
    const key = e.scope === "role" ? `role:${e.roleSlug}` : `user:${e.userId}`;
    if (seen.has(key)) {
      return NextResponse.json({ ok: false, error: "The same role or person is listed twice." }, { status: 400 });
    }
    seen.add(key);
  }

  // The referenced people and roles must exist. A stale chip would silently match
  // nobody and read as a switch that does nothing. Sequential awaits.
  const wantedUserIds = wanted.filter((e) => e.scope === "user").map((e) => e.userId as number);
  if (wantedUserIds.length > 0) {
    const found = await prisma.users.findMany({
      where: { id: { in: wantedUserIds } },
      select: { id: true },
    });
    if (found.length !== wantedUserIds.length) {
      return NextResponse.json({ ok: false, error: "One of those people no longer exists." }, { status: 400 });
    }
  }
  const wantedSlugs = wanted.filter((e) => e.scope === "role").map((e) => e.roleSlug as string);
  if (wantedSlugs.length > 0) {
    // role_master stores the NAME; the slug is derived exactly as lib/auth.ts:217-221
    // derives it (lowercase, whitespace → "_"). There is no slug column to query,
    // so the roles are fetched and slugged here rather than matched in SQL.
    const roles = await prisma.role_master.findMany({ select: { name: true } });
    const known = new Set(roles.map((r) => r.name.toLowerCase().replace(/\s+/g, "_")));
    const unknown = wantedSlugs.filter((s) => !known.has(s));
    if (unknown.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Unknown role(s): ${unknown.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const actorId = parseInt(session.user.id, 10);
  const now     = new Date();

  try {
    // ── Read what is stored for this tag ────────────────────────────────────
    const existing = await prisma.app_tag_settings.findMany({
      where:  { tagKey },
      select: { id: true, scope: true, roleSlug: true, userId: true, isEnabled: true },
    });

    // ⚠ Log ONLY what MOVED. The screen re-sends a tag's whole audience on every
    // save, so an unchanged save must write no audit line at all — the same rule
    // the permissions grid follows (CORE §7.13).
    const changes: { entityId: string; action: string; summary: string;
                     before?: Record<string, unknown>; after?: Record<string, unknown> }[] = [];

    // ── 1. The everyone row ─────────────────────────────────────────────────
    const wantEveryone = everyoneEnabledFor(theMode);
    const everyoneRow  = existing.find((r) => r.scope === "everyone") ?? null;

    if (!everyoneRow) {
      await prisma.app_tag_settings.create({
        data: { tagKey, scope: "everyone", roleSlug: null, userId: null,
                isEnabled: wantEveryone, updatedById: actorId, updatedAt: now },
      });
      changes.push({
        entityId: auditId(tagKey, { scope: "everyone", roleSlug: null, userId: null }),
        action: "create",
        summary: `${tagKey}: everyone ${wantEveryone ? "sees it" : "cannot see it"}`,
        after: { scope: "everyone", isEnabled: wantEveryone },
      });
    } else if (everyoneRow.isEnabled !== wantEveryone) {
      await prisma.app_tag_settings.update({
        where: { id: everyoneRow.id },
        data:  { isEnabled: wantEveryone, updatedById: actorId, updatedAt: now },
      });
      changes.push({
        entityId: auditId(tagKey, everyoneRow),
        action: "update",
        summary: `${tagKey}: everyone ${wantEveryone ? "sees it" : "cannot see it"}`,
        before: { isEnabled: everyoneRow.isEnabled },
        after:  { isEnabled: wantEveryone },
      });
    }

    // ── 2. Drop exception rows this mode no longer wants ────────────────────
    // Includes EVERY exception when the mode is everyone/nobody, and any chip the
    // admin removed. A mode change clears the old mode's exceptions because they
    // mean the opposite thing under the new one.
    const wantKey = (e: { scope: string; roleSlug: string | null; userId: number | null }) =>
      e.scope === "role" ? `role:${e.roleSlug}` : `user:${e.userId}`;
    const wantedKeys = new Set(wanted.map(wantKey));

    const doomed = existing.filter((r) => r.scope !== "everyone" && !wantedKeys.has(wantKey(r)));
    if (doomed.length > 0) {
      await prisma.app_tag_settings.deleteMany({ where: { id: { in: doomed.map((r) => r.id) } } });
      for (const r of doomed) {
        changes.push({
          entityId: auditId(tagKey, r),
          action: "delete",
          summary: `${tagKey}: exception removed (${r.scope === "role" ? r.roleSlug : `user ${r.userId}`})`,
          before: { scope: r.scope, roleSlug: r.roleSlug, userId: r.userId, isEnabled: r.isEnabled },
        });
      }
    }

    // ── 3. Add or correct the exceptions this mode wants ────────────────────
    const wantExcEnabled = exceptionEnabledFor(theMode);
    for (const e of wanted) {
      // findFirst, not findUnique: the uniqueness lives in partial indexes Prisma
      // cannot address. The three fields below are exactly one partial index's key.
      const row = await prisma.app_tag_settings.findFirst({
        where: { tagKey, scope: e.scope, roleSlug: e.roleSlug, userId: e.userId },
        select: { id: true, isEnabled: true },
      });

      if (!row) {
        await prisma.app_tag_settings.create({
          data: { tagKey, scope: e.scope, roleSlug: e.roleSlug, userId: e.userId,
                  isEnabled: wantExcEnabled, updatedById: actorId, updatedAt: now },
        });
        changes.push({
          entityId: auditId(tagKey, e),
          action: "create",
          summary: `${tagKey}: exception added (${e.scope === "role" ? e.roleSlug : `user ${e.userId}`}) — ${wantExcEnabled ? "sees it" : "cannot see it"}`,
          after: { scope: e.scope, roleSlug: e.roleSlug, userId: e.userId, isEnabled: wantExcEnabled },
        });
      } else if (row.isEnabled !== wantExcEnabled) {
        await prisma.app_tag_settings.update({
          where: { id: row.id },
          data:  { isEnabled: wantExcEnabled, updatedById: actorId, updatedAt: now },
        });
        changes.push({
          entityId: auditId(tagKey, e),
          action: "update",
          summary: `${tagKey}: exception ${e.scope === "role" ? e.roleSlug : `user ${e.userId}`} — ${wantExcEnabled ? "sees it" : "cannot see it"}`,
          before: { isEnabled: row.isEnabled },
          after:  { isEnabled: wantExcEnabled },
        });
      }
    }

    // ── 4. Audit, AFTER the writes succeeded (lib/audit/log.ts RULE 2) ───────
    // Never awaited for its result — a failed log must not fail the save.
    for (const c of changes) {
      await logAdminAction({
        userId: actorId,
        entity: "app_tag_settings",
        entityId: c.entityId,
        action: c.action,
        summary: c.summary,
        before: c.before ?? null,
        after:  c.after ?? null,
      });
    }

    const rows = await getAllTagRows();
    return NextResponse.json({ ok: true, rows, changed: changes.length });
  } catch (err) {
    // P2002 — one of the three partial unique indexes fired. In practice this
    // means two admins saved the same tag at the same moment. A 500 would read as
    // "the app is broken"; this says what to do.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "Somebody else changed this tag a moment ago. Reload and try again." },
        { status: 409 },
      );
    }
    console.error("[tags] audience save failed", err);
    return NextResponse.json({ ok: false, error: "Could not save this tag." }, { status: 500 });
  }
}
