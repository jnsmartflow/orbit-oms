"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CameraView, type LocationInfo, type LocationStatus } from "./camera-view";
import { ConfirmView } from "./confirm-view";
import { DaySummaryView } from "./day-summary-view";
import { haversineDistance } from "@/lib/attendance/geofence";
import type { DaySummary } from "./attendance-home";

interface GeofenceConfig {
  lat: number;
  lng: number;
  radiusMeters: number;
}

interface PhotoConfig {
  maxWidth: number;
  quality: number;
}

interface CheckOutFlowProps {
  userName: string;
  userRole: string;
  geofence: GeofenceConfig;
  photo: PhotoConfig;
  workStartTime: string;
  workEndTime: string;
  today: string;
}

interface CheckOutSuccessPayload {
  totalMinutesWorked: number;
  overtimeMinutes: number;
  status: string;
  firstCheckInISO: string;
  lastCheckOutISO: string;
  weekSummaries: DaySummary[];
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
  | { kind: "success"; result: CheckOutSuccessPayload };

export function CheckOutFlow({
  userName,
  userRole,
  geofence,
  photo,
  workStartTime,
  workEndTime,
  today,
}: CheckOutFlowProps) {
  const router = useRouter();
  // No useSession() here — check-out doesn't refresh JWT (gate state
  // unchanged: today's CHECK_IN row still anchors lastCheckInDate per
  // §5 of the diagnosis).

  const [step, setStep] = useState<FlowStep>({ kind: "camera" });
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("requesting");
  const [locationDistanceMeters, setLocationDistanceMeters] = useState<number | null>(null);

  // GPS request — identical to check-in flow, runs once on mount.
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
      const res = await fetch("/api/attendance/check-out", {
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
        // 409 "Not checked in" is unrecoverable — push back to home.
        if (res.status === 409) {
          router.push("/attendance");
          router.refresh();
          return;
        }
        setStep({ kind: "error", photoBlob, photoDataUrl, capturedAtISO, message: msg });
        return;
      }
      const data = (await res.json()) as {
        ok: true;
        totalMinutesWorked: number;
        overtimeMinutes: number;
        status: string;
        firstCheckInISO: string;
        lastCheckOutISO: string;
        weekSummaries: DaySummary[];
      };
      setStep({
        kind: "success",
        result: {
          totalMinutesWorked: data.totalMinutesWorked,
          overtimeMinutes: data.overtimeMinutes,
          status: data.status,
          firstCheckInISO: data.firstCheckInISO,
          lastCheckOutISO: data.lastCheckOutISO,
          weekSummaries: data.weekSummaries,
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Network error. Please check your connection and try again.";
      setStep({ kind: "error", photoBlob, photoDataUrl, capturedAtISO, message: msg });
    }
  }

  function handleDone() {
    router.push("/attendance");
    // Force re-fetch so home shows the just-completed session in State A
    // with the "Last checked out X · Y today" subline.
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
          title="Confirm Check-Out"
          ctaLabel="Confirm Check-Out"
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
        <DaySummaryView
          userName={userName}
          today={today}
          totalMinutesWorked={step.result.totalMinutesWorked}
          overtimeMinutes={step.result.overtimeMinutes}
          firstCheckInISO={step.result.firstCheckInISO}
          lastCheckOutISO={step.result.lastCheckOutISO}
          status={step.result.status}
          workStartTime={workStartTime}
          workEndTime={workEndTime}
          weekSummaries={step.result.weekSummaries}
          onDone={handleDone}
        />
      );
  }
}
