import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CODE_TTL_MS, RESEND_COOLDOWN_MS } from "@/lib/otp/constants";
import { generateCode, hashCode, normaliseEmail } from "@/lib/otp/code";
import { sendCodeEmail } from "@/lib/otp/send-code-email";
import {
  IP_LIMIT,
  IP_WINDOW_MS,
  REQUEST_CODE_JITTER_MS,
  REQUEST_CODE_MESSAGE,
  REQUEST_CODE_MIN_MS,
  SO_OTP_HMAC_LABEL,
  TEST_MODE_SHOW_CODE,
} from "@/lib/so-auth/constants";
import { findEligibleSoByEmail } from "@/lib/so-auth/eligibility";
import { requestIp, soLabStaffGate } from "@/lib/so-auth/staff-gate";

export const dynamic = "force-dynamic";

// POST /api/so-lab/auth/request-code  { email }
//
// 🔴 NEVER REVEALS ELIGIBILITY. Every outcome — not allowed, IP limit hit,
// inside the 60 s cooldown, code created and emailed, email send failed —
// answers 200 with the same { ok, message, cooldownSeconds } shape, and no
// sooner than REQUEST_CODE_MIN_MS (+ jitter) after the request arrived, so the
// allowed path's insert + email send is not visible as a slower answer.
// testCode is added only while TEST_MODE_SHOW_CODE is on (off since 2026-09-30).
// Sequential awaits only — never prisma.$transaction (CORE §3).

type Outcome = { testCode?: string };

async function issueCode(req: Request, email: string): Promise<Outcome> {
  const now = new Date();
  const ip = requestIp(req);

  // Per-IP limit: counts codes actually issued from this IP in the last hour.
  if (ip) {
    const recent = await prisma.so_login_codes.count({
      where: { requestedIp: ip, createdAt: { gte: new Date(now.getTime() - IP_WINDOW_MS) } },
    });
    if (recent >= IP_LIMIT) return {};
  }

  const so = await findEligibleSoByEmail(email);
  if (!so) return {};

  const latest = await prisma.so_login_codes.findFirst({
    where: { salesOfficerId: so.salesOfficerId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) return {};

  const code = generateCode();
  await prisma.so_login_codes.create({
    data: {
      salesOfficerId: so.salesOfficerId,
      email: so.email,
      codeHash: hashCode(SO_OTP_HMAC_LABEL, String(so.salesOfficerId), code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      requestedIp: ip,
    },
  });

  const sent = await sendCodeEmail({ to: so.email, name: so.name, code });
  if (!sent.ok) {
    // One line, no address, no code, no token.
    console.error(`[so-auth] code email failed: ${sent.reason} soId=${so.salesOfficerId}`);
  }

  return TEST_MODE_SHOW_CODE ? { testCode: code } : {};
}

export async function POST(req: Request): Promise<NextResponse> {
  const denied = await soLabStaffGate();
  if (denied) return denied;

  const startedAt = Date.now();

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const email = normaliseEmail((body as { email?: unknown } | null)?.email);

  const outcome = await issueCode(req, email);

  const floor = REQUEST_CODE_MIN_MS + Math.floor(Math.random() * REQUEST_CODE_JITTER_MS);
  const wait = floor - (Date.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  return NextResponse.json({
    ok: true,
    message: REQUEST_CODE_MESSAGE,
    cooldownSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
    ...(outcome.testCode ? { testCode: outcome.testCode } : {}),
  });
}
