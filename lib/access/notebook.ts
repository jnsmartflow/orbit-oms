// lib/access/notebook.ts — the ACCESS NOTEBOOK (pure core, no Prisma).
//
// Plan of record: docs/prompts/drafts/code-plan-2026-09-29-auth-access-notebook.md
//
// ── WHAT IT IS ─────────────────────────────────────────────────────────────
// A per-instance (per Vercel lambda) memory of everything an access decision
// reads from the database:
//   · per user, ONE bundle — the flags the jwt callback refreshes (isActive,
//     isSuperuser, the attendance flags) plus ALL of that user's
//     user_page_access rows;
//   · the one GLOBAL attendance_settings value (rolloutStage);
//   · role_permissions rows per role-slug set (the ACCESS_SOURCE='role' path).
// While it is switched on (system_config ACCESS_CACHE = 'on'), auth() and every
// permission resolver read from here instead of querying on every request.
//
// ── WHEN AN ENTRY MAY BE TRUSTED ───────────────────────────────────────────
//   · version KNOWN  → the entry's tag equals the current ACCESS_VERSION AND it
//                      is younger than MAX_AGE_MS (12 h backstop);
//   · version UNKNOWN (row missing, or the system_config read failed)
//                    → it is younger than UNKNOWN_VERSION_TTL_MS (30 s). An
//                      unknown version NEVER extends trust past 30 s.
// ACCESS_VERSION is bumped by database triggers on every access table
// (sql/2026-09-30-access-notebook.sql), in the same transaction as the write.
//
// 🔴 THE TAG IS THE VERSION KNOWN *BEFORE* THE READ. A bump always lands after
// its write commits, so an entry can only ever carry an OLDER tag than its data
// (dropped at the next check, one extra read) — never a newer tag over older
// data. Do not "improve" this by tagging with a version read afterwards.
//
// This file is pure: the clock, the version source and every fetcher are
// injected, so lib/access/notebook.test.ts runs it with no database. The
// Prisma-wired singleton lives in lib/access/notebook-store.ts. NEITHER may be
// imported by auth.config.ts or middleware.ts (Edge).

