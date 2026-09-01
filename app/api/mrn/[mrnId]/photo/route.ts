import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  BUCKET,
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPE,
  buildPhotoPath,
  isMrnPhotoKind,
  MRN_PHOTO_KINDS,
} from "@/lib/mrn/photo";

export const dynamic = "force-dynamic";

/**
 * POST /api/mrn/[mrnId]/photo — the supervisor attaches a photo.
 *
 * multipart/form-data:
 *   photo    File   image/jpeg, required
 *   kind     string one of lr | leaky | damage | other, required
 *   lineId   string optional. Absent (or blank) = truck-level.
 *   widthPx  string optional \ both nullable in the schema; they are a
 *   heightPx string optional / thumbnail hint, not accounting (design §4.1)
 *
 * ⚠ SIBLING ROUTES, AND THEY LOOK MORE ALIKE THAN THEY ARE:
 *   POST   /api/mrn/[mrnId]/photo        — this file, upload
 *   GET    /api/mrn/[mrnId]/photos       — list for one MRN
 *   GET    /api/mrn/photo/[photoId]      — one signed URL
 *   DELETE /api/mrn/photo/[photoId]      — remove one photo
 * The last two hang off a STATIC `photo` segment that sits beside the dynamic
 * `[mrnId]`. Next resolves static before dynamic, so /api/mrn/photo/7 reaches
 * the photoId route and never [mrnId]. /api/mrn/photo with no id falls through
 * to [mrnId]/route.ts, whose `^\d+$` check 400s it — safe, if confusing to
 * read. Do not rename either segment without walking all four.
 *
 * ── 🔴 409 UNLESS status === 'checking' ─────────────────────────────────────
 * Photos are captured DURING unloading and at no other time. Before Start there
 * is no supervisor on the truck and no line to point at; after End the document
 * is finished and its evidence is fixed.
 *
 * 🔴 THAT GUARD IS ALSO WHAT MAKES mrn_photos."lineId" ON DELETE CASCADE SAFE,
 * and the two must be read together. app/api/mrn/[mrnId]/lines/route.ts:300
 * replaces a truck's lines with deleteMany + createMany, which would take every
 * attached photo with it — but that route 409s unless status === 'open'
 * (lines/route.ts:116-125). Photos exist only from 'checking' onward. The two
 * windows cannot overlap, and the ladder is one-way (no un-start, no reopen —
 * start/route.ts:14-20, header/route.ts:40), so an MRN cannot fall back to
 * 'open' once photos exist either.
 *
 * ⚠ IF A FUTURE SESSION EVER MAKES lines PUT LEGAL AFTER 'open' — a reopen, an
 * un-start, an admin override — THE CASCADE BECOMES A SILENT PHOTO SHREDDER.
 * Change the FK to ON DELETE SET NULL in the same commit, or the first reopened
 * truck loses its damage evidence with no error anywhere.
 *
 * ── Write order (design §4.5) ───────────────────────────────────────────────
 *   1. upload the object
 *   2. insert the row
 *   3. if 2 throws, DELETE THE OBJECT before returning the error
 * `prisma.$transaction` is banned (CORE §3) and could not help anyway: Supabase
 * Storage is not in the database, so no transaction can span the two. Step 3 is
 * the compensating delete that stands in for one. Skipping it leaks objects
 * nothing will ever find — no row references them, so no list, no purge and no
 * audit can reach them again.
 */
