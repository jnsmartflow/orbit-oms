// lib/ship-to/parse-form.ts
//
// The multipart body of a ship-to SAVE (Billing POST /api/billing/mail-order/
// ship-to, Floor POST /api/floor/ship-to) → one validated request, or the
// answer to send back. Shape only — no database read happens here; the routes
// check the dealer, the area, ownership and counts after this.
//
// Form fields:
//   mode            dealer | typed | reset                       (required)
//   customerId      positive int                                  (dealer)
//   text            the typed name                                (typed, unless asPerChallan)
//   asPerChallan    "1" / "true"                                  (typed)
//   areaId          positive int                                  (typed — area is REQUIRED for
//                                                                  every typed ship-to, v27.73)
//   files           0..n File, JPG / PNG / PDF                    (typed only)
//   removeCopyIds   0..n positive int                             (typed only)
//
// Server-only (reads the file bytes to sniff the type).

import {
  AS_PER_CHALLAN,
  COPIES_TOO_BIG_MESSAGE,
  MAX_SHIP_TO_TEXT_LEN,
  MAX_TOTAL_COPY_BYTES,
  isAsPerChallanText,
  type ShipToCopyContentType,
} from "@/lib/ship-to/copy";

/** One uploaded file, read into memory and type-checked. */
export interface ParsedCopyFile {
  bytes: Buffer;
  contentType: ShipToCopyContentType;
  size: number;
}

export type ShipToSaveRequest =
  | { mode: "dealer"; customerId: number }
  | {
      mode: "typed";
      /** Trimmed; AS_PER_CHALLAN exactly when asPerChallan. */
      text: string;
      asPerChallan: boolean;
      areaId: number;
      files: ParsedCopyFile[];
      removeCopyIds: number[];
    }
  | { mode: "reset" };

export type ParseResult = { ok: true; req: ShipToSaveRequest } | { ok: false; status: number; error: string };

function positiveInt(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 2147483647 ? n : null;
}

/**
 * The type from the file's first bytes, never from its name or the browser's
 * claim alone. The bucket restricts nothing (allowed_mime_types is NULL), so
 * this is the real guard.
 */
function sniffType(bytes: Buffer): ShipToCopyContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

export async function parseShipToForm(form: FormData): Promise<ParseResult> {
  const mode = typeof form.get("mode") === "string" ? String(form.get("mode")).trim() : "";

  const fileEntries = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const removeRaw = form.getAll("removeCopyIds");

  if (mode !== "typed" && (fileEntries.length > 0 || removeRaw.length > 0)) {
    return { ok: false, status: 400, error: "Files can only be attached to a typed ship-to." };
  }

  if (mode === "dealer") {
    const customerId = positiveInt(form.get("customerId"));
    if (customerId === null) return { ok: false, status: 400, error: "customerId must be a positive integer" };
    return { ok: true, req: { mode: "dealer", customerId } };
  }

  if (mode === "reset") return { ok: true, req: { mode: "reset" } };

  if (mode !== "typed") {
    return { ok: false, status: 400, error: `Invalid mode "${mode}" — expected dealer | typed | reset` };
  }

  // ── typed ────────────────────────────────────────────────────────────────
  const flag = typeof form.get("asPerChallan") === "string" ? String(form.get("asPerChallan")).trim().toLowerCase() : "";
  const rawText = typeof form.get("text") === "string" ? String(form.get("text")).trim() : "";
  // The chip OR the words typed by hand — either way it is As per challan, and
  // the server writes its own spelling.
  const asPerChallan = flag === "1" || flag === "true" || isAsPerChallanText(rawText);
  const text = asPerChallan ? AS_PER_CHALLAN : rawText;
  if (text === "") return { ok: false, status: 400, error: "Type a ship-to name, or tick As per challan." };
  if (text.length > MAX_SHIP_TO_TEXT_LEN) {
    return { ok: false, status: 400, error: `Ship-to name is too long (max ${MAX_SHIP_TO_TEXT_LEN} characters).` };
  }

  const areaId = positiveInt(form.get("areaId"));
  if (areaId === null) return { ok: false, status: 400, error: "Pick an area — it decides the route and the trip stop." };

  const removeCopyIds: number[] = [];
  for (const v of removeRaw) {
    const id = positiveInt(v);
    if (id === null) return { ok: false, status: 400, error: "removeCopyIds must be positive integers" };
    if (!removeCopyIds.includes(id)) removeCopyIds.push(id);
  }

  // Total size BEFORE reading any bytes: the cap is on all files together
  // (owner, 2026-10-19), so one big file and three small ones are judged alike.
  const total = fileEntries.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_COPY_BYTES) return { ok: false, status: 413, error: COPIES_TOO_BIG_MESSAGE };

  const files: ParsedCopyFile[] = [];
  for (const f of fileEntries) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const contentType = sniffType(bytes);
    if (contentType === null) {
      return { ok: false, status: 400, error: `"${f.name}" is not a JPG, PNG or PDF.` };
    }
    files.push({ bytes, contentType, size: bytes.length });
  }

  return { ok: true, req: { mode: "typed", text, asPerChallan, areaId, files, removeCopyIds } };
}
