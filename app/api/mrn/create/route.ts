import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import { allocateMrnIdentity } from "@/lib/mrn/number";
import { parseMrnDate } from "@/lib/mrn/queries";

export const dynamic = "force-dynamic";

/**
 * POST /api/mrn/create — billing raises a new MRN header.
 *
 * Body: { truckReportingDate, receivedFrom, stiRefNo?, deliveryNo?, otrNo? }
 *
 * `mrnDate` is TODAY IST — the date the MRN was RAISED — and is never taken
 * from the body. It partners `srNo` in UNIQUE(mrnDate, srNo) and drives
 * billing's date stepper; `truckReportingDate` is a SEPARATE, caller-supplied
 * fact (the day the truck reported) that every screen labelled "reported"
 * shows. Both are immutable after create (design §11 OQ-5). In normal operation
 * they are the same day, which is exactly what makes confusing them easy.
 *
 * Composed from the two EXPORTED date helpers — getTodayIST() (lib/dates.ts)
 * and parseMrnDate() (lib/mrn/queries.ts) — rather than a third copy of the IST
 * offset arithmetic. getMrnBillingBoard()'s istTodayDateOnly() is file-local by
 * design; this route does not reach into it or clone it.
 */

/** The two source depots. Pinned in application code so a bad value is a clean
 *  400, never a 500 out of chk_mrn_received_from. The DB CHECK is the BACKSTOP,
 *  not the error message. A third depot is a SQL ALTER first, never a new
 *  literal here (design §11, "Carried forward unchanged"). */
const RECEIVED_FROM = ["TPW", "CDC"] as const;

/** Trim an optional free-text header field; "" becomes null, not "". */
function optionalText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 canEdit, NOT canView. Mail Orders and Picking each carry a documented
  // landmine where write routes gated on the READ flag (CLAUDE_PICKING.md §7);
  // MRN does not become the third. The explicit admin wrapper matches the
  // step-4 MRN read routes — checkAnyPermission also short-circuits admin
  // internally, so the bypass holds either way.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // session.user.id is a string (lib/auth.ts: `id: user.id.toString()`).
  // Number("") is 0, which is finite — so require a real positive integer
  // rather than trusting isFinite, or an absent id becomes createdById: 0.
  // Same shape as app/api/picking/assign/route.ts.
  const createdById = Number(session.user.id);
  if (!Number.isInteger(createdById) || createdById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    truckReportingDate?: unknown;
    receivedFrom?: unknown;
    stiRefNo?: unknown;
    deliveryNo?: unknown;
    otrNo?: unknown;
  };

  // ── Validate everything BEFORE the first write ──────────────────────────────
  if (typeof body.truckReportingDate !== "string" || body.truckReportingDate.trim() === "") {
    return NextResponse.json(
      { error: "`truckReportingDate` is required — expected YYYY-MM-DD" },
      { status: 400 },
    );
  }
  let truckReportingDate: Date;
  try {
    // Throws on a malformed or impossible calendar date ("2026-02-30"), which
    // surfaces as a clean 400 instead of a silently-rolled-over March date.
    truckReportingDate = parseMrnDate(body.truckReportingDate.trim());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid truckReportingDate" },
      { status: 400 },
    );
  }

  const receivedFrom = typeof body.receivedFrom === "string" ? body.receivedFrom.trim() : "";
  if (!RECEIVED_FROM.includes(receivedFrom as never)) {
    return NextResponse.json(
      { error: `Invalid receivedFrom "${receivedFrom}" — expected "TPW" or "CDC"` },
      { status: 400 },
    );
  }

  const stiRefNo = optionalText(body.stiRefNo) ?? null;
  const deliveryNo = optionalText(body.deliveryNo) ?? null;
  const otrNo = optionalText(body.otrNo) ?? null;

  const mrnDate = parseMrnDate(getTodayIST());

  // ── Allocate + insert, with a bounded retry ─────────────────────────────────
  //
  // 🔴 THIS RETRY IS LOAD-BEARING, NOT DEFENSIVE NOISE. Allocation is MAX+1 and
  // deliberately NOT atomic — lib/mrn/number.ts says so in its own header, and
  // the two UNIQUE indexes (mrn_mrnNumber_key, mrn_mrnDate_srNo_key) are the
  // real backstop. Two operators raising an MRN in the same second read the
  // same maximum, and the loser's INSERT throws P2002 on a screen where they
  // did nothing wrong.
  //
  // So: catch P2002 and retry the WHOLE allocate+insert (re-reading the maximum
  // is the entire point — retrying the insert alone would collide again with
  // the same number). Sequential awaits, bounded at 3 attempts.
  //
  // Do NOT "fix" this race with prisma.$transaction. It is banned here (Vercel
  // serverless + the Supabase pooler time out on it — CORE §3), and at this
  // depot the window is one billing operator raising roughly four MRNs a day.
  //
  // Nothing partial can be left behind: the create is ONE write, so a failed
  // attempt wrote nothing at all and the next attempt starts clean.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const identity = await allocateMrnIdentity(mrnDate);

    try {
      const created = await prisma.mrn.create({
        data: {
          mrnNumber: identity.mrnNumber,
          mrnDate,
          srNo: identity.srNo,
          truckReportingDate,
          receivedFrom,
          receivingWarehouse: "Surat",
          status: "open",
          stiRefNo,
          deliveryNo,
          otrNo,
          createdById,
        },
        select: { id: true, mrnNumber: true, mrnDate: true, srNo: true, status: true },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      const collided =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

      if (collided && attempt < MAX_ATTEMPTS) continue;

      if (collided) {
        // Third failure: give up and say so plainly. 409, not 500 — nothing is
        // broken, two people simply raised an MRN at the same moment and this
        // one lost three times. The operator retries; no cleanup is needed
        // because no row was written.
        return NextResponse.json(
          {
            error:
              "Could not allocate an MRN number — another MRN was created at the same moment. Please try again.",
          },
          { status: 409 },
        );
      }

      throw err;
    }
  }

  // Unreachable: the loop either returns or throws. Present so the function has
  // a total return type rather than an implicit undefined path.
  return NextResponse.json({ error: "Could not allocate an MRN number." }, { status: 409 });
}
