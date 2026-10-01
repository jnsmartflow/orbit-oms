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
import { requestIp, soLabStaffGate } from "@/lib/so-auth/staff-gate";

export const dynamic = "force-dynamic";
// 🔴 2026-10-01: OTP send gets 10 s + one 8 s retry and maxDuration 30; a failed
// send deletes its code row so the cooldown never blocks a retry — do not
// restore the single 8 s attempt.
export const maxDuration = 30;

// POST /api/so-lab/auth/request-code  { email }
//
// 🔴 NEVER REVEALS ELIGIBILITY. Every outcome — not allowed, IP limit hit,
// inside the cooldown, code created and emailed, email send failed — answers
// 200 with the same { ok, message, cooldownSeconds } shape, and no sooner than
// REQUEST_CODE_MIN_MS (+ jitter) after the request arrived. Accepted trade-off:
// when ZeptoMail itself is slow (or the one retry runs), an ALLOWED email's
// answer comes later than the floor. An attacker cannot cause that.
// testCode is added only while TEST_MODE_SHOW_CODE is on (off since 2026-09-30).
// Sequential awaits only — never prisma.$transaction (CORE §3).
//
// FEWER STEPS BEFORE THE SEND (2026-10-01). Round trips before the email is
// handed to ZeptoMail: was 5 (IP count, SO lookup, grant lookup, latest code,
// insert) → now 2 (ONE combined read below, then the insert). The 30 s lock-
// switch read in soLabStaffGate is cached per instance and unchanged.

type Outcome = { testCode?: string };

type GateRow = {
  id: number;
  name: string;
  email: string;
  ipCount: number;
  lastAt: Date | null;
};

async function issueCode(req: Request, email: string, startedAt: number): Promise<Outcome> {
  if (!email) return {};
  const now = new Date();
  const ip = requestIp(req);

  // ONE round trip: eligibility (an ACTIVE SO with this email AND a live
  // so_order_access grant) + this IP's codes in the last hour + this SO's
  // newest code. Same rules as findEligibleSoByEmail (case-insensitive, trimmed,
  // exactly one match) — LIMIT 2 so a duplicate email reads as NOT eligible.
  // No IP → "" matches no row (requestedIp is never ""), so ipCount is 0 and the
  // IP limit is skipped, as before.
  const rows = await prisma.$queryRaw<GateRow[]>`
    SELECT so.id, so.name, so.email,
           (SELECT COUNT(*)::int FROM so_login_codes c
             WHERE c."requestedIp" = ${ip ?? ""}
               AND c."createdAt" >= ${new Date(now.getTime() - IP_WINDOW_MS)}) AS "ipCount",
           (SELECT MAX(c."createdAt") FROM so_login_codes c
             WHERE c."salesOfficerId" = so.id) AS "lastAt"
      FROM sales_officer_master so
     WHERE lower(btrim(so.email)) = ${email}
       AND so."isActive" = true
       AND EXISTS (SELECT 1 FROM so_order_access a
                    WHERE a."salesOfficerId" = so.id AND a."revokedAt" IS NULL)
     LIMIT 2`;
  if (rows.length !== 1) return {};
  const so = rows[0];
  const soEmail = so.email.trim().toLowerCase();

  if (so.ipCount >= IP_LIMIT) return {};
  if (so.lastAt && now.getTime() - new Date(so.lastAt).getTime() < RESEND_COOLDOWN_MS) return {};

  // The row is written BEFORE the send so verify can find it…
  const code = generateCode();
  const created = await prisma.so_login_codes.create({
    data: {
      salesOfficerId: so.id,
      email: soEmail,
      codeHash: hashCode(SO_OTP_HMAC_LABEL, String(so.id), code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      requestedIp: ip,
    },
    select: { id: true },
  });
  const dbMs = Date.now() - startedAt;

  const sendStart = Date.now();
  const sent = await sendCodeEmail({ to: soEmail, name: so.name, code });
  const sendMs = Date.now() - sendStart;

  if (!sent.ok) {
    // …and DELETED if the send finally failed: the cooldown then does not apply
    // (an immediate retry works) and a code nobody received can never verify.
    await prisma.so_login_codes.deleteMany({ where: { id: created.id } });
    // One line, no address, no code, no token.
    console.error(`[so-auth] code email failed: ${sent.reason} attempts=${sent.attempts} soId=${so.id}`);
  }
  // Timing — eligible SO with a code issued only; no address, no code.
  console.log(
    `[so-auth] request-code ms: db=${dbMs} send=${sendMs} total=${Date.now() - startedAt} ` +
    `attempts=${sent.attempts} ok=${sent.ok}`,
  );

  return TEST_MODE_SHOW_CODE && sent.ok ? { testCode: code } : {};
}

export async function POST(req: Request): Promise<NextResponse> {
  const denied = await soLabStaffGate();
  if (denied) return denied;

  const startedAt = Date.now();

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const email = normaliseEmail((body as { email?: unknown } | null)?.email);

  const outcome = await issueCode(req, email, startedAt);

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
