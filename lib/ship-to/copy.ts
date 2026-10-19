// lib/ship-to/copy.ts
//
// Everything the typed ship-to + dealer / SO challan copy feature needs that is
// NOT I/O: the bucket, the limits, the "As per challan" constant, the type map
// and the storage-path shape. Design:
// docs/prompts/drafts/web-update-2026-10-19-ship-to-freetext.md §2 / §4,
// Schema v27.73 (CORE §7).
//
// PURE. No Prisma, no Supabase. The shared modal (P2) imports these limits so
// the screen and the routes cannot disagree — the same rule as lib/mrn/photo.ts.
//
// 🔴 NEVER IMPORT lib/supabase.ts FROM HERE. That module holds the service-role
// key; this file is imported by client components.

/**
 * The private bucket. Made BY HAND in Supabase Storage (v27.73): private, no
 * RLS policies, 4 MB object limit.
 *
 * 🔴 NOT `attendance-photos` — its purge cron deletes objects. A dealer copy is
 * kept: there is no purge, only soft-remove (ship_to_copies.removedAt).
 * ⚠ The bucket's allowed_mime_types is NULL (read live 2026-10-19), so the type
 * map and the byte sniff in lib/ship-to/parse-form.ts are the only type guard.
 */
export const SHIP_TO_BUCKET = "ship-to-challans";

/** Signed-URL lifetime — the MRN / attendance precedent. */
export const SHIP_TO_SIGNED_URL_EXPIRY_SEC = 300;

/**
 * The fixed text of an "As per challan" ship-to. The server writes THIS string
 * whenever the As per challan chip is on, whatever text the browser sent, and
 * treats a typed name equal to it (any case) as As per challan too — so the
 * copy-required rule cannot be walked past by typing the words by hand.
 */
export const AS_PER_CHALLAN = "As per challan";

export function isAsPerChallanText(text: string): boolean {
  return text.trim().toLowerCase() === AS_PER_CHALLAN.toLowerCase();
}

/** Longest typed ship-to name accepted. The column has no limit; a site name
 *  longer than this is a paste accident. */
export const MAX_SHIP_TO_TEXT_LEN = 200;

/** Active copies one OWNER may hold (a mail order for Billing, a bill for
 *  Floor). Counted on the server before every write. */
export const MAX_ACTIVE_COPIES = 3;

/**
 * Cap on ALL files of one save together (owner, 2026-10-19 — no per-file cap
 * below it). 4 MiB = the bucket's own object limit, and with the form fields
 * still under Vercel's ~4.5 MB request-body limit, so a save can never die on
 * an opaque platform error. Images are shrunk in the browser first (P2).
 */
export const MAX_TOTAL_COPY_BYTES = 4 * 1024 * 1024;

export const COPIES_TOO_BIG_MESSAGE = "Files too big together (max 4 MB). Save fewer, then add more.";

/** The three accepted types. Mirrors the live CHECK chk_ship_to_copies_content_type. */
export type ShipToCopyContentType = "image/jpeg" | "image/png" | "application/pdf";

/** Content type → file extension. The stored path takes its extension from
 *  HERE, never from the uploaded file's name. */
export const COPY_TYPE_EXT: Record<ShipToCopyContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

export function isShipToCopyContentType(value: string): value is ShipToCopyContentType {
  return Object.prototype.hasOwnProperty.call(COPY_TYPE_EXT, value);
}

/** Who owns a copy. Billing copies hang off the mail order (every bill of the
 *  SO that still has Billing's ship-to shows them); Floor copies off one bill. */
export type ShipToCopyOwner = "billing" | "floor";

/**
 * Where the object lives inside the bucket:
 *   mo/{moOrderId}/{uuid}.{ext}     — a Billing copy
 *   order/{orderId}/{uuid}.{ext}    — a Floor copy
 * A PATH, never a URL (a stored URL expires). Random, never derived from the
 * file name. Server-side only — crypto.randomUUID is read inside the function.
 */
export function buildCopyPath(owner: ShipToCopyOwner, ownerId: number, contentType: ShipToCopyContentType): string {
  const prefix = owner === "billing" ? "mo" : "order";
  return `${prefix}/${ownerId}/${crypto.randomUUID()}.${COPY_TYPE_EXT[contentType]}`;
}
