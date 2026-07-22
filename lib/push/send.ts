import { setVapidDetails, sendNotification, WebPushError } from "web-push";
import { prisma } from "@/lib/prisma";

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export interface EndpointResult {
  endpoint: string;
  ok: boolean;
  statusCode?: number;
  deactivated?: boolean;
  error?: string;
}

export interface SendSummary {
  userId: number;
  total: number;
  sent: number;
  failed: number;
  results: EndpointResult[];
  /** Set only when nothing could be attempted (missing VAPID / DB read failed). */
  fatalError?: string;
}

/**
 * VAPID config from env. Throws a CLEAR error if missing — callers inside
 * sendToUser() catch it and fold it into the summary (never propagate).
 */
export function getVapid(): { publicKey: string; privateKey: string; subject: string } {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@orbitoms.in";
  if (!publicKey || !privateKey) {
    throw new Error(
      "VAPID keys not configured — set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
    );
  }
  return { publicKey, privateKey, subject };
}

/**
 * Send `payload` to every ACTIVE push subscription of one user, one endpoint at
 * a time (sequential awaits — never prisma.$transaction, CORE §3).
 *
 * Dead-endpoint hygiene:
 *  - HTTP 404 / 410 from the push service → the phone is gone for good →
 *    isActive=false immediately.
 *  - any other failure → failureCount+1; once it reaches 5, isActive=false.
 *  - success → reset failureCount to 0 and stamp lastSeenAt.
 *
 * Every write sets `updatedAt` EXPLICITLY (the column has a DB default but no
 * trigger, and the model is a plain field, not @updatedAt — see schema).
 *
 * NEVER throws: a failed buzz must not break the picking action that triggered
 * it. All outcomes are folded into the returned summary.
 */
export async function sendToUser(userId: number, payload: PushPayload): Promise<SendSummary> {
  const summary: SendSummary = { userId, total: 0, sent: 0, failed: 0, results: [] };

  try {
    const { publicKey, privateKey, subject } = getVapid();
    setVapidDetails(subject, publicKey, privateKey);

    const subs = await prisma.push_subscriptions.findMany({
      where: { userId, isActive: true },
      select: { id: true, endpoint: true, p256dh: true, auth: true, failureCount: true },
    });
    summary.total = subs.length;

    const body = JSON.stringify(payload);

    for (const sub of subs) {
      try {
        const res = await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        // Success — device is alive: clear failures, stamp lastSeenAt.
        await prisma.push_subscriptions.update({
          where: { id: sub.id },
          data: { failureCount: 0, lastSeenAt: new Date(), updatedAt: new Date() },
        });
        summary.sent++;
        summary.results.push({ endpoint: sub.endpoint, ok: true, statusCode: res.statusCode });
      } catch (err) {
        summary.failed++;
        const statusCode = err instanceof WebPushError ? err.statusCode : undefined;

        if (statusCode === 404 || statusCode === 410) {
          // Gone for good — deactivate now.
          await prisma.push_subscriptions.update({
            where: { id: sub.id },
            data: { isActive: false, updatedAt: new Date() },
          });
          summary.results.push({ endpoint: sub.endpoint, ok: false, statusCode, deactivated: true });
        } else {
          // Transient/unknown — count it; deactivate at 5.
          const nextCount = sub.failureCount + 1;
          const deactivate = nextCount >= 5;
          await prisma.push_subscriptions.update({
            where: { id: sub.id },
            data: { failureCount: nextCount, isActive: !deactivate, updatedAt: new Date() },
          });
          summary.results.push({
            endpoint: sub.endpoint,
            ok: false,
            statusCode,
            deactivated: deactivate,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } catch (err) {
    // getVapid() throw or the findMany read failed — record, do not propagate.
    summary.fatalError = err instanceof Error ? err.message : String(err);
  }

  return summary;
}
