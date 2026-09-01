// lib/mrn/photo.ts
//
// Everything the MRN photo feature needs that is NOT I/O: the bucket name, the
// size budget, the kind vocabulary and the storage-path shape.
//
// PURE. No Prisma, no Supabase, no `fs`, no clock read beyond the UUID. That is
// deliberate and load-bearing: the phone (step 5) imports MAX_WIDTH and
// JPEG_QUALITY to downscale before upload, and the routes import the same
// constants to enforce the result. One definition, both ends — the client
// cannot drift from what the server accepts.
//
// 🔴 NEVER IMPORT lib/supabase.ts FROM HERE, AND NEVER ADD ONE.
// That module is SERVER-ONLY: it holds SUPABASE_SERVICE_ROLE_KEY and there is
// deliberately no anon key anywhere in this app (lib/supabase.ts:3-6). This
// file IS imported by client components, so a Supabase import here would ship
// a service-role client to the browser. That is a security bug, not a build
// error — nothing in tsc or next build would say a word.

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * The private bucket. Created BY HAND in the Supabase dashboard — SQL cannot
 * create a bucket and no migration pretends to.
 *
 * 🔴 ITS OWN BUCKET, NOT A PREFIX INSIDE `attendance-photos`, and the reason is
 * a live cron. app/api/cron/attendance-purge/route.ts scans `attendance_records`
 * and calls .remove() on what it finds; MRN photos under a prefix there would
 * be un-purged today and delete-able by tomorrow's well-meaning edit to that
 * cron. An MRN is a supplier-facing document, a selfie is not — different
 * lifetimes, different buckets (design §4.2).
 *
 * ⚠ MRN HAS NO PURGE CRON AND MUST NOT GROW ONE (design §4.4, an owner
 * reversal from an earlier "90 days"). Deletion is manual, through the
 * canDelete path. Do not widen the attendance cron to see this bucket either.
 */
export const BUCKET = "mrn-photos";

/** Signed-URL lifetime. Matches the attendance precedent
 *  (app/api/admin/attendance/photo/route.ts:10) — the bucket is private and a
 *  leaked link should lose its teeth fast. */
export const SIGNED_URL_EXPIRY_SEC = 300;

/** The only content type accepted or written. The capture path produces JPEG
 *  and nothing else; see MrnPhotoKind below for why the vocabulary is closed. */
export const PHOTO_CONTENT_TYPE = "image/jpeg";

// ── Size budget ──────────────────────────────────────────────────────────────
//
// 🔴 MRN OWNS THESE NUMBERS. DO NOT READ `attendance_settings` (design §4.3).
// Attendance's photoMaxWidth / photoJpegQuality are server-configured FOR
// ATTENDANCE. One owner per behaviour: a damage photo needs more detail than a
// selfie, and a supplier-facing evidence photo must not silently change
// resolution because someone tuned the attendance screen. If MRN's sizes ever
// need to be operator-configurable that is a new settings row of its own, never
// a read of attendance's.

/** Longest edge after client-side downscale. Attendance uses a configured
 *  value around 720; 1600 is chosen so a batch code or a dent is still legible
 *  when billing zooms in. */
export const MAX_WIDTH = 1600;

/**
 * JPEG quality as a 0–1 fraction.
 *
 * 🔴 captureFromVideo() TAKES 0–100, NOT 0–1. lib/attendance/photo.ts:45 does
 * `Math.max(0, Math.min(1, jpegQuality / 100))`, so passing 0.8 there yields
 * 0.008 — a near-black, unusably compressed image that still uploads fine and
 * only looks wrong to a human. Pass JPEG_QUALITY_PERCENT to that function and
 * JPEG_QUALITY to anything taking a canvas-native 0–1 value. The two constants
 * exist precisely so the conversion happens once, here, rather than at every
 * call site where it can be forgotten.
 */
export const JPEG_QUALITY = 0.8;

/** JPEG_QUALITY in the 0–100 form lib/attendance/photo.ts expects. Read the
 *  warning on JPEG_QUALITY before using either. */
