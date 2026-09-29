import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { getISTDayRange } from "@/lib/dates";
import type { ImportLogHow, ImportLogResponse, ImportLogRow } from "@/lib/import-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/import/log → ImportLogResponse
 *
 * The Import window's "Today's log" tab: TODAY's (IST) MANUAL imports — SAP
 * paste, SAP file, manual template. READ-ONLY.
 *
 * Same gate as the Import button and the import route itself: the Import OBDs
 * tick (import_obd canImport) over ALL held roles — see
 * app/api/import/access/route.ts. No job-title list.
 *
 * ⚠ AUTO-IMPORT IS EXCLUDED on purpose. Its batches are stamped user 1, who is
 * a real person, so they would read as that person's imports.
 *
 * ⚠ import_batches has no source column — the source is the headerFile PREFIX
 * (CLAUDE_IMPORT.md §4). createdAt is timestamp WITHOUT time zone holding UTC,
 * so the IST day is filtered through getISTDayRange() in Prisma, never with
 * SQL AT TIME ZONE (§14).
 *
 * Status: `completed` and `failed`. A template PREVIEW creates its batch at
 * `processing` and an abandoned one stays there, so `processing` is never an
 * import. A `failed` SAP batch can have written bills before it failed, so it
 * is shown (with a Failed tag in the panel).
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  }
  const allowed = await checkAnyPermission(
    session.user.roles ?? [session.user.role],
    "import_obd",
    "canImport",
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "You do not have the Import OBDs permission." },
      { status: 403 },
    );
  }

  const { start, end } = getISTDayRange();

  // Sequential awaits — never prisma.$transaction (CORE §3).
  const batches = await prisma.import_batches.findMany({
    where: {
      createdAt:  { gte: start, lt: end },
      status:     { in: ["completed", "failed"] },
      NOT:        { headerFile: { startsWith: "[auto-import]" } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id:          true,
      batchRef:    true,
      headerFile:  true,
      status:      true,
      totalObds:   true,
      skippedObds: true,
      failedObds:  true,
      createdAt:   true,
      importedBy:  { select: { name: true } },
    },
  });

  // Bills each batch CREATED. orders.batchId is stamped on create and never
  // changed by a patch. Removed orders still count — this is a record of what
  // the import did. (No index on orders.batchId; one scan for a handful of ids.)
  const created = batches.length > 0
    ? await prisma.orders.groupBy({
        by:     ["batchId"],
        where:  { batchId: { in: batches.map((b) => b.id) } },
        _count: { _all: true },
      })
    : [];
  const newByBatch = new Map(created.map((c) => [c.batchId, c._count._all]));

  const rows: ImportLogRow[] = batches.map((b) => {
    const how  = howFromHeaderFile(b.headerFile);
    const made = newByBatch.get(b.id) ?? 0;

    // SAP: totalObds = parser skips + every OBD upserted, skippedObds = parser
    // skips, failedObds = errored — so the rest is patched + unchanged.
    // Template: totalObds counts only the bills it created and skippedObds its
    // DUPLICATES, which are bills already in Orbit (route.ts handleConfirm D6).
    const existing = how === "template"
      ? b.skippedObds
      : Math.max(0, b.totalObds - b.skippedObds - b.failedObds - made);

    return {
      id:       b.id,
      batchRef: b.batchRef,
      at:       b.createdAt.toISOString(),
      who:      b.importedBy.name,
      how,
      status:   b.status,
      new:      made,
      existing,
      skipped:  how === "template" ? 0 : b.skippedObds,
      failed:   b.failedObds,
    };
  });

  const body: ImportLogResponse = {
    rows,
    totals: {
      imports:  rows.length,
      new:      rows.reduce((s, r) => s + r.new, 0),
      existing: rows.reduce((s, r) => s + r.existing, 0),
    },
  };
  return NextResponse.json(body);
}

function howFromHeaderFile(headerFile: string): ImportLogHow {
  if (headerFile.startsWith("[sap-paste]"))  return "sap-paste";
  if (headerFile.startsWith("[manual-sap]")) return "sap-file";
  return "template";
}
