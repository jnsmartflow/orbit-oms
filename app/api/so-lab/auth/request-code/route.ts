import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CODE_TTL_MS,
  IP_LIMIT,
  IP_WINDOW_MS,
  REQUEST_CODE_MESSAGE,
  RESEND_COOLDOWN_MS,
  TEST_MODE_SHOW_CODE,
} from "@/lib/so-auth/constants";
import { generateCode, hashCode, normaliseEmail } from "@/lib/so-auth/crypto";
import { findEligibleSoByEmail } from "@/lib/so-auth/eligibility";
import { requestIp, soLabStaffGate } from "@/lib/so-auth/staff-gate";

export const dynamic = "force-dynamic";

// POST /api/so-lab/auth/request-code  { email }
//
// 🔴 NEVER REVEALS ELIGIBILITY. Every outcome — not allowed, IP limit hit,
// inside the 60 s cooldown, code created — answers 200 with the same
// { ok, message, cooldownSeconds } shape. The ONE exception is testCode, sent
// only while TEST_MODE_SHOW_CODE is on, which is safe only because the staff
// gate below admits superusers alone.
// Sequential awaits only — never prisma.$transaction (CORE §3).
export async function POST(req: Request): Promise<NextResponse> {
  const denied = await soLabStaffGate();
  if (denied) return denied;

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const email = normaliseEmail((body as { email?: unknown } | null)?.email);

  const generic = {
    ok: true,
    message: REQUEST_CODE_MESSAGE,
    cooldownSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
  };
  const now = new Date();
  const ip = requestIp(req);

  // Per-IP limit: counts codes actually issued from this IP in the last hour.
  if (ip) {
    const recent = await prisma.so_login_codes.count({
      where: { requestedIp: ip, createdAt: { gte: new Date(now.getTime() - IP_WINDOW_MS) } },
    });
    if (recent >= IP_LIMIT) return NextResponse.json(generic);
  }

  const so = await findEligibleSoByEmail(email);
  if (!so) return NextResponse.json(generic);

  const latest = await prisma.so_login_codes.findFirst({
    where: { salesOfficerId: so.salesOfficerId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return NextResponse.json(generic);
  }

  const code = generateCode();
  await prisma.so_login_codes.create({
    data: {
      salesOfficerId: so.salesOfficerId,
      email: so.email,
      codeHash: hashCode(so.salesOfficerId, code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      requestedIp: ip,
    },
  });

  // Real email sending is step 7 — until then the code reaches the owner here.
  return NextResponse.json(TEST_MODE_SHOW_CODE ? { ...generic, testCode: code } : generic);
}
