"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";

interface PhotoViewerProps {
  recordId: number;
}

// Lazy fetch of a 5-min signed Supabase URL via /api/admin/attendance/photo.
// Re-fetches when `recordId` changes. No client-side cache: the 5-min
// URL expiry would invalidate any cache anyway, and admins flip between
// users only a handful of times per session.
export function PhotoViewer({ recordId }: PhotoViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);

    fetch(`/api/admin/attendance/photo?recordId=${recordId}`)
      .then(async (res) => {
        if (cancelled) return undefined;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data && typeof data.error === "string" && data.error) ||
              `HTTP ${res.status}`,
          );
        }
        return res.json() as Promise<{ signedUrl: string }>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setUrl(data.signedUrl);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load photo");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [recordId]);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-gray-100 flex items-center justify-center text-[11px] text-gray-400">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="absolute inset-0 bg-gray-100 flex flex-col items-center justify-center gap-1 text-[11px] text-gray-400">
        <Camera className="w-6 h-6" />
        {error}
      </div>
    );
  }
  if (!url) return null;

  // Signed URL — admin-side, low traffic. <Image> from next/image would
  // require domain whitelisting per signed-URL host; the standard <img>
  // tag is the right default here.
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt="Selfie at attendance event"
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}
