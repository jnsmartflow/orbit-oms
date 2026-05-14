import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { parseTimeToMin } from "@/lib/attendance/format";

export const dynamic = "force-dynamic";

// GET  /api/admin/attendance/settings
// PATCH /api/admin/attendance/settings
//
// Admin-only. Replaces every settings change that today happens via
// Supabase SQL — work hours, late grace, geofence, photo policy, OT
// policy knobs, DPDP version, rollout stage. Validated server-side;
// audit-friendly via the existing updatedById + updatedAt columns
// (Prisma's @updatedAt bumps the timestamp automatically).
//
// PATCH body is a partial settings object. Any field omitted is
// unchanged. The route is intentionally lossless about admin
// "touches": a PATCH whose values all match the current row still
// runs the update so updatedAt/updatedById tick — a deliberate
// audit-trail signal that admin reviewed the settings, even when
// they changed nothing.

// ── Constants ──────────────────────────────────────────────────────────────

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DPDP_VERSION_REGEX = /^v\d+\.\d+$/;
const DPDP_VERSION_MAX_LEN = 32;

const ROLLOUT_STAGES = ["OFF", "TEST_USERS_ONLY", "ALL_USERS"] as const;
type RolloutStage = (typeof ROLLOUT_STAGES)[number];

// Editable column keys. The admin frontend may POST any subset of
// these; anything outside the union gets stripped (and unknown keys
// get warned about — see step 4 of the validation pipeline below).
const EDITABLE_KEYS = [
  "rolloutStage",
  "workStartTime",
  "workEndTime",
  "checkInWindowStart",
  "checkInWindowEnd",
  "otTriggerTime",
  "lateGraceMinutes",
  "halfDayThresholdMinutes",
  "geofenceRadiusMeters",
  "photoRetentionDays",
  "photoMaxWidthPx",
  "photoJpegQuality",
  "depotWorkingMinutes",
  "otMonthlyGraceLimit",
  "geofenceLat",
  "geofenceLng",
  "requirePhoto",
  "requireLocation",
  "otPromptEnabled",
  "dpdpConsentVersion",
] as const;
const EDITABLE_SET = new Set<string>(EDITABLE_KEYS);

// Known but non-editable. The frontend may round-trip the full GET
// response shape back as a PATCH body for convenience; we want to
// tolerate that without warning on the audit/echo fields.
const IGNORED_SET = new Set<string>([
  "scope",
  "roleSlug",
  "updatedAt",
  "updatedById",
  "updatedBy",
  "updatedByName",
  "id",
]);

// ── Types ──────────────────────────────────────────────────────────────────

interface ValidationError {
  field: string;
  message: string;
}

// Row shape after include — captures every column we expose, plus
// the joined updatedBy user.
interface SettingsRowFull {
  scope: string;
  roleSlug: string | null;
  rolloutStage: string;
  workStartTime: string;
  workEndTime: string;
  lateGraceMinutes: number;
  halfDayThresholdMinutes: number;
  checkInWindowStart: string;
  checkInWindowEnd: string;
  geofenceLat: Prisma.Decimal;
  geofenceLng: Prisma.Decimal;
  geofenceRadiusMeters: number;
  requirePhoto: boolean;
  requireLocation: boolean;
  photoRetentionDays: number;
  photoMaxWidthPx: number;
  photoJpegQuality: number;
  dpdpConsentVersion: string;
  depotWorkingMinutes: number;
  otTriggerTime: string;
  otMonthlyGraceLimit: number;
  otPromptEnabled: boolean;
  updatedAt: Date;
  updatedById: number | null;
  updatedBy: { id: number; name: string } | null;
}

// Patch passed to prisma.attendance_settings.update. Each key is
// optional; we add only the validated ones plus updatedById.
type UpdateData = {
  rolloutStage?: string;
  workStartTime?: string;
  workEndTime?: string;
  checkInWindowStart?: string;
  checkInWindowEnd?: string;
  otTriggerTime?: string;
  lateGraceMinutes?: number;
  halfDayThresholdMinutes?: number;
  geofenceRadiusMeters?: number;
  photoRetentionDays?: number;
  photoMaxWidthPx?: number;
  photoJpegQuality?: number;
  depotWorkingMinutes?: number;
  otMonthlyGraceLimit?: number;
  geofenceLat?: number;
  geofenceLng?: number;
  requirePhoto?: boolean;
  requireLocation?: boolean;
  otPromptEnabled?: boolean;
  dpdpConsentVersion?: string;
  updatedById?: number;
};

