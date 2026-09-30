import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CODE_LENGTH, MAX_ATTEMPTS } from "@/lib/otp/constants";
import { codeMatches, normaliseEmail } from "@/lib/otp/code";
import { SO_OTP_HMAC_LABEL } from "@/lib/so-auth/constants";
import { findEligibleSoByEmail } from "@/lib/so-auth/eligibility";
import { createSoSession } from "@/lib/so-auth/session";
import { requestIp, soLabStaffGate } from "@/lib/so-auth/staff-gate";

export const dynamic = "force-dynamic";

type FailReason = "wrong" | "expired" | "too_many";

// Every failure is 401 with the same error text; `reason` only drives the
// page's hint. An email that is not allowed always answers "wrong" — the same
// as a mistyped code — so it cannot be told apart from an allowed one.
function fail(reason: FailReason): NextResponse {
  return NextResponse.json({ ok: false, error: "Code not accepted.", reason }, { status: 401 });
}

// POST /api/so-lab/auth/verify  { email, code }
//
// Checks the SO's LATEST code only (a newer request supersedes older codes,
// and a used latest code means "request a new one"). No transaction (CORE §3),
// so the two races are closed with conditional updateMany counts instead:
//   • an attempt is CLAIMED (attempts + 1 WHERE attempts < 5) before the
//     compare, so parallel guesses cannot exceed 5 in total;
//   • a correct code is consumed WHERE usedAt IS NULL, and a session is created
//     only when that update hit exactly one row — a code logs in once.
export async function POST(req: Request): Promise<NextResponse> {
  const denied = await soLabStaffGate();
  if (denied) return denied;

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const email = normaliseEmail((body as { email?: unknown } | null)?.email);
  const rawCode = (body as { code?: unknown } | null)?.code;
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) return fail("wrong");

  const so = await findEligibleSoByEmail(email);
  if (!so) return fail("wrong");

  const now = new Date();
  const latest = await prisma.so_login_codes.findFirst({
    where: { salesOfficerId: so.salesOfficerId },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, expiresAt: true, attempts: true, usedAt: true },
  });
  if (!latest || latest.usedAt || latest.expiresAt <= now) return fail("expired");
  if (latest.attempts >= MAX_ATTEMPTS) return fail("too_many");

  const claimed = await prisma.so_login_codes.updateMany({
    where: { id: latest.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return fail("too_many");

  if (!codeMatches(SO_OTP_HMAC_LABEL, String(so.salesOfficerId), code, latest.codeHash)) {
    return fail(latest.attempts + 1 >= MAX_ATTEMPTS ? "too_many" : "wrong");
  }

  const consumed = await prisma.so_login_codes.updateMany({
    where: { id: latest.id, usedAt: null },
    data: { usedAt: now },
  });
  if (consumed.count !== 1) return fail("expired");

  const res = NextResponse.json({ ok: true, name: so.name, email: so.email });
  await createSoSession(res, so.salesOfficerId, {
    ip: requestIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  return res;
}