export const JPEG_QUALITY_PERCENT = JPEG_QUALITY * 100;

/**
 * Hard ceiling on the uploaded object, enforced server-side.
 *
 * ~5.6× under Vercel's ~4.5MB serverless request-body limit, so a photo can
 * never be the thing that makes a route fail with an opaque platform error.
 * Attendance caps at 500_000 and its live maximum is ~120KB; 800KB leaves real
 * headroom for detail at MAX_WIDTH without approaching the platform limit.
 *
 * ⚠ THE CLIENT DOWNSCALE IS THE PRIMARY DEFENCE AND THIS IS THE BACKSTOP.
 * A raw phone photo is several MB and would breach the platform limit before
 * this check ever ran, so the phone must downscale first (design §4.3) — this
 * exists to catch a client that did not.
 */
export const MAX_PHOTO_BYTES = 800_000;

// ── Kind ─────────────────────────────────────────────────────────────────────

/**
 * What the photo is OF. Mirrors the live CHECK `chk_mrn_photo_kind` exactly:
 *
 *   CHECK (kind IN ('lr','leaky','damage','other'))
 *
 * 🔴 A FIFTH KIND IS A SQL ALTER ON THAT CONSTRAINT FIRST, then this union —
 * never a new literal here alone. Same rule as MrnStatus and MrnReceivedFrom in
 * lib/mrn/types.ts, and the same reason: Prisma cannot see a CHECK, so this
 * union is the only thing standing between a typo and a 500 out of Postgres.
 *
 * ⚠ 'lr' IS TRUCK-LEVEL AND CAN NEVER CARRY A lineId. The second live CHECK,
 * chk_mrn_photo_lr_truck_level, enforces `kind <> 'lr' OR "lineId" IS NULL` —
 * a lorry receipt covers the whole consignment, not one SKU. The upload route
 * mirrors that rule in application code so the operator gets a sentence rather
 * than a raw constraint violation.
 */
export type MrnPhotoKind = "lr" | "leaky" | "damage" | "other";

export const MRN_PHOTO_KINDS: readonly MrnPhotoKind[] = ["lr", "leaky", "damage", "other"];

export function isMrnPhotoKind(value: string): value is MrnPhotoKind {
  return (MRN_PHOTO_KINDS as readonly string[]).includes(value);
}

/** Human label for a kind — the one place these strings are spelled out, so the
 *  phone, the billing band and an error message cannot disagree. */
export const MRN_PHOTO_KIND_LABEL: Record<MrnPhotoKind, string> = {
  lr: "LR / lorry receipt",
  leaky: "Leaky",
  damage: "Damage",
  other: "Other",
};

// ── Path ─────────────────────────────────────────────────────────────────────

/**
 * Where the object lives inside the bucket: `mrn/{mrnId}/{kind}/{uuid}.jpg`
 * (design §4.2).
 *
 * ⚠ THE PATH IS AN IDENTIFIER, NOT A URL, and `mrn_photos.storagePath` stores
 * exactly this. Never store a signed URL: it expires, and a stored expired URL
 * is a broken image with no way back to the object. The read path mints a fresh
 * signed URL every time (app/api/mrn/photo/[photoId]/route.ts).
 *
 * ⚠ RANDOM, NOT SEQUENTIAL, AND NEVER DERIVED FROM THE LINE. A UUID means two
 * photos of the same line in the same second cannot collide, and it keeps the
 * live UNIQUE index on storagePath (mrn_photos_storagePath_key) from ever being
 * the thing that fails an upload. Do not "tidy" this into
 * {lineId}_{timestamp}.jpg — that is exactly the collision the UUID avoids.
 *
 * ⚠ CALLED SERVER-SIDE ONLY. `crypto.randomUUID()` is available on Node's
 * global crypto and in secure browser contexts, but it is referenced inside the
 * function rather than at module scope so importing this file from a client
 * component can never throw on a browser that lacks it.
 */
export function buildPhotoPath(mrnId: number, kind: MrnPhotoKind): string {
  return `mrn/${mrnId}/${kind}/${crypto.randomUUID()}.jpg`;
}