/** Same five booleans as lib/permissions.ts PagePermissions (structural). */
export interface NotebookPagePerms {
  canView: boolean;
  canImport: boolean;
  canExport: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/** The users-row flags the Node jwt callback refreshes, plus isActive. */
export interface NotebookUserFlags {
  isActive: boolean;
  isSuperuser: boolean;
  attendanceTestUser: boolean;
  attendanceExempt: boolean;
  attendanceConsentVersion: string | null;
}

/**
 * One user's bundle. `flags === null` means NO users row exists — the caller
 * treats that exactly like isActive = false. `pages` holds only the rows that
 * are stored: an absent page key means all false, as it does today.
 */
export interface UserBundle {
  flags: NotebookUserFlags | null;
  pages: Map<string, NotebookPagePerms>;
}

export interface GlobalSettings {
  rolloutStage: string;
}

/** A role_permissions row as the role path reads it. */
export interface RolePermRow extends NotebookPagePerms {
  roleSlug: string;
  pageKey: string;
}

/** What the notebook needs to know about the shared access version. */
export interface VersionState {
  /** null = unknown (row missing or the read failed). */
  version: string | null;
}

export interface NotebookDeps {
  now: () => number;
  getVersion: () => Promise<VersionState>;
  fetchUser: (userId: number) => Promise<UserBundle>;
  fetchSettings: () => Promise<GlobalSettings>;
  fetchRoleRows: (roleSlugs: string[]) => Promise<RolePermRow[]>;
}

export const MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const UNKNOWN_VERSION_TTL_MS = 30_000;
export const MAX_ENTRIES = 1000;

interface Entry<T> {
  value: T;
  /** ACCESS_VERSION known BEFORE the read (null = unknown). */
  tag: string | null;
  /** Time the read STARTED. */
  at: number;
}

export interface Notebook {
  getUserBundle(userId: number): Promise<UserBundle>;
  getGlobalSettings(): Promise<GlobalSettings>;
  getRoleRows(roleSlugs: string[]): Promise<RolePermRow[]>;
  /** Forget one user on this instance (update() path, sign-in). */
  invalidateUser(userId: number): void;
  /** Forget everything on this instance. */
  dropAll(): void;
  /** Test/diagnostic view. */
  size(): { users: number; roleSets: number; settings: boolean };
}

/** The claims the Node jwt callback refreshes, as read from the notebook. */
export interface NotebookClaims {
  rolloutStage: string;
  attendanceTestUser: boolean;
  attendanceExempt: boolean;
  attendanceConsentVersion: string | null;
  isSuperuser: boolean;
}

/**
 * What the jwt callback's refresh branch must do, decided from the notebook:
 *   · "claims"   — copy these onto the token;
 *   · "inactive" — no users row, or isActive = false: return null (signs the
 *                  person out on this and every later request);
 *   · "failed"   — the read threw: KEEP the token's own claims (decision 3,
 *                  2026-09-29) — never deactivate, never grant, cache nothing.
 * Pure, so lib/access/notebook.test.ts can test all three outcomes.
 */
export type NotebookRefresh =
  | { kind: "claims"; claims: NotebookClaims }
  | { kind: "inactive" }
  | { kind: "failed"; error: unknown };

export async function readRefreshClaims(
  nb: Pick<Notebook, "getUserBundle" | "getGlobalSettings">,
  userId: number,
): Promise<NotebookRefresh> {
  let bundle: UserBundle;
  let settings: GlobalSettings;
  try {
    bundle = await nb.getUserBundle(userId);
    settings = await nb.getGlobalSettings();
  } catch (error) {
    return { kind: "failed", error };
  }
  if (bundle.flags === null || !bundle.flags.isActive) return { kind: "inactive" };
  return {
    kind: "claims",
    claims: {
      rolloutStage: settings.rolloutStage,
      attendanceTestUser: bundle.flags.attendanceTestUser,
      attendanceExempt: bundle.flags.attendanceExempt,
      attendanceConsentVersion: bundle.flags.attendanceConsentVersion,
      isSuperuser: bundle.flags.isSuperuser,
    },
  };
}

export function createNotebook(deps: NotebookDeps): Notebook {
  const users = new Map<number, Entry<UserBundle>>();
  const roleSets = new Map<string, Entry<RolePermRow[]>>();
  let settings: Entry<GlobalSettings> | null = null;
  /** The last KNOWN version this instance saw; a different known one drops all. */
  let seenVersion: string | null = null;

  const userInFlight = new Map<number, Promise<UserBundle>>();
  const roleInFlight = new Map<string, Promise<RolePermRow[]>>();
  let settingsInFlight: Promise<GlobalSettings> | null = null;

  function dropAll(): void {
    users.clear();
    roleSets.clear();
    settings = null;
  }

  /** Read the version; drop the whole notebook when a KNOWN version moved. */
  async function currentVersion(): Promise<string | null> {
    const { version } = await deps.getVersion();
    if (version !== null && version !== seenVersion) {
      if (seenVersion !== null) dropAll();
      seenVersion = version;
    }
    return version;
  }

  function isValid<T>(entry: Entry<T>, version: string | null, now: number): boolean {
    const age = now - entry.at;
    if (age < 0) return false; // clock stepped backwards — do not trust
    if (version === null) return age < UNKNOWN_VERSION_TTL_MS;
    return entry.tag === version && age < MAX_AGE_MS;
  }

  function capAndSet<K, V>(map: Map<K, V>, key: K, value: V): void {
    map.delete(key); // re-insert at the end (Map keeps insertion order)
    while (map.size >= MAX_ENTRIES) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
    map.set(key, value);
  }

  async function getUserBundle(userId: number): Promise<UserBundle> {
    const version = await currentVersion();
    const hit = users.get(userId);
    if (hit && isValid(hit, version, deps.now())) return hit.value;

    const running = userInFlight.get(userId);
    if (running) return running;

    const tag = version;
    const at = deps.now();
    const p = (async () => {
      try {
        const value = await deps.fetchUser(userId);
        capAndSet(users, userId, { value, tag, at });
        return value;
      } finally {
        userInFlight.delete(userId);
      }
    })();
    userInFlight.set(userId, p);
    return p;
  }

  async function getGlobalSettings(): Promise<GlobalSettings> {
    const version = await currentVersion();
    if (settings && isValid(settings, version, deps.now())) return settings.value;
    if (settingsInFlight) return settingsInFlight;

    const tag = version;
    const at = deps.now();
    const p = (async () => {
      try {
        const value = await deps.fetchSettings();
        settings = { value, tag, at };
        return value;
      } finally {
        settingsInFlight = null;
      }
    })();
    settingsInFlight = p;
    return p;
  }

  async function getRoleRows(roleSlugs: string[]): Promise<RolePermRow[]> {
    const key = Array.from(new Set(roleSlugs)).sort().join("|");
    const version = await currentVersion();
    const hit = roleSets.get(key);
    if (hit && isValid(hit, version, deps.now())) return hit.value;

    const running = roleInFlight.get(key);
    if (running) return running;

    const tag = version;
    const at = deps.now();
    const p = (async () => {
      try {
        const value = await deps.fetchRoleRows(roleSlugs);
        capAndSet(roleSets, key, { value, tag, at });
        return value;
      } finally {
        roleInFlight.delete(key);
      }
    })();
    roleInFlight.set(key, p);
    return p;
  }

  return {
    getUserBundle,
    getGlobalSettings,
    getRoleRows,
    invalidateUser(userId: number): void {
      users.delete(userId);
    },
    dropAll,
    size() {
      return { users: users.size, roleSets: roleSets.size, settings: settings !== null };
    },
  };
}