// ── GET handler ────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!hasRole(session, [ROLES.ADMIN, ROLES.OPS_ADMIN])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const row = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    include: { updatedBy: { select: { id: true, name: true } } },
  });
  if (!row) {
    return NextResponse.json(
      { error: "Attendance settings missing" },
      { status: 500 },
    );
  }

  return NextResponse.json(buildSettingsResponse(row));
}

// ── PATCH handler ──────────────────────────────────────────────────────────

export async function PATCH(req: Request) {
  const session = await auth();
  if (!hasRole(session, [ROLES.ADMIN, ROLES.OPS_ADMIN])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const adminIdRaw = session?.user?.id;
  const adminId = adminIdRaw ? parseInt(adminIdRaw, 10) : NaN;
  if (!Number.isFinite(adminId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  // ── Strip body into editable / ignored / unknown buckets ────────────────
  // Unknown keys are dropped AND logged — surfaces stale or malicious
  // payloads in Vercel logs without breaking forward compat. Ignored
  // keys (audit/echo fields from a round-tripped GET response) are
  // dropped silently because they're expected.
  const bodyObj = body as Record<string, unknown>;
  const editPatch: Record<string, unknown> = {};
  const droppedUnknown: string[] = [];
  for (const key of Object.keys(bodyObj)) {
    if (EDITABLE_SET.has(key)) {
      editPatch[key] = bodyObj[key];
    } else if (!IGNORED_SET.has(key)) {
      droppedUnknown.push(key);
    }
  }
  if (droppedUnknown.length > 0) {
    console.warn(
      `[admin-settings] dropped unknown fields: [${droppedUnknown.join(", ")}]`,
    );
  }

  if (Object.keys(editPatch).length === 0) {
    return NextResponse.json(
      { errors: [{ field: "_", message: "no fields provided" }] },
      { status: 400 },
    );
  }

  // ── Fetch current row (needed for cross-field + special-flag logic) ─────
  const current = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    include: { updatedBy: { select: { id: true, name: true } } },
  });
  if (!current) {
    return NextResponse.json(
      { error: "Attendance settings missing" },
      { status: 500 },
    );
  }

  // ── Per-field validation pass — accumulate every failure ────────────────
  const errors: ValidationError[] = [];
  const updateData: UpdateData = {};

  if ("rolloutStage" in editPatch) {
    const v = validateRolloutStage("rolloutStage", editPatch.rolloutStage, errors);
    if (v !== undefined) updateData.rolloutStage = v;
  }
  for (const field of [
    "workStartTime",
    "workEndTime",
    "checkInWindowStart",
    "checkInWindowEnd",
    "otTriggerTime",
  ] as const) {
    if (field in editPatch) {
      const v = validateTimeString(field, editPatch[field], errors);
      if (v !== undefined) updateData[field] = v;
    }
  }
  for (const spec of [
    { field: "lateGraceMinutes", min: 0, max: 120 },
    { field: "halfDayThresholdMinutes", min: 60, max: 480 },
    { field: "geofenceRadiusMeters", min: 10, max: 5000 },
    { field: "photoRetentionDays", min: 7, max: 730 },
    { field: "photoMaxWidthPx", min: 240, max: 1920 },
    { field: "photoJpegQuality", min: 30, max: 95 },
    { field: "depotWorkingMinutes", min: 60, max: 720 },
    { field: "otMonthlyGraceLimit", min: 0, max: 30 },
  ] as const) {
    if (spec.field in editPatch) {
      const v = validateInteger(
        spec.field,
        editPatch[spec.field],
        spec.min,
        spec.max,
        errors,
      );
      if (v !== undefined) updateData[spec.field] = v;
    }
  }
  if ("geofenceLat" in editPatch) {
    const v = validateDecimal("geofenceLat", editPatch.geofenceLat, -90, 90, errors);
    if (v !== undefined) updateData.geofenceLat = v;
  }
  if ("geofenceLng" in editPatch) {
    const v = validateDecimal("geofenceLng", editPatch.geofenceLng, -180, 180, errors);
    if (v !== undefined) updateData.geofenceLng = v;
  }
  for (const field of ["requirePhoto", "requireLocation", "otPromptEnabled"] as const) {
    if (field in editPatch) {
      const v = validateBoolean(field, editPatch[field], errors);
      if (v !== undefined) updateData[field] = v;
    }
  }
  if ("dpdpConsentVersion" in editPatch) {
    const v = validateDpdpVersion(
      "dpdpConsentVersion",
      editPatch.dpdpConsentVersion,
      errors,
    );
    if (v !== undefined) updateData.dpdpConsentVersion = v;
  }

  // ── Cross-field invariants ──────────────────────────────────────────────
  // Skip an invariant if either involved field was attempted-but-failed
  // — comparing a known-bad value would yield a confusing second error
  // (e.g. "workEndTime must be after workStartTime" when workStartTime
  // is "25:00" tells the admin nothing useful).
  if (
    fieldUsable("workStartTime", editPatch, updateData) &&
    fieldUsable("workEndTime", editPatch, updateData)
  ) {
    const start = updateData.workStartTime ?? current.workStartTime;
    const end = updateData.workEndTime ?? current.workEndTime;
    if (parseTimeToMin(end) <= parseTimeToMin(start)) {
      errors.push({
        field: "workEndTime",
        message: "workEndTime must be after workStartTime",
      });
    }
  }
  if (
    fieldUsable("checkInWindowStart", editPatch, updateData) &&
    fieldUsable("checkInWindowEnd", editPatch, updateData)
  ) {
    const start = updateData.checkInWindowStart ?? current.checkInWindowStart;
    const end = updateData.checkInWindowEnd ?? current.checkInWindowEnd;
    if (parseTimeToMin(end) <= parseTimeToMin(start)) {
      errors.push({
        field: "checkInWindowEnd",
        message: "checkInWindowEnd must be after checkInWindowStart",
      });
    }
  }
  if (
    fieldUsable("otTriggerTime", editPatch, updateData) &&
    fieldUsable("workStartTime", editPatch, updateData)
  ) {
    const trigger = updateData.otTriggerTime ?? current.otTriggerTime;
    const start = updateData.workStartTime ?? current.workStartTime;
    if (parseTimeToMin(trigger) < parseTimeToMin(start)) {
      errors.push({
        field: "otTriggerTime",
        message: "otTriggerTime must not precede workStartTime",
      });
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  // ── Apply special-behaviour detection BEFORE the write ─────────────────
  // We compute these from the pre-update values vs. the validated
  // patch; running them post-update would require either re-reading
  // or trusting Prisma's returned row, both unnecessary.
  const willForceReconsent =
    updateData.dpdpConsentVersion !== undefined &&
    updateData.dpdpConsentVersion !== current.dpdpConsentVersion;
  const rolloutActivated =
    updateData.rolloutStage === "TEST_USERS_ONLY" &&
    current.rolloutStage === "OFF";
  if (
    updateData.otPromptEnabled !== undefined &&
    updateData.otPromptEnabled !== current.otPromptEnabled
  ) {
    console.info(
      `[admin-settings] otPromptEnabled changed from ${current.otPromptEnabled} to ${updateData.otPromptEnabled}`,
    );
  }

  // ── Write + return ──────────────────────────────────────────────────────
  // updatedAt is bumped automatically by Prisma's @updatedAt directive.
  // We always write (even on all-unchanged patches) so the timestamp
  // and updatedById reflect that admin reviewed the row.
  updateData.updatedById = adminId;
  const updated = await prisma.attendance_settings.update({
    where: { id: current.id },
    data: updateData,
    include: { updatedBy: { select: { id: true, name: true } } },
  });

  const response: {
    ok: true;
    settings: ReturnType<typeof buildSettingsResponse>;
    willForceReconsent?: true;
    rolloutActivated?: true;
  } = {
    ok: true,
    settings: buildSettingsResponse(updated),
  };
  if (willForceReconsent) response.willForceReconsent = true;
  if (rolloutActivated) response.rolloutActivated = true;
  return NextResponse.json(response);
}

// ── Helpers ────────────────────────────────────────────────────────────────

// "Usable" = the field was either not in the patch (fall back to
// current row's value) or in the patch AND it passed per-field
// validation (its value is now in updateData). Excludes the
// "attempted but failed" state, which is precisely what we want
// to skip in cross-field checks.
function fieldUsable(
  field: string,
  patch: Record<string, unknown>,
  updateData: Record<string, unknown>,
): boolean {
  return !(field in patch) || field in updateData;
}

function validateRolloutStage(
  field: string,
  value: unknown,
  errors: ValidationError[],
): RolloutStage | undefined {
  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string` });
    return undefined;
  }
  if (!ROLLOUT_STAGES.includes(value as RolloutStage)) {
    errors.push({
      field,
      message: `${field} must be OFF, TEST_USERS_ONLY, or ALL_USERS`,
    });
    return undefined;
  }
  return value as RolloutStage;
}

function validateTimeString(
  field: string,
  value: unknown,
  errors: ValidationError[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string` });
    return undefined;
  }
  if (!TIME_REGEX.test(value)) {
    errors.push({
      field,
      message: `${field} must be HH:MM 24-hour format`,
    });
    return undefined;
  }
  return value;
}

