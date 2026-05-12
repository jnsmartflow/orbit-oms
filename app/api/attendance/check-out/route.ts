import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase";
import { istDateString } from "@/lib/attendance/date";
import {
  istMinutesSinceMidnight,
  parseTimeToMin,
  shiftCalendarDate,
} from "@/lib/attendance/format";
import { haversineDistance } from "@/lib/attendance/geofence";
import { deriveAttendanceState } from "@/lib/attendance/state";
import { decideOtOutcome } from "@/lib/attendance/ot-logic";

export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "attendance-photos";
const MAX_PHOTO_BYTES = 500_000;
const MAX_OT_REASON_CHARS = 200;

// POST /api/attendance/check-out
//
// Multipart/form-data body:
//   photo:         File (image/jpeg)  — required if settings.requirePhoto
//   latitude:      number (string)    — optional
//   longitude:     number (string)    — optional
//   accuracy:      number (string)    — optional, meters
//   otClaimed:     "yes" | "no"       — required if check-out time is
//                                         past settings.otTriggerTime AND
//                                         settings.otPromptEnabled. Ignored
//                                         otherwise (ot-logic treats it
//                                         as "no" in those branches).
//   otClaimReason: string             — optional, ≤200 chars. Stored on
//                                         attendance_records and the audit
//                                         row verbatim.
//
// Closes the open CHECK_IN session, recomputes summary totals + status,
// runs the OT decision tree (lib/attendance/ot-logic), persists the
// outcome to attendance_records + attendance_ot_audit (+ grace counter
// when the decision flags the day), and rolls up the day-level OT state
// onto attendance_summary. Returns enough for the client to render the
// day-summary screen without re-querying.
export async function POST(req: Request) {
  const session = await auth();
  const userIdRaw = session?.user?.id;
  if (!userIdRaw) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const userId = parseInt(userIdRaw, 10);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const settings = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: {
      requirePhoto: true,
      requireLocation: true,
      geofenceLat: true,
      geofenceLng: true,
      geofenceRadiusMeters: true,
      lateGraceMinutes: true,
      halfDayThresholdMinutes: true,
      workStartTime: true,
      workEndTime: true,
      // OT policy knobs — fed straight into decideOtOutcome.
      otTriggerTime: true,
      depotWorkingMinutes: true,
      otMonthlyGraceLimit: true,
      otPromptEnabled: true,
    },
  });
  if (!settings) {
    return NextResponse.json(
      { error: "Attendance settings missing" },
      { status: 500 },
    );
  }

  // ── Parse multipart body ────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const photoEntry = form.get("photo");
  const photo: File | null =
    photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : null;
  const latitude = parseNum(form.get("latitude"));
  const longitude = parseNum(form.get("longitude"));
  const accuracy = parseNum(form.get("accuracy"));

  // OT claim. Empty string / missing → null; the past-trigger check
  // below decides whether null is an error or just a no-op.
  const otClaimedRaw = form.get("otClaimed");
  let otClaimed: "yes" | "no" | null;
  if (otClaimedRaw === "yes") otClaimed = "yes";
  else if (otClaimedRaw === "no") otClaimed = "no";
  else if (otClaimedRaw === null || otClaimedRaw === "") otClaimed = null;
  else {
    return NextResponse.json(
      { error: "otClaimed must be 'yes' or 'no'" },
      { status: 400 },
    );
  }

  const otClaimReasonRaw = form.get("otClaimReason");
  const otClaimReasonTrimmed =
    typeof otClaimReasonRaw === "string" ? otClaimReasonRaw.trim() : "";
  const otClaimReason =
    otClaimReasonTrimmed.length > 0 ? otClaimReasonTrimmed : null;
  if (otClaimReason !== null && otClaimReason.length > MAX_OT_REASON_CHARS) {
    return NextResponse.json(
      { error: `OT reason exceeds ${MAX_OT_REASON_CHARS} chars` },
      { status: 400 },
    );
  }

  // ── Validate photo ──────────────────────────────────────────────────────
  if (settings.requirePhoto && !photo) {
    return NextResponse.json({ error: "Photo is required" }, { status: 400 });
  }
  if (photo) {
    if (photo.type !== "image/jpeg") {
      return NextResponse.json(
        { error: "Photo must be image/jpeg" },
        { status: 400 },
      );
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: `Photo exceeds ${MAX_PHOTO_BYTES} bytes` },
        { status: 400 },
      );
    }
  }

  // ── Validate OT claim required-if-past-trigger ──────────────────────────
  // Stable `now`: same instant for past-trigger check, record insert,
  // audit row's performedAt, and summary's lastCheckOutAt. One source
  // of truth so the row can't straddle trigger time mid-handler.
  const now = new Date();
  const istNowMin = istMinutesSinceMidnight(now);
  const triggerMin = parseTimeToMin(settings.otTriggerTime);
  const isPastTrigger = istNowMin > triggerMin;
  if (isPastTrigger && settings.otPromptEnabled && otClaimed === null) {
    return NextResponse.json(
      {
        error: `OT claim required for check-out past ${settings.otTriggerTime}`,
      },
      { status: 400 },
    );
  }

  const today = istDateString();
  const yearMonth = today.slice(0, 7); // "YYYY-MM" for the grace lookup.

  // ── Find the open CHECK_IN session ──────────────────────────────────────
  // The latest record for today must be a CHECK_IN. If it's a CHECK_OUT
  // (already closed) or there are no records, the user isn't checked in.
  const lastRecord = await prisma.attendance_records.findFirst({
    where: { userId, attendanceDate: today },
    orderBy: { timestamp: "desc" },
    select: { id: true, type: true, timestamp: true },
  });
  if (!lastRecord || lastRecord.type !== "CHECK_IN") {
    return NextResponse.json({ error: "Not checked in" }, { status: 409 });
  }
  const openCheckInId = lastRecord.id;

  // ── Compute derived fields ──────────────────────────────────────────────
  const timestampMs = now.getTime();
  const workStartMin = parseTimeToMin(settings.workStartTime);
  const workEndMin = parseTimeToMin(settings.workEndTime);
  // Legacy clock-past-end formula. Persisted to the existing
  // attendance_summary.overtimeMinutes column (kept untouched for
  // historical exports). The response body's `overtimeMinutes` field
  // is overridden lower down with the approval-aware credited value.
  const legacyOvertimeMinutes = Math.max(0, istNowMin - workEndMin);
  const isOvertime = legacyOvertimeMinutes > 0;

  let isOutsideGeofence = false;
  let locationVerified = false;
  let locationDistanceMeters: number | null = null;
  if (latitude !== null && longitude !== null) {
    const geofenceLat = settings.geofenceLat.toNumber();
    const geofenceLng = settings.geofenceLng.toNumber();
    const distance = haversineDistance(latitude, longitude, geofenceLat, geofenceLng);
    locationDistanceMeters = Math.round(distance);
    locationVerified = distance <= settings.geofenceRadiusMeters;
    isOutsideGeofence = !locationVerified;
  }

  // ── Upload photo to Supabase Storage ────────────────────────────────────
  let photoPath: string | null = null;
  if (photo) {
    const [year, month, day] = today.split("-");
    const filename = `${userId}_${timestampMs}_CHECKOUT.jpg`;
    photoPath = `${year}/${month}/${day}/${filename}`;
    const supabase = getSupabaseAdmin();
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(photoPath, photo, {
        contentType: "image/jpeg",
        upsert: false,
      });
    if (uploadError) {
      return NextResponse.json(
        { error: `Photo upload failed: ${uploadError.message}` },
        { status: 500 },
      );
    }
  }

  // ── Insert CHECK_OUT record ─────────────────────────────────────────────
  // OT columns are not set here — we don't yet know the decision (need
  // totalMinutesWorked first). The record is updated with the outcome
  // a few awaits below, before the audit row is written.
  const userAgent = req.headers.get("user-agent") ?? null;
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const record = await prisma.attendance_records.create({
    data: {
      userId,
      type: "CHECK_OUT",
      timestamp: now,
      attendanceDate: today,
      sessionId: openCheckInId,
      latitude,
      longitude,
      locationAccuracyMeters: accuracy === null ? null : Math.round(accuracy),
      locationVerified,
      locationDistanceMeters,
      photoPath,
      photoSizeBytes: photo?.size ?? null,
      userAgent,
      ipAddress,
      deviceLabel: null,
      isManualEntry: false,
      manualReason: null,
      createdById: null,
      isLate: false,
      isOvertime,
      isOutsideGeofence,
      hasNoPhoto: !photo,
      hasNoLocation: latitude === null,
    },
    select: { id: true },
  });

  // ── Recompute total worked via deriveAttendanceState ────────────────────
  // Single source of truth for session pairing — same helper the home
  // screen uses for live state. Must run AFTER the CHECK_OUT insert so
  // the closing record is included.
  const allTodayRecords = await prisma.attendance_records.findMany({
    where: { userId, attendanceDate: today },
    orderBy: { timestamp: "asc" },
    select: { type: true, timestamp: true },
  });
  const state = deriveAttendanceState(allTodayRecords);

  // Post-CHECK_OUT, state should be NOT_CHECKED_IN. Defensive guard.
  if (state.kind !== "NOT_CHECKED_IN") {
    return NextResponse.json(
      { error: "Inconsistent state after check-out" },
      { status: 500 },
    );
  }
  const totalMinutesWorked = state.todayMinutes;
  const sessionCount = state.sessions.length;

  // ── Read this month's grace counter ─────────────────────────────────────
  // Pre-bump value goes into the decision; the post-bump value (read
  // back from the upsert below) feeds the response body.
  const graceRow = await prisma.attendance_ot_grace.findUnique({
    where: { userId_yearMonth: { userId, yearMonth } },
    select: { flagCount: true },
  });
  const currentGraceFlagCount = graceRow?.flagCount ?? 0;

  // ── Run the OT decision tree ────────────────────────────────────────────
  // Pure function — no I/O. All inputs gathered above; the helper
  // applies the policy and tells us what to write.
  const decision = decideOtOutcome({
    checkOutTimestamp: now,
    totalMinutesWorked,
    otClaimed,
    otClaimReason,
    settings: {
      otTriggerTime: settings.otTriggerTime,
      depotWorkingMinutes: settings.depotWorkingMinutes,
      otMonthlyGraceLimit: settings.otMonthlyGraceLimit,
      otPromptEnabled: settings.otPromptEnabled,
    },
    currentGraceFlagCount,
  });

  // ── Apply OT outcome to the CHECK_OUT record ────────────────────────────
  // Approval-side columns (otApprovedById, otApprovedAt, otAdminNote)
  // stay null on insert; the admin override endpoint (Prompt 3) is the
  // only writer for those, and only on PENDING rows.
  await prisma.attendance_records.update({
    where: { id: record.id },
    data: {
      otClaimed: otClaimed === "yes",
      otClaimReason,
      otTotalLessThan95: decision.otTotalLessThan95,
      otApprovalStatus: decision.otApprovalStatus,
      otMinutesCredited: decision.otMinutesCredited,
    },
  });

  // ── Insert one audit row (always — even for NOT_CLAIMED) ────────────────
  // Self-claim: performedById = the checking-out user. Admin actions
  // later will set fromStatus/toStatus when overriding a PENDING row.
  await prisma.attendance_ot_audit.create({
    data: {
      recordId: record.id,
      userId,
      action: decision.auditAction,
      performedById: userId,
      performedAt: now,
      fromStatus: null,
      toStatus: decision.otApprovalStatus,
      note: otClaimReason,
    },
  });

  // ── Bump grace counter if the decision flagged this day ─────────────────
  // Upsert because the row may not exist yet for this user-month. We
  // increment atomically on existing rows so two near-simultaneous
  // check-outs in the same minute can't race to the same value. Read
  // back flagCount so the response reflects the true post-bump count.
  let graceUsedThisMonth = currentGraceFlagCount;
  if (decision.incrementGraceCounter) {
    const updatedGrace = await prisma.attendance_ot_grace.upsert({
      where: { userId_yearMonth: { userId, yearMonth } },
      create: { userId, yearMonth, flagCount: 1 },
      update: { flagCount: { increment: 1 } },
      select: { flagCount: true },
    });
    graceUsedThisMonth = updatedGrace.flagCount;
  }

  // ── Roll up today's OT for the summary ──────────────────────────────────
  // A user can have multiple sessions per day, each with its own OT
  // decision. The summary reflects the worst case across all sessions:
  // PENDING > AUTO_CREDITED_GRACE > AUTO_CREDITED > null (no claim).
  // NOT_CLAIMED records don't contribute to the rollup state. Run this
  // AFTER the record update above so the current check-out is included.
  const todayCheckouts = await prisma.attendance_records.findMany({
    where: { userId, attendanceDate: today, type: "CHECK_OUT" },
    select: { otMinutesCredited: true, otApprovalStatus: true },
  });
  let summaryOtMinutesCredited = 0;
  for (const r of todayCheckouts) {
    summaryOtMinutesCredited += r.otMinutesCredited ?? 0;
  }
  const statusValues = todayCheckouts.map((r) => r.otApprovalStatus);
  let summaryOtApprovalState: string | null;
  if (statusValues.includes("PENDING")) {
    summaryOtApprovalState = "PENDING";
  } else if (statusValues.includes("AUTO_CREDITED_GRACE")) {
    summaryOtApprovalState = "AUTO_CREDITED_GRACE";
  } else if (statusValues.includes("AUTO_CREDITED")) {
    summaryOtApprovalState = "AUTO_CREDITED";
  } else {
    summaryOtApprovalState = null;
  }

  // Late: based on first record (which must be a CHECK_IN if state is
  // NOT_CHECKED_IN with at least one session).
  const firstRecord = allTodayRecords[0];
  let lateMinutes = 0;
  if (firstRecord) {
    const firstIstMin = istMinutesSinceMidnight(firstRecord.timestamp);
    if (firstIstMin > workStartMin + settings.lateGraceMinutes) {
      lateMinutes = firstIstMin - workStartMin;
    }
  }
  const isLate = lateMinutes > 0;

  let summaryStatus: string;
  if (totalMinutesWorked < settings.halfDayThresholdMinutes) {
    summaryStatus = "HALF_DAY";
  } else if (isLate) {
    summaryStatus = "LATE";
  } else {
    summaryStatus = "PRESENT";
  }

  // The summary row was created on first CHECK_IN. We update in place;
  // upsert is overkill since absence here would indicate data corruption.
  // Read existing first so we OR hasGeofenceViolation additively.
  const existingSummary = await prisma.attendance_summary.findUnique({
    where: { userId_attendanceDate: { userId, attendanceDate: today } },
    select: { hasGeofenceViolation: true },
  });
  const hasGeofenceViolation =
    (existingSummary?.hasGeofenceViolation ?? false) || isOutsideGeofence;

  const firstCheckInAt = firstRecord?.timestamp ?? now;

  await prisma.attendance_summary.upsert({
    where: { userId_attendanceDate: { userId, attendanceDate: today } },
    create: {
      userId,
      attendanceDate: today,
      firstCheckInAt,
      lastCheckOutAt: now,
      sessionCount,
      totalMinutesWorked,
      overtimeMinutes: legacyOvertimeMinutes,
      lateMinutes,
      status: summaryStatus,
      hasMissingCheckout: false,
      hasGeofenceViolation,
      hasManualEntries: false,
      otMinutesCredited: summaryOtMinutesCredited,
      otApprovalState: summaryOtApprovalState,
    },
    update: {
      lastCheckOutAt: now,
      sessionCount,
      totalMinutesWorked,
      overtimeMinutes: legacyOvertimeMinutes,
      lateMinutes,
      status: summaryStatus,
      hasMissingCheckout: false,
      hasGeofenceViolation,
      otMinutesCredited: summaryOtMinutesCredited,
      otApprovalState: summaryOtApprovalState,
    },
  });

  // ── Fetch week summaries for the day-summary chart ──────────────────────
  const pastWeekDates: string[] = [];
  for (let i = 1; i <= 6; i++) {
    pastWeekDates.push(shiftCalendarDate(today, i));
  }
  const summaryWindow = await prisma.attendance_summary.findMany({
    where: { userId, attendanceDate: { in: [today, ...pastWeekDates] } },
    orderBy: { attendanceDate: "desc" },
    select: {
      attendanceDate: true,
      firstCheckInAt: true,
      lastCheckOutAt: true,
      totalMinutesWorked: true,
      status: true,
    },
  });
  const weekSummaries = summaryWindow.map((s) => ({
    attendanceDate: s.attendanceDate,
    firstCheckInISO: s.firstCheckInAt?.toISOString() ?? null,
    lastCheckOutISO: s.lastCheckOutAt?.toISOString() ?? null,
    totalMinutesWorked: s.totalMinutesWorked,
    status: s.status,
  }));

  // Response: the `overtimeMinutes` field name is kept for backward
  // compat with check-out-flow.tsx and the day-summary screen, but the
  // value now comes from the OT decision's credited minutes (not the
  // legacy clock-past-end formula). The legacy value still feeds the
  // attendance_summary.overtimeMinutes column for historical exports.
  return NextResponse.json({
    ok: true,
    recordId: record.id,
    photoPath,
    totalMinutesWorked,
    overtimeMinutes: decision.otMinutesCredited,
    lateMinutes,
    sessionCount,
    status: summaryStatus,
    firstCheckInISO: firstCheckInAt.toISOString(),
    lastCheckOutISO: now.toISOString(),
    isOutsideGeofence,
    locationDistanceMeters,
    weekSummaries,
    otOutcome: {
      claimed: decision.otApprovalStatus !== "NOT_CLAIMED",
      status: decision.otApprovalStatus,
      minutesCredited: decision.otMinutesCredited,
      totalLessThan95: decision.otTotalLessThan95,
      graceUsedThisMonth,
      graceLimit: settings.otMonthlyGraceLimit,
    },
  });
}

function parseNum(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = typeof v === "string" ? v : "";
  if (s === "" || s === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
