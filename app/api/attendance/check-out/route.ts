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

export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "attendance-photos";
const MAX_PHOTO_BYTES = 500_000;

// POST /api/attendance/check-out
//
// Multipart/form-data body identical to check-in:
//   photo:     File (image/jpeg)  — required if settings.requirePhoto
//   latitude:  number (string)    — optional
//   longitude: number (string)    — optional
//   accuracy:  number (string)    — optional, meters
//
// Closes the open CHECK_IN session for today, recomputes summary
// totals + status (PRESENT/LATE/HALF_DAY), and returns enough for
// the client to render the day-summary screen without re-querying.
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

  // ── Validate ────────────────────────────────────────────────────────────
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

  const today = istDateString();

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
  const now = new Date();
  const timestampMs = now.getTime();

  const istNowMin = istMinutesSinceMidnight(now);
  const workStartMin = parseTimeToMin(settings.workStartTime);
  const workEndMin = parseTimeToMin(settings.workEndTime);
  const overtimeMinutes = Math.max(0, istNowMin - workEndMin);
  const isOvertime = overtimeMinutes > 0;

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

  // ── Recompute summary using deriveAttendanceState ───────────────────────
  // Single source of truth for session pairing — same helper the
  // home screen uses for live state.
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
      overtimeMinutes,
      lateMinutes,
      status: summaryStatus,
      hasMissingCheckout: false,
      hasGeofenceViolation,
      hasManualEntries: false,
    },
    update: {
      lastCheckOutAt: now,
      sessionCount,
      totalMinutesWorked,
      overtimeMinutes,
      lateMinutes,
      status: summaryStatus,
      hasMissingCheckout: false,
      hasGeofenceViolation,
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

  return NextResponse.json({
    ok: true,
    recordId: record.id,
    photoPath,
    totalMinutesWorked,
    overtimeMinutes,
    lateMinutes,
    sessionCount,
    status: summaryStatus,
    firstCheckInISO: firstCheckInAt.toISOString(),
    lastCheckOutISO: now.toISOString(),
    isOutsideGeofence,
    locationDistanceMeters,
    weekSummaries,
  });
}

function parseNum(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = typeof v === "string" ? v : "";
  if (s === "" || s === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
