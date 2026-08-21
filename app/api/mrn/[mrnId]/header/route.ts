import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseMrnDate } from "@/lib/mrn/queries";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/mrn/[mrnId]/header — billing edits the MRN header.
 *
 * Body (every field optional): { truckReportingDate, receivedFrom, stiRefNo,
 * deliveryNo, otrNo }
 *
 * 🔴 409 UNLESS status === 'open'. Start unloading is what locks billing out
 * (design §5 — the "Send to supervisor" step was removed precisely so that
 * Start is the single lock), and §11 OQ-8 applies the same guard to delete.
 *
 * 🔴 `mrnDate` AND `srNo` ARE IMMUTABLE and are rejected outright. They partner
 * in UNIQUE(mrnDate, srNo) and are what billing's rail numbers trucks by.
 * Editing `truckReportingDate` — which IS allowed here — must never renumber
 * anything (design §11 OQ-5): a truck that reported on the 17th and was entered
 * on the 20th stays truck N of the 20th. `status` and `isRemoved` are rejected
 * for a different reason: they belong to the supervisor's routes (step 6) and
 * to the delete route, not to a header edit.
 *
 * ONE write. No ordering question arises and no partial state is possible.
 */

/** Pinned in application code so a bad value is a clean 400, never a 500 out of
 *  chk_mrn_received_from. Duplicated from app/api/mrn/create/route.ts on
 *  purpose, so the two routes accept and reject identical values — the same way
 *  the picking queue and marker duplicate their `scope` check. */
const RECEIVED_FROM = ["TPW", "CDC"] as const;

/** Fields a header edit may never touch, with the reason each is refused. */
const FORBIDDEN_FIELDS: Record<string, string> = {
  mrnDate: "`mrnDate` is immutable — it partners srNo in the MRN's unique number",
  srNo: "`srNo` is immutable — it is the truck's position within its mrnDate",
  status: "`status` is not editable here — Start/End unloading own it",
  isRemoved: "`isRemoved` is not editable here — use /api/mrn/[mrnId]/delete",
};

function optionalText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

export async function PATCH(
  req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 canEdit, NOT canView — see app/api/mrn/create/route.ts for why MRN does
  // not become the third module with that landmine.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Digits only, matching app/api/mrn/[mrnId]/route.ts exactly so the read and
  // the edit accept and reject the identical path segment.
  const raw = params.mrnId?.trim() ?? "";
  const mrnId = Number(raw);
  if (!/^\d+$/.test(raw) || mrnId <= 0 || mrnId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid mrnId "${params.mrnId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Refuse the immutable/foreign fields BEFORE anything else, so an attempt to
  // renumber is a clear 400 rather than a silently-ignored key.
  for (const field of Object.keys(FORBIDDEN_FIELDS)) {
    if (field in body) {
      return NextResponse.json({ error: FORBIDDEN_FIELDS[field] }, { status: 400 });
    }
  }

  const data: {
    truckReportingDate?: Date;
    receivedFrom?: string;
    stiRefNo?: string | null;
    deliveryNo?: string | null;
    otrNo?: string | null;
  } = {};

  if (body.truckReportingDate !== undefined) {
    if (typeof body.truckReportingDate !== "string" || body.truckReportingDate.trim() === "") {
      return NextResponse.json(
        { error: "`truckReportingDate` must be a YYYY-MM-DD string" },
        { status: 400 },
      );
    }
    try {
      data.truckReportingDate = parseMrnDate(body.truckReportingDate.trim());
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid truckReportingDate" },
        { status: 400 },
      );
    }
  }

  if (body.receivedFrom !== undefined) {
    const rf = typeof body.receivedFrom === "string" ? body.receivedFrom.trim() : "";
    if (!RECEIVED_FROM.includes(rf as never)) {
      return NextResponse.json(
        { error: `Invalid receivedFrom "${rf}" — expected "TPW" or "CDC"` },
        { status: 400 },
      );
    }
    data.receivedFrom = rf;
  }

  if ("stiRefNo" in body) data.stiRefNo = optionalText(body.stiRefNo) ?? null;
  if ("deliveryNo" in body) data.deliveryNo = optionalText(body.deliveryNo) ?? null;
  if ("otrNo" in body) data.otrNo = optionalText(body.otrNo) ?? null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // isRemoved: false — a soft-removed MRN is gone from both faces (§11 OQ-8),
  // so it 404s here exactly as it does on the read route. The two cases are not
  // distinguished in the response.
  const existing = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }
  if (existing.status !== "open") {
    return NextResponse.json(
      {
        error:
          existing.status === "checking"
            ? "The supervisor is checking this truck — the header is locked."
            : "This MRN is done — the header can no longer be edited.",
      },
      { status: 409 },
    );
  }

  const updated = await prisma.mrn.update({
    where: { id: mrnId },
    data,
    select: {
      id: true,
      mrnNumber: true,
      mrnDate: true,
      srNo: true,
      truckReportingDate: true,
      receivedFrom: true,
      stiRefNo: true,
      deliveryNo: true,
      otrNo: true,
      status: true,
    },
  });

  return NextResponse.json(updated);
}
