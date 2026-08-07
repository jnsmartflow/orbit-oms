import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MIN_NOTES_FONT_PX,
  MAX_NOTES_FONT_PX,
} from "@/lib/mail-orders/notes-font-size";

export const dynamic = "force-dynamic";

// POST /api/user/notes-font-size
// Sets the CURRENT user's notes-band text size, in px. Body: { size: number }.
//
// There is deliberately NO GET. The value is read server-side in the
// /mail-orders layout (getNotesFontSize → NotesFontSizeProvider), so a GET would
// only ever serve a client fetch that would flash the default before snapping to
// the stored size.
//
// The user id comes from the SESSION and never from the body — same stance as
// app/api/attendance/consent/route.ts, which this route is modelled on. A
// client-supplied id would let any logged-in user rewrite anyone's preference.
export async function POST(req: Request) {
  const session = await auth();
  const userIdRaw = session?.user?.id;
  if (!userIdRaw) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const userId = parseInt(userIdRaw, 10);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  // A malformed body must be a 400, not a 500 — .json() throws on empty or
  // non-JSON input.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const size = (body as { size?: unknown })?.size;

  // Validate rather than clamp. A clamp would silently accept 99 and write 15,
  // so a buggy caller would look like it worked; the CHECK constraint
  // chk_users_notes_font_size would reject it anyway and surface as a 500.
  // Integer only — the column is `integer`, so 12.5 is not storable.
  if (
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < MIN_NOTES_FONT_PX ||
    size > MAX_NOTES_FONT_PX
  ) {
    return NextResponse.json(
      { error: `size must be an integer between ${MIN_NOTES_FONT_PX} and ${MAX_NOTES_FONT_PX}` },
      { status: 400 },
    );
  }

  // One sequential await — never $transaction (Vercel pooler timeout rule), and
  // never updateMany: this is a primary-key update, so it cannot fan out.
  await prisma.users.update({
    where: { id: userId },
    data: { notesFontSize: size },
  });

  return NextResponse.json({ ok: true });
}