function validateInteger(
  field: string,
  value: unknown,
  min: number,
  max: number,
  errors: ValidationError[],
): number | undefined {
  if (typeof value !== "number") {
    errors.push({ field, message: `${field} must be a number` });
    return undefined;
  }
  if (!Number.isInteger(value)) {
    errors.push({ field, message: `${field} must be an integer` });
    return undefined;
  }
  if (value < min || value > max) {
    errors.push({
      field,
      message: `${field} must be between ${min} and ${max}`,
    });
    return undefined;
  }
  return value;
}

function validateDecimal(
  field: string,
  value: unknown,
  min: number,
  max: number,
  errors: ValidationError[],
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ field, message: `${field} must be a finite number` });
    return undefined;
  }
  if (value < min || value > max) {
    errors.push({
      field,
      message: `${field} must be between ${min} and ${max}`,
    });
    return undefined;
  }
  return value;
}

function validateBoolean(
  field: string,
  value: unknown,
  errors: ValidationError[],
): boolean | undefined {
  if (typeof value !== "boolean") {
    errors.push({ field, message: `${field} must be a boolean` });
    return undefined;
  }
  return value;
}

function validateDpdpVersion(
  field: string,
  value: unknown,
  errors: ValidationError[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string` });
    return undefined;
  }
  if (value.length === 0 || value.length > DPDP_VERSION_MAX_LEN) {
    errors.push({
      field,
      message: `${field} must be 1–${DPDP_VERSION_MAX_LEN} chars`,
    });
    return undefined;
  }
  if (!DPDP_VERSION_REGEX.test(value)) {
    errors.push({
      field,
      message: `${field} must match pattern v<major>.<minor> (e.g. v1.0)`,
    });
    return undefined;
  }
  return value;
}

function buildSettingsResponse(row: SettingsRowFull) {
  return {
    scope: row.scope,
    roleSlug: row.roleSlug,
    rolloutStage: row.rolloutStage,
    workStartTime: row.workStartTime,
    workEndTime: row.workEndTime,
    lateGraceMinutes: row.lateGraceMinutes,
    halfDayThresholdMinutes: row.halfDayThresholdMinutes,
    checkInWindowStart: row.checkInWindowStart,
    checkInWindowEnd: row.checkInWindowEnd,
    geofenceLat: row.geofenceLat.toNumber(),
    geofenceLng: row.geofenceLng.toNumber(),
    geofenceRadiusMeters: row.geofenceRadiusMeters,
    requirePhoto: row.requirePhoto,
    requireLocation: row.requireLocation,
    photoRetentionDays: row.photoRetentionDays,
    photoMaxWidthPx: row.photoMaxWidthPx,
    photoJpegQuality: row.photoJpegQuality,
    dpdpConsentVersion: row.dpdpConsentVersion,
    depotWorkingMinutes: row.depotWorkingMinutes,
    otTriggerTime: row.otTriggerTime,
    otMonthlyGraceLimit: row.otMonthlyGraceLimit,
    otPromptEnabled: row.otPromptEnabled,
    updatedAt: row.updatedAt.toISOString(),
    updatedById: row.updatedById,
    updatedByName: row.updatedBy?.name ?? null,
  };
}