export async function POST(
  req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  // ── 1. Session ─────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Permission: canEdit (design §7). floor_supervisor holds it, which is
  // the whole point of this route; same gate + admin bypass as start/end.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canEdit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // This id IS the record of who took the photo — mrn_photos.capturedById is
  // NOT NULL with ON DELETE RESTRICT. Number("") is 0 and finite, so require a
  // real positive integer rather than trusting the coercion.
  const capturedById = Number(session.user.id);
  if (!Number.isInteger(capturedById) || capturedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  // ── 3. Path segment — identical validation to every other MRN route ────────
  const raw = params.mrnId?.trim() ?? "";
  const mrnId = Number(raw);
  if (!/^\d+$/.test(raw) || mrnId <= 0 || mrnId > 2147483647) {
    return NextResponse.json(
      { error: `Invalid mrnId "${params.mrnId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // ── 4. Body ────────────────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileEntry = form.get("photo");
  const photo = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;
  if (!photo) {
    return NextResponse.json({ error: "A photo file is required." }, { status: 400 });
  }

  // ⚠ TYPE FIRST, THEN SIZE. A 5MB PNG should be told it is the wrong format,
  // not that it is too large — the operator can act on the first message.
  if (photo.type !== PHOTO_CONTENT_TYPE) {
    return NextResponse.json(
      { error: "The photo must be a JPEG. Capture it with the in-app camera." },
      { status: 400 },
    );
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    // 413, not 400: this is about the payload, and the phone can act on it by
    // re-encoding smaller. The client downscales first (design §4.3) — reaching
    // here means it did not.
    return NextResponse.json(
      {
        error: `This photo is ${Math.round(photo.size / 1000)}KB. The limit is ${Math.round(
          MAX_PHOTO_BYTES / 1000,
        )}KB — retake it rather than uploading the original.`,
        bytes: photo.size,
        maxBytes: MAX_PHOTO_BYTES,
      },
      { status: 413 },
    );
  }

  const kindRaw = typeof form.get("kind") === "string" ? String(form.get("kind")).trim() : "";
  if (!isMrnPhotoKind(kindRaw)) {
    return NextResponse.json(
      { error: `Invalid kind "${kindRaw}" — expected one of ${MRN_PHOTO_KINDS.join(", ")}.` },
      { status: 400 },
    );
  }
  const kind = kindRaw;

  // Blank string counts as absent: an untouched hidden form field sends "".
  const lineIdRaw = typeof form.get("lineId") === "string" ? String(form.get("lineId")).trim() : "";
  let lineId: number | null = null;
  if (lineIdRaw !== "") {
    const parsed = Number(lineIdRaw);
    if (!/^\d+$/.test(lineIdRaw) || parsed <= 0 || parsed > 2147483647) {
      return NextResponse.json(
        { error: `Invalid lineId "${lineIdRaw}" — expected a positive integer` },
        { status: 400 },
      );
    }
    lineId = parsed;
  }

  // 🔴 MIRRORS chk_mrn_photo_lr_truck_level IN APPLICATION CODE, ON PURPOSE.
  // The live CHECK (kind <> 'lr' OR "lineId" IS NULL) would refuse this too,
  // but a raw Postgres constraint violation is a 500 with a constraint name in
  // it — not something an operator on a phone can act on. The DB is the
  // backstop; this sentence is the answer.
  if (kind === "lr" && lineId !== null) {
    return NextResponse.json(
      {
        error:
          "An LR photo belongs to the whole truck, not to one line — it cannot be attached to a line.",
      },
      { status: 400 },
    );
  }

  // Nullable in the schema and only a thumbnail hint, so a missing or unparsable
  // value is null rather than an error (design §4.1).
  const widthPx = optionalPositiveInt(form.get("widthPx"));
  const heightPx = optionalPositiveInt(form.get("heightPx"));

  // ── 5. State guards. Sequential awaits, never $transaction (CORE §3) ───────
  const mrn = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: { status: true },
  });
  if (!mrn) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }
  if (mrn.status !== "checking") {
    return NextResponse.json(
      {
        error:
          mrn.status === "open"
            ? "Tap Start unloading before adding photos."
            : "This MRN is finished — photos can no longer be added.",
        status: mrn.status,
      },
      { status: 409 },
    );
  }

  // The line must belong to THIS MRN. A mismatch is a 404, never a silent write
  // against another truck's line — the two ids are adjacent integers and a
  // client bug that crossed them would be invisible in the response. Same rule
  // and same reasoning as app/api/mrn/[mrnId]/line/[lineId]/route.ts.
  if (lineId !== null) {
    const line = await prisma.mrn_lines.findFirst({
      where: { id: lineId, mrnId },
      select: { id: true },
    });
    if (!line) {
      return NextResponse.json(
        { error: "That line does not belong to this MRN." },
        { status: 404 },
      );
    }
  }

  // ── 6. Upload, then insert, then compensate ────────────────────────────────
  const storagePath = buildPhotoPath(mrnId, kind);
  const supabase = getSupabaseAdmin();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, photo, {
      contentType: PHOTO_CONTENT_TYPE,
      // false: the path carries a fresh UUID, so a collision would mean
      // something is very wrong and must not be papered over by overwriting a
      // photo that is already someone's evidence.
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json(
      { error: `Photo upload failed: ${uploadError.message}` },
      { status: 500 },
    );
  }

  try {
    const created = await prisma.mrn_photos.create({
      data: {
        mrnId,
        lineId,
        kind,
        storagePath,
        bytes: photo.size,
        widthPx,
        heightPx,
        capturedById,
      },
      select: {
        id: true,
        mrnId: true,
        lineId: true,
        kind: true,
        bytes: true,
        widthPx: true,
        heightPx: true,
        createdAt: true,
        capturedBy: { select: { name: true } },
      },
    });

    return NextResponse.json(
      {
        id: created.id,
        mrnId: created.mrnId,
        lineId: created.lineId,
        kind: created.kind,
        bytes: created.bytes,
        widthPx: created.widthPx,
        heightPx: created.heightPx,
        createdAt: created.createdAt,
        capturedByName: created.capturedBy?.name ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    // 🔴 THE COMPENSATING DELETE (design §4.5 step 3). The object is already in
    // the bucket and the row that would have referenced it does not exist, so
    // without this the object is unreachable for ever: no list query returns
    // it, no delete path can name it, and no cron exists to sweep it (§4.4 —
    // there is deliberately none). Removing it here is the only chance.
    //
    // Its own failure is logged and swallowed: the caller's error is the INSERT
    // failure, and replacing that with a cleanup failure would hide the actual
    // cause. A leaked object is a cost; a misreported error is a debugging day.
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (cleanupError) {
      console.error(
        `[mrn/photo] ORPHANED OBJECT — insert failed for mrn ${mrnId} and the compensating delete also failed. Path: ${storagePath}. Cleanup error: ${cleanupError.message}`,
      );
    }

    console.error(`[mrn/photo] insert failed for mrn ${mrnId}:`, err);
    return NextResponse.json(
      { error: "The photo could not be saved. Please try again." },
      { status: 500 },
    );
  }
}

/** A positive integer from a form field, or null. Never throws and never 400s —
 *  these two fields are a rendering hint, not data anything accounts on. */
function optionalPositiveInt(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}
