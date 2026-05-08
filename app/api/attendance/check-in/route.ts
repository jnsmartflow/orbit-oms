import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase";
import { istDateString } from "@/lib/attendance/date";
import {
  istMinutesSinceMidnight,
  parseTimeToMin,
} from "@/lib/attendance/format";
import { haversineDistance } from "@/lib/attendance/geofence";

export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "attendance-photos";
const MAX_PHOTO_BYTES = 500_000;

// POST /api/attendance/check-in
//
// Multipart/form-data body:
//   photo:     File (image/jpeg) — required if settings.requirePhoto
//   latitude:  number (string)   — optional
//   longitude: number (string)   — optional
//   accuracy:  number (string)   — optional, meters
//
// Returns the created record id + computed flags. Idempotent against
// double-submit via duplicate check (existing open CHECK_IN → 409).
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
      workStartTime: true,
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
  // requireLocation is advisory — we record hasNoLocation=true when
  // missing rather than rejecting. Per spec §4 of Prompt 6 diagnosis.

  const today = istDateString();

  // ── Duplicate check: reject if there's an open CHECK_IN today ───────────
  const lastRecord = await prisma.attendance_records.findFirst({
    where: { userId, attendanceDate: today },
    orderBy: { timestamp: "desc" },
    select: { id: true, type: true },
  });
  if (lastRecord?.type === "CHECK_IN") {
    return NextResponse.json(
      { error: "Already checked in", existingRecordId: lastRecord.id },
      { status: 409 },
    );
  }

  // ── Compute derived fields ──────────────────────────────────────────────
  const now = new Date();
  const timestampMs = now.getTime();

  const istNowMin = istMinutesSinceMidnight(now);
  const workStartMin = parseTimeToMin(settings.workStartTime);
  const lateThresholdMin = workStartMin + settings.lateGraceMinutes;
  const isLate = istNowMin > lateThresholdMin;
  const lateMinutes = isLate ? istNowMin - workStartMin : 0;

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
    const filename = `${userId}_${timestampMs}_CHECKIN.jpg`;
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

  // ── Insert attendance_records ───────────────────────────────────────────
  const userAgent = req.headers.get("user-agent") ?? null;
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const record = await prisma.attendance_records.create({
    data: {
      userId,
      type: "CHECK_IN",
      timestamp: now,
      attendanceDate: today,
      sessionId: null,
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
      isLate,
      isOvertime: false,
      isOutsideGeofence,
      hasNoPhoto: !photo,
      hasNoLocation: latitude === null,
    },
    select: { id: true },
  });

  // ── Upsert attendance_summary (additive) ────────────────────────────────
  // Don't touch firstCheckInAt or hasGeofenceViolation in update — they're
  // additive flags. Use find-then-create-or-update so we can OR booleans.
  const existingSummary = await prisma.attendance_summary.findUnique({
    where: { userId_attendanceDate: { userId, attendanceDate: today } },
    select: { id: true, hasGeofenceViolation: true },
  });

  if (!existingSummary) {
    await prisma.attendance_summary.create({
      data: {
        userId,
        attendanceDate: today,
        firstCheckInAt: now,
        lastCheckOutAt: null,
        sessionCount: 0,
        totalMinutesWorked: 0,
        overtimeMinutes: 0,
        lateMinutes,
        status: "INCOMPLETE",
        hasMissingCheckout: false,
        hasGeofenceViolation: isOutsideGeofence,
        hasManualEntries: false,
      },
    });
  } else if (isOutsideGeofence && !existingSummary.hasGeofenceViolation) {
    // Re-entry from outside the depot — flip the flag, leave everything
    // else (firstCheckInAt, lateMinutes) alone.
    await prisma.attendance_summary.update({
      where: { id: existingSummary.id },
      data: { hasGeofenceViolation: true },
    });
  }

  return NextResponse.json({
    ok: true,
    recordId: record.id,
    photoPath,
    isLate,
    isOutsideGeofence,
    locationDistanceMeters,
    attendanceDate: today,
  });
}

function parseNum(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = typeof v === "string" ? v : "";
  if (s === "" || s === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
