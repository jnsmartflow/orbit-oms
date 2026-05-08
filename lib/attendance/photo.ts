// Client-side photo capture from a video element via canvas.
// Uses browser canvas APIs only — must NOT be imported on the server.
//
// We only downscale: a low-res stream is preserved at native size.
// The captured frame is the un-mirrored video (the camera-view UI
// applies a CSS scaleX(-1) for selfie feel, but the actual photo
// records reality, not the mirrored preview).

export interface CaptureResult {
  blob: Blob;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

/**
 * Capture the current frame from a playing <video> element, downscale
 * to `maxWidth` (preserving aspect), and JPEG-encode at `jpegQuality`.
 *
 * @param jpegQuality 0–100 (converted to 0–1 internally for canvas API)
 */
export async function captureFromVideo(
  videoEl: HTMLVideoElement,
  maxWidth: number,
  jpegQuality: number,
): Promise<CaptureResult> {
  const sourceWidth = videoEl.videoWidth;
  const sourceHeight = videoEl.videoHeight;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Camera stream not ready yet");
  }

  const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
  const targetWidth = Math.round(sourceWidth * scale);
  const targetHeight = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);

  const quality = Math.max(0, Math.min(1, jpegQuality / 100));
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Photo encoding failed"))),
      "image/jpeg",
      quality,
    );
  });

  return { blob, dataUrl, widthPx: targetWidth, heightPx: targetHeight };
}
