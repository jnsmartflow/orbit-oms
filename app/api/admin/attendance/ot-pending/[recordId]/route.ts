import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  istMinutesSinceMidnight,
  parseTimeToMin,
} from "@/lib/attendance/format";

export const dynamic = "force-dynamic";

const MAX_ADMIN_NOTE_CHARS = 500;

// PATCH /api/admin/attendance/ot-pending/[recordId]
//
// Admin-only. Resolves one PENDING OT claim:
//
//   - approve: credits the recomputed raw OT minutes (same formula
//     as ot-logic.ts — istMinutesSinceMidnight(timestamp) minus
//     parseTimeToMin(otTriggerTime), floored at 0). Writes an
//     ADMIN_APPROVE audit row and re-rolls the day's summary.
//
//   - reject:  zero credit (kept explicit for clarity; the PENDING
//     row already has otMinutesCredited=0). Writes an ADMIN_REJECT
//     audit row, re-rolls the day's summary, and leaves the grace
//     counter UNTOUCHED — per the Q4 policy from Prompt 2, rejected
//     days still consume the monthly grace allotment so abuse can't
//     game the limit by claiming after exhaustion and appealing.
//
// Idempotent: 409 if the record isn't PENDING anymore. Admin can't
// re-decide an already-resolved row from this endpoint; a future
// explicit-override flow can revisit.
//
// Body: { action: "approve" | "reject", note?: string (≤500 chars) }
export async function PATCH(
  req: Request,
  { params }: { params: { recordId: string } },
) {
  const session = await auth();
  if (!hasRole(session, [ROLES.ADMIN])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const adminIdRaw = session?.user?.id;
  const adminId = adminIdRaw ? parseInt(adminIdRaw, 10) : NaN;
  if (!Number.isFinite(adminId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const recordId = parseInt(params.recordId, 10);
  if (!Number.isFinite(recordId)) {
    return NextResponse.json({ error: "Invalid recordId" }, { status: 400 });
  }

  // ── Parse + validate body ────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const { action: actionRaw, note: noteRaw } = body as Record<string, unknown>;
  if (actionRaw !== "approve" && actionRaw !== "reject") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }
  const action: "approve" | "reject" = actionRaw;

  let note: string | null = null;
  if (typeof noteRaw === "string") {
    const trimmed = noteRaw.trim();
    if (trimmed.length > MAX_ADMIN_NOTE_CHARS) {
      return NextResponse.json(
        { error: `note exceeds ${MAX_ADMIN_NOTE_CHARS} chars` },
        { status: 400 },
      );
    }
    note = trimmed.length > 0 ? trimmed : null;
  } else if (noteRaw !== null && noteRaw !== undefined) {
    return NextResponse.json(
      { error: "note must be a string" },
      { status: 400 },
    );
  }

  // ── Load record + idempotency check ──────────────────────────────────────
  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const record = await prisma.attendance_records.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      userId: true,
      attendanceDate: true,
      timestamp: true,
      otApprovalStatus: true,
    },
  });
  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  if (record.otApprovalStatus !== "PENDING") {
    return NextResponse.json(
      {
        error: "Record not pending approval",
        currentStatus: record.otApprovalStatus,
      },
      { status: 409 },
    );
  }

  const settings = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: { otTriggerTime: true },
  });
  if (!settings) {
    return NextResponse.json(
      { error: "Attendance settings missing" },
      { status: 500 },
    );
  }
  const triggerMin = parseTimeToMin(settings.otTriggerTime);

  // ── Apply the decision ───────────────────────────────────────────────────
  const now = new Date();
  let creditedMinutes = 0;
  const newStatus: "APPROVED" | "REJECTED" =
    action === "approve" ? "APPROVED" : "REJECTED";

  if (action === "approve") {
    // Recompute against the LIVE trigger time (not the value at
    // check-out). If admin edited otTriggerTime between submission
    // and approval the credit changes — accepted per Prompt 2.
    const otMinutesRaw = Math.max(
      0,
      istMinutesSinceMidnight(record.timestamp) - triggerMin,
    );
    // Guard against silent zero-credit approvals. If the recomputed
    // raw is 0 (trigger time moved past the check-out clock) we
    // refuse the approve so admin never accidentally credits nothing
    // — they must reject explicitly or restore the previous trigger.
    if (otMinutesRaw === 0) {
      return NextResponse.json(
        {
          error:
            "Cannot approve — recomputed OT is 0 minutes. Trigger time may have changed since check-out. Reject the record or restore the previous trigger time.",
        },
        { status: 422 },
      );
    }
    creditedMinutes = otMinutesRaw;
    await prisma.attendance_records.update({
      where: { id: record.id },
      data: {
        otApprovalStatus: "APPROVED",
        otMinutesCredited: creditedMinutes,
        otApprovedById: adminId,
        otApprovedAt: now,
        otAdminNote: note,
      },
    });
    await prisma.attendance_ot_audit.create({
      data: {
        recordId: record.id,
        userId: record.userId,
        action: "ADMIN_APPROVE",
        performedById: adminId,
        performedAt: now,
        fromStatus: "PENDING",
        toStatus: "APPROVED",
        note,
      },
    });
  } else {
    // Reject — credit stays 0. Grace counter is intentionally NOT
    // refunded; see header comment for the Q4-policy rationale.
    await prisma.attendance_records.update({
      where: { id: record.id },
      data: {
        otApprovalStatus: "REJECTED",
        otMinutesCredited: 0,
        otApprovedById: adminId,
        otApprovedAt: now,
        otAdminNote: note,
      },
    });
    await prisma.attendance_ot_audit.create({
      data: {
        recordId: record.id,
        userId: record.userId,
        action: "ADMIN_REJECT",
        performedById: adminId,
        performedAt: now,
        fromStatus: "PENDING",
        toStatus: "REJECTED",
        note,
      },
    });
  }

  // ── Re-roll the day's summary ────────────────────────────────────────────
  // Priority list (first match wins) — extends the check-out route's
  // rule with the admin-only APPROVED and REJECTED states:
  //   PENDING > AUTO_CREDITED_GRACE > AUTO_CREDITED > APPROVED > REJECTED > null
  //
  // The day-level state shows the day's "highest-effort" status —
  // the single signal an admin most needs to see at a glance. Full
  // per-record history lives in attendance_ot_audit, so the rollup
  // is intentionally lossy (e.g. AUTO_CREDITED + APPROVED rolls up
  // to AUTO_CREDITED, not a breakdown — by design, not a bug).
  const todayCheckouts = await prisma.attendance_records.findMany({
    where: {
      userId: record.userId,
      attendanceDate: record.attendanceDate,
      type: "CHECK_OUT",
    },
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
  } else if (statusValues.includes("APPROVED")) {
    summaryOtApprovalState = "APPROVED";
  } else if (statusValues.includes("REJECTED")) {
    summaryOtApprovalState = "REJECTED";
  } else {
    summaryOtApprovalState = null;
  }

  // Update in place — the summary row must exist because the
  // check-out that created the PENDING record also wrote it.
  await prisma.attendance_summary.update({
    where: {
      userId_attendanceDate: {
        userId: record.userId,
        attendanceDate: record.attendanceDate,
      },
    },
    data: {
      otMinutesCredited: summaryOtMinutesCredited,
      otApprovalState: summaryOtApprovalState,
    },
  });

  return NextResponse.json({
    ok: true,
    recordId: record.id,
    newStatus,
    minutesCredited: creditedMinutes,
    summaryOtApprovalState,
    summaryOtMinutesCredited,
  });
}
