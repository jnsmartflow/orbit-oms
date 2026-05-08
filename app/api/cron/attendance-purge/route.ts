import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "attendance-photos";
const BATCH_SIZE = 100;
const DEFAULT_RETENTION_DAYS = 90;

interface PurgeError {
  recordId: number;
  message: string;
}

// GET /api/cron/attendance-purge
//
// Vercel Cron schedule: "30 20 * * *" UTC = 02:00 IST daily.
//
// Deletes selfie photos older than settings.photoRetentionDays
// (default 90) from Supabase Storage and clears photoPath in the DB.
// Cursor-paginated through old records in batches of 100. Per-record
// failures are logged and don't abort the run; failed records remain
// candidates on subsequent days (idempotent).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Sequential awaits — never $transaction.
    const settings = await prisma.attendance_settings.findFirst({
      where: { scope: "GLOBAL", roleSlug: null },
      select: { photoRetentionDays: true },
    });
    const retentionDays = settings?.photoRetentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

    // Resolve the Supabase client once. If env vars are missing,
    // getSupabaseAdmin throws; we'd rather fail the whole run with a
    // clear top-level error than fail every per-record call.
    const supabase = getSupabaseAdmin();

    let cursor = 0;
    let totalScanned = 0;
    let totalDeleted = 0;
    const errors: PurgeError[] = [];

    while (true) {
      const batch = await prisma.attendance_records.findMany({
        where: {
          photoPath: { not: null },
          createdAt: { lt: cutoff },
          id: { gt: cursor },
        },
        select: { id: true, photoPath: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      for (const record of batch) {
        if (!record.photoPath) continue; // race-safe (should be filtered)
        totalScanned++;
        try {
          const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([record.photoPath]);

          // Idempotent: "not found" is the desired final state — file
          // already deleted by a prior run, or never existed. Treat as
          // success and proceed with the DB clear.
          if (error && !isNotFoundError(error.message)) {
            const msg = `Storage delete failed: ${error.message}`;
            console.error(`[attendance-purge] record ${record.id}: ${msg}`);
            errors.push({ recordId: record.id, message: msg });
            // Skip the DB update — next day's run will retry.
            continue;
          }

          await prisma.attendance_records.update({
            where: { id: record.id },
            data: { photoPath: null },
          });
          totalDeleted++;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(
            `[attendance-purge] record ${record.id} failed: ${message}`,
          );
          errors.push({ recordId: record.id, message });
        }
      }

      // Advance cursor past this batch. Failed records that still have
      // photoPath set will be picked up on the next day's cron run —
      // intentional spaced retry, no within-run retry loop.
      cursor = batch[batch.length - 1].id;
    }

    return NextResponse.json({
      ok: true,
      cutoffDate: cutoff.toISOString(),
      retentionDays,
      scanned: totalScanned,
      deleted: totalDeleted,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[attendance-purge] top-level failure: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function isNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("not found") || lower.includes("does not exist");
}
