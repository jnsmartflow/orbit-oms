import { CODE_TTL_MS } from "./constants";

// Sends a one-time login code by email through Zoho ZeptoMail (2026-09-30).
// Channel-neutral (moved out of the sales-officer login 2026-09-30); server-only. Callers
// today: the sales-officer request-code route only.
//
// • Auth: env var ZEPTOMAIL_TOKEN (Vercel, Production + Preview). Its value
//   already carries the "Zoho-enczapikey " prefix and is sent as-is.
//   🔴 NEVER log, return or echo the token — or the code, or the address.
// • India data centre: a token only works on its own DC.
// • Sender noreply@orbitoms.in — orbitoms.in is verified in ZeptoMail (DKIM + CNAME).
// • fetch only, no SDK (no new npm package). 8 s timeout.
// • Failure reasons are short strings: HTTP status + Zoho error code, never
//   the response body (it could echo request details).

const ZEPTO_API_URL = "https://api.zeptomail.in/v1.1/email";
const FROM = { address: "noreply@orbitoms.in", name: "Orbit" };
const SUBJECT = "Orbit login code";
const TIMEOUT_MS = 8000;

export type SendCodeResult = { ok: true } | { ok: false; reason: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBodies(name: string, code: string): { html: string; text: string } {
  const minutes = Math.round(CODE_TTL_MS / 60000);
  const text =
    `Hello ${name},\n\n` +
    `Your Orbit login code is ${code}. It is valid for ${minutes} minutes.\n\n` +
    `If you did not ask for this code, ignore this email.\n\n— Orbit`;

  // Outlook-safe: tables, inline styles, no external images, no web fonts.
  const html =
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F5F3FF;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F3FF;">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="max-width:440px;background:#FFFFFF;border:1px solid #E9E7F0;border-radius:8px;">` +
    `<tr><td style="padding:24px 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1B1826;">` +
    `<div style="font-size:18px;font-weight:bold;color:#6D28D9;">Orbit</div>` +
    `<p style="margin:16px 0 0 0;">Hello ${escapeHtml(name)},</p>` +
    `<p style="margin:12px 0 0 0;">Your Orbit login code is</p>` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:12px 24px;">` +
    `<div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:bold;` +
    `letter-spacing:8px;color:#1B1826;">${code}</div>` +
    `</td></tr>` +
    `<tr><td style="padding:8px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1B1826;">` +
    `<p style="margin:0;">It is valid for ${minutes} minutes.</p>` +
    `<p style="margin:12px 0 0 0;color:#6B6878;">If you did not ask for this code, ignore this email.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;

  return { html, text };
}

export async function sendCodeEmail(args: {
  to: string;
  name: string;
  code: string;
}): Promise<SendCodeResult> {
  const token = process.env.ZEPTOMAIL_TOKEN;
  if (!token) return { ok: false, reason: "no-token" };

  const { html, text } = buildBodies(args.name, args.code);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ZEPTO_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({
        from: FROM,
        to: [{ email_address: { address: args.to, name: args.name } }],
        subject: SUBJECT,
        htmlbody: html,
        textbody: text,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.ok) return { ok: true };

    // Zoho error shape: { error: { code: "TM_…", … } }. Keep the code only.
    let zohoCode = "";
    try {
      const data = (await res.json()) as { error?: { code?: unknown } };
      const c = data?.error?.code;
      if (typeof c === "string" && /^[A-Za-z0-9_]{1,40}$/.test(c)) zohoCode = c;
    } catch {
      // body not JSON — status alone
    }
    return { ok: false, reason: zohoCode ? `http-${res.status} ${zohoCode}` : `http-${res.status}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
