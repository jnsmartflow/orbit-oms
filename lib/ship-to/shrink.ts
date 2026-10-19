// lib/ship-to/shrink.ts
//
// CLIENT ONLY — browser canvas APIs. Shrinks a challan photo before upload so a
// phone picture (several MB) fits the 4 MB-per-save cap (lib/ship-to/copy.ts
// MAX_TOTAL_COPY_BYTES). The server is the backstop; this is the first defence.
//
//   JPG / PNG → JPEG, longest side ≤ SHRINK_MAX_SIDE, quality SHRINK_JPEG_QUALITY
//   PDF       → sent as-is (it cannot be re-encoded here)
//
// A challan is a paper document: 1600px keeps print legible when zoomed, the
// same figure MRN chose for its damage photos (lib/mrn/photo.ts MAX_WIDTH).
// EXIF orientation is honoured (`imageOrientation: "from-image"`), so a phone
// photo is not uploaded sideways.

export const SHRINK_MAX_SIDE = 1600;
/** Canvas-native 0–1 (NOT the 0–100 lib/attendance/photo.ts takes). */
export const SHRINK_JPEG_QUALITY = 0.8;

export async function shrinkCopyFile(file: File): Promise<File> {
  if (file.type !== "image/jpeg" && file.type !== "image/png") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Undecodable here — send the original and let the server judge it.
    return file;
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > SHRINK_MAX_SIDE ? SHRINK_MAX_SIDE / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // White under a PNG's transparency, or JPEG turns it black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", SHRINK_JPEG_QUALITY));
  if (!blob) return file;
  // A small JPEG can come out larger re-encoded — keep whichever is smaller.
  if (file.type === "image/jpeg" && blob.size >= file.size) return file;

  const base = file.name.replace(/\.[^.]+$/, "") || "challan";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}
