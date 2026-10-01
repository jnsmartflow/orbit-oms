import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/so-lab/auth/warm (2026-10-01) — called ONCE, fire-and-forget, when
// the /so-lab login screen first shows its email step. It boots the function
// and opens the pooler connection so the first "Send code" is not a cold start.
//
// • No session needed and no rate limit: it reveals nothing (204, no body) and
//   WRITES NOTHING — one trivial read, SELECT 1. Cost: one tiny read per
//   login-screen open.
// • ⚠ Best effort: Vercel may serve request-code from a different instance, so
//   this lowers the odds of a cold send; it does not guarantee a warm one. The
//   10 s + 8 s retry in lib/otp/send-code-email.ts is what actually covers it.
export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    // Warming is optional — never surface an error.
  }
  return new Response(null, { status: 204 });
}
