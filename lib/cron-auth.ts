// Bearer-token auth for Vercel Cron endpoints.
//
// Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}". We compare
// against process.env.CRON_SECRET set in Vercel + .env.local.
//
// Fail-closed: if CRON_SECRET is missing or empty, every request is
// rejected. An undefined env var must NEVER auth as `Bearer undefined`.

export function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}
