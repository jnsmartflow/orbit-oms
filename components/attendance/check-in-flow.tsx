"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CameraView, type LocationInfo, type LocationStatus } from "./camera-view";
import { ConfirmView } from "./confirm-view";
import { SuccessView } from "./success-view";
import { haversineDistance } from "@/lib/attendance/geofence";
import { format24To12 } from "@/lib/attendance/format";

interface GeofenceConfig {
  lat: number;
  lng: number;
  radiusMeters: number;
}

interface PhotoConfig {
  maxWidth: number;
  quality: number;
}

interface CheckInFlowProps {
  userName: string;
  userRole: string;
  geofence: GeofenceConfig;
  photo: PhotoConfig;
  workEndTime: string;
}

type FlowStep =
  | { kind: "camera" }
  | { kind: "confirm"; photoBlob: Blob; photoDataUrl: string; capturedAtISO: string }
  | { kind: "submitting"; photoBlob: Blob; photoDataUrl: string; capturedAtISO: string }
  | {
      kind: "error";
      photoBlob: Blob;
      photoDataUrl: string;
      capturedAtISO: string;
      message: string;
    }
  | { kind: "success"; capturedAtISO: string };

export function CheckInFlow({
  userName,
  userRole,
  geofence,
  photo,
  workEndTime,
}: CheckInFlowProps) {
  const router = useRouter();
  const { update } = useSession();

  const [step, setStep] = useState<FlowStep>({ kind: "camera" });
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("requesting");
  const [locationDistanceMeters, setLocationDistanceMeters] = useState<number | null>(null);

  // GPS request — runs in parallel with camera, fires once on mount.
  // Camera doesn't block on this; the location pill updates as it resolves.
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocation(null);
      setLocationStatus("unavailable");
      return;
    }
    if (!window.isSecureContext) {
      setLocation(null);
      setLocationStatus("unavailable");
      return;
    }

    setLocationStatus("requesting");
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const loc: LocationInfo = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyMeters: Math.round(pos.coords.accuracy),
        };
        setLocation(loc);
        const distance = haversineDistance(
          loc.lat,
          loc.lng,
          geofence.lat,
          geofence.lng,
        );
        setLocationDistanceMeters(Math.round(distance));
        setLocationStatus(distance <= geofence.radiusMeters ? "verified" : "outside");
      },
      () => {
        if (cancelled) return;
        setLocation(null);
        setLocationStatus("unavailable");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
    return () => {
      cancelled = true;
    };
  }, [geofence.lat, geofence.lng, geofence.radiusMeters]);

  function handleCapture(blob: Blob, dataUrl: string) {
    setStep({
      kind: "confirm",
      photoBlob: blob,
      photoDataUrl: dataUrl,
      capturedAtISO: new Date().toISOString(),
    });
  }

  function handleClose() {
    router.push("/attendance");
  }

  function handleRetake() {
    setStep({ kind: "camera" });
  }

  async function handleConfirm() {
    if (step.kind !== "confirm" && step.kind !== "error") return;
    const { photoBlob, photoDataUrl, capturedAtISO } = step;

    setStep({ kind: "submitting", photoBlob, photoDataUrl, capturedAtISO });

    try {
      const form = new FormData();
      form.append("photo", photoBlob, "selfie.jpg");
      if (location) {
        form.append("latitude", location.lat.toString());
        form.append("longitude", location.lng.toString());
        form.append("accuracy", location.accuracyMeters.toString());
      }
      const res = await fetch("/api/attendance/check-in", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        let msg = `Server error (${res.status})`;
        try {
          const data = await res.json();
          if (typeof data?.error === "string") msg = data.error;
        } catch {
          // non-JSON body — keep generic message
        }
        setStep({ kind: "error", photoBlob, photoDataUrl, capturedAtISO, message: msg });
        return;
      }
      // Sequential: refresh JWT before showing success so the redirect's
      // middleware check sees the new lastCheckInDate immediately.
      await update();
      setStep({ kind: "success", capturedAtISO });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Network error. Please check your connection and try again.";
      setStep({ kind: "error", photoBlob, photoDataUrl, capturedAtISO, message: msg });
    }
  }

  function handleSuccessRedirect() {
    router.push("/attendance");
    // Force re-fetch of /attendance server data so it shows State B WORKING
    // even if Next's RSC cache would otherwise serve a stale render.
    router.refresh();
  }

  switch (step.kind) {
    case "camera":
      return (
        <CameraView
          onCapture={handleCapture}
          onClose={handleClose}
          locationStatus={locationStatus}
          locationDistanceMeters={locationDistanceMeters}
          photoMaxWidth={photo.maxWidth}
          photoJpegQuality={photo.quality}
        />
      );
    case "confirm":
    case "submitting":
    case "error":
      return (
        <ConfirmView
          title="Confirm Check-In"
          ctaLabel="Confirm Check-In"
          photoDataUrl={step.photoDataUrl}
          capturedAtISO={step.capturedAtISO}
          locationStatus={locationStatus}
          locationDistanceMeters={locationDistanceMeters}
          userName={userName}
          userRole={userRole}
          submitting={step.kind === "submitting"}
          errorMessage={step.kind === "error" ? step.message : null}
          onConfirm={handleConfirm}
          onRetake={handleRetake}
          onCancel={handleClose}
        />
      );
    case "success":
      return (
        <SuccessView
          headline="You're checked in"
          timestampISO={step.capturedAtISO}
          extraInfo={`Shift ends ${format24To12(workEndTime)}`}
          onRedirect={handleSuccessRedirect}
        />
      );
  }
}
