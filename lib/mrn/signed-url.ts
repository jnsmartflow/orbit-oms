// lib/mrn/signed-url.ts
//
// A tiny client-side cache in front of GET /api/mrn/photo/[photoId].
//
// 🔴 WHY A CACHE AT ALL. Without one, the band mints a URL per thumbnail and
// then the lightbox mints the SAME url again the moment one is opened — the
// photo billing looks at costs two round trips to show one image. With it, the
// band's fetch is the only one and opening a photo is free.
//
// 🔴 NEVER STORE A SIGNED URL SERVER-SIDE OR IN THE DB. This cache lives in
// module memory for the life of the tab and nowhere else. `mrn_photos` holds
// the PATH; a stored URL expires and becomes a broken image with no way back to
// the object (design §4.2).
//
// ⚠ THE ROUTE'S URLs LAST 300s (SIGNED_URL_EXPIRY_SEC). A viewer left open on
// a desk for six minutes is normal, so anything reading from here must be able
// to re-mint: entries are treated as stale a minute EARLY, and `force` skips
// the cache outright for the case where a URL was fine when handed out and
// expired between then and the click.

const TTL_MS = 300_000;
/** Re-mint with a minute to spare rather than racing the expiry. A URL fetched
 *  at 299s is technically valid and practically a broken image. */
const REFRESH_MARGIN_MS = 60_000;

const cache = new Map<number, { url: string; mintedAt: number }>();

export function forgetSignedUrl(photoId: number): void {
  cache.delete(photoId);
}

export async function getSignedUrl(photoId: number, force = false): Promise<string> {
  const hit = cache.get(photoId);
  if (!force && hit && Date.now() - hit.mintedAt < TTL_MS - REFRESH_MARGIN_MS) {
    return hit.url;
  }

  const res = await fetch(`/api/mrn/photo/${photoId}`, { cache: "no-store" });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? "Could not load this photo.");
  }
  const json = (await res.json()) as { signedUrl: string };
  cache.set(photoId, { url: json.signedUrl, mintedAt: Date.now() });
  return json.signedUrl;
}

/**
 * Fetch the bytes behind a photo, re-minting once if the URL has gone stale.
 *
 * ⚠ ONE RETRY, NOT A LOOP. A 403 from an expired token is worth exactly one
 * fresh URL; a second failure is a real problem (deleted object, revoked key,
 * no network) and must surface rather than spin.
 */
export async function fetchPhotoBlob(photoId: number): Promise<Blob> {
  let url = await getSignedUrl(photoId);
  let res = await fetch(url);
  if (!res.ok) {
    url = await getSignedUrl(photoId, true);
    res = await fetch(url);
  }
  if (!res.ok) throw new Error("Could not download this photo.");
  return res.blob();
}
