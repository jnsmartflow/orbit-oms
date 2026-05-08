"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, MapPinOff, X } from "lucide-react";
import { captureFromVideo } from "@/lib/attendance/photo";

// Location flow status — owned here, imported by confirm-view + the flow
// shell. Lives in camera-view because that's where it's first observed.
export type LocationStatus = "requesting" | "verified" | "outside" | "unavailable";

export interface LocationInfo {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

interface CameraViewProps {
  onCapture(blob: Blob, dataUrl: string): void;
  onClose(): void;
  locationStatus: LocationStatus;
  locationDistanceMeters: number | null;
  photoMaxWidth: number;
  photoJpegQuality: number;
}

export function CameraView({
  onCapture,
  onClose,
  locationStatus,
  locationDistanceMeters,
  photoMaxWidth,
  photoJpegQuality,
}: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setError("Camera requires HTTPS. Open via https:// or localhost.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (cancelled) return;
            videoRef.current
              ?.play()
              .then(() => {
                if (!cancelled) setStreamReady(true);
              })
              .catch(() => {
                /* play() rejection is harmless on retry */
              });
          };
        }
      } catch {
        if (!cancelled) {
          setError(
            "Camera access required. Please enable camera in your browser settings and reload.",
          );
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  async function handleCapture() {
    if (!videoRef.current || !streamReady || capturing) return;
    setCapturing(true);
    try {
      const result = await captureFromVideo(
        videoRef.current,
        photoMaxWidth,
        photoJpegQuality,
      );
      onCapture(result.blob, result.dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture photo");
      setCapturing(false);
    }
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center px-6 text-white">
        <p className="text-[16px] text-center text-white/90 mb-4 max-w-[320px] leading-relaxed">
          {error}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="h-12 px-5 rounded-lg bg-white/10 hover:bg-white/20 text-[14px] font-medium"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black overflow-hidden">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 left-4 z-10 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white flex items-center justify-center"
        aria-label="Close camera"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Mirrored selfie preview — captured photo is unmirrored (photo.ts) */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: "scaleX(-1)" }}
        playsInline
        muted
        autoPlay
      />

      {/* Face oval guide overlay */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <ellipse
          cx="50"
          cy="42"
          rx="30"
          ry="38"
          fill="none"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="0.4"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div
        className="absolute bottom-0 inset-x-0 pb-8 px-6 flex flex-col items-center gap-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
      >
        <LocationPill status={locationStatus} distanceMeters={locationDistanceMeters} />
        <button
          type="button"
          onClick={handleCapture}
          disabled={!streamReady || capturing}
          className="w-[88px] h-[88px] rounded-full bg-white border-[6px] border-white/30 disabled:opacity-50 active:scale-95 transition-transform"
          aria-label="Capture photo"
        />
      </div>
    </div>
  );
}

function LocationPill({
  status,
  distanceMeters,
}: {
  status: LocationStatus;
  distanceMeters: number | null;
}) {
  let label: string;
  let bgClass: string;
  let Icon = MapPin;
  switch (status) {
    case "verified":
      label = "At depot";
      bgClass = "bg-emerald-500/90";
      break;
    case "outside":
      label = distanceMeters ? `${distanceMeters}m from depot` : "Outside geofence";
      bgClass = "bg-amber-500/90";
      break;
    case "unavailable":
      label = "Location unavailable";
      bgClass = "bg-gray-500/85";
      Icon = MapPinOff;
      break;
    case "requesting":
    default:
      label = "Locating…";
      bgClass = "bg-gray-700/85";
  }
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${bgClass} text-white text-[12px] font-medium tabular-nums`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </div>
  );
}
