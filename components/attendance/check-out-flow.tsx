"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { CameraView, type LocationInfo, type LocationStatus } from "./camera-view";
import { ConfirmView } from "./confirm-view";
import { DaySummaryView, type DaySummaryOtOutcome } from "./day-summary-view";
import { haversineDistance } from "@/lib/attendance/geofence";
import {
  format24To12,
  formatIstClock,
  istMinutesSinceMidnight,
  parseTimeToMin,
} from "@/lib/attendance/format";
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
  otTriggerTime: string;
  otPromptEnabled: boolean;
  today: string;
}

type OtApprovalStatus = DaySummaryOtOutcome["status"];

interface CheckOutSuccessPayload {
  totalMinutesWorked: number;
  overtimeMinutes: number;
  status: string;
  firstCheckInISO: string;
  lastCheckOutISO: string;
  weekSummaries: DaySummary[];
  otOutcome: DaySummaryOtOutcome;
}

type FlowStep =
  | { kind: "camera" }
  | { kind: "confirm"; photoBlob: Blob; photoDataUrl: string; capturedAtISO: string }
  | {
      kind: "ot-prompt-choice";
      photoBlob: Blob;
      photoDataUrl: string;
      capturedAtISO: string;
    }
  | {
      kind: "ot-prompt-reason";
      photoBlob: Blob;
      photoDataUrl: string;
      capturedAtISO: string;
      reason: string;
    }
  | { kind: "submitting"; photoBlob: Blob; photoDataUrl: string; capturedAtISO: string }
  | {
      kind: "error";
      photoBlob: Blob;
      photoDataUrl: string;
      capturedAtISO: string;
      message: string;
      // OT answers preserved across error so retry replays the same submit
      // without re-prompting the user.
      otClaimed: "yes" | "no";
      otClaimReason: string | null;
    }
  | { kind: "success"; result: CheckOutSuccessPayload };

const REASON_MIN_LEN = 1;
const REASON_MAX_LEN = 200;

export function CheckOutFlow({
  userName,
  userRole,
  geofence,
  photo,
  workStartTime,
  workEndTime,
  otTriggerTime,
  otPromptEnabled,
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

  // Single submit pathway. Called from four places: silent-no (gate
  // skipped), explicit-no, yes-with-reason, and error retry. Centralised
  // so the FormData shape and the success/error transitions stay in one
  // spot.
  async function submit(
    photoBlob: Blob,
    photoDataUrl: string,
    capturedAtISO: string,
    otClaimed: "yes" | "no",
    otClaimReason: string | null,
  ) {
    setStep({ kind: "submitting", photoBlob, photoDataUrl, capturedAtISO });

    try {
      const form = new FormData();
      form.append("photo", photoBlob, "selfie.jpg");
      if (location) {
        form.append("latitude", location.lat.toString());
        form.append("longitude", location.lng.toString());
        form.append("accuracy", location.accuracyMeters.toString());
      }
      form.append("otClaimed", otClaimed);
      if (otClaimed === "yes" && otClaimReason) {
        form.append("otClaimReason", otClaimReason);
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
        setStep({
          kind: "error",
          photoBlob,
          photoDataUrl,
          capturedAtISO,
          message: msg,
          otClaimed,
          otClaimReason,
        });
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
        otOutcome: {
          claimed: boolean;
          status: OtApprovalStatus;
          minutesCredited: number;
          totalLessThan95: boolean;
          graceUsedThisMonth: number;
          graceLimit: number;
        };
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
          otOutcome: {
            status: data.otOutcome.status,
            minutesCredited: data.otOutcome.minutesCredited,
            graceUsedThisMonth: data.otOutcome.graceUsedThisMonth,
            graceLimit: data.otOutcome.graceLimit,
          },
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Network error. Please check your connection and try again.";
      setStep({
        kind: "error",
        photoBlob,
        photoDataUrl,
        capturedAtISO,
        message: msg,
        otClaimed,
        otClaimReason,
      });
    }
  }

  // Gate entry point. From the confirm screen: decide whether to show
  // the OT prompt or submit straight through with otClaimed="no". From
  // the error screen: replay the originally-decided answers.
  async function handleConfirm() {
    if (step.kind === "confirm") {
      const { photoBlob, photoDataUrl, capturedAtISO } = step;
      const triggerMin = parseTimeToMin(otTriggerTime);
      const nowMin = istMinutesSinceMidnight(new Date());
      if (!otPromptEnabled || nowMin <= triggerMin) {
        await submit(photoBlob, photoDataUrl, capturedAtISO, "no", null);
        return;
      }
      setStep({
        kind: "ot-prompt-choice",
        photoBlob,
        photoDataUrl,
        capturedAtISO,
      });
      return;
    }
    if (step.kind === "error") {
      await submit(
        step.photoBlob,
        step.photoDataUrl,
        step.capturedAtISO,
        step.otClaimed,
        step.otClaimReason,
      );
    }
  }

  function handleOtChoiceYes() {
    if (step.kind !== "ot-prompt-choice") return;
    setStep({
      kind: "ot-prompt-reason",
      photoBlob: step.photoBlob,
      photoDataUrl: step.photoDataUrl,
      capturedAtISO: step.capturedAtISO,
      reason: "",
    });
  }

  async function handleOtChoiceNo() {
    if (step.kind !== "ot-prompt-choice") return;
    await submit(
      step.photoBlob,
      step.photoDataUrl,
      step.capturedAtISO,
      "no",
      null,
    );
  }

  function handleOtReasonChange(text: string) {
    if (step.kind !== "ot-prompt-reason") return;
    setStep({ ...step, reason: text });
  }

  async function handleOtReasonSubmit() {
    if (step.kind !== "ot-prompt-reason") return;
    const reasonTrimmed = step.reason.trim();
    if (reasonTrimmed.length < REASON_MIN_LEN) return;
    await submit(
      step.photoBlob,
      step.photoDataUrl,
      step.capturedAtISO,
      "yes",
      reasonTrimmed,
    );
  }

  function handleOtBack() {
    if (step.kind !== "ot-prompt-reason") return;
    setStep({
      kind: "ot-prompt-choice",
      photoBlob: step.photoBlob,
      photoDataUrl: step.photoDataUrl,
      capturedAtISO: step.capturedAtISO,
    });
  }

  function handleOtCancel() {
    // From the choice screen: discard the captured photo and return to
    // camera. Hardware/browser back is left to default behaviour (will
    // navigate away from /attendance/check-out entirely) — the on-screen
    // back arrow is the supported in-flow control.
    setStep({ kind: "camera" });
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
    case "ot-prompt-choice":
      return (
        <OtPromptChoice
          otTriggerTime={otTriggerTime}
          onYes={handleOtChoiceYes}
          onNo={handleOtChoiceNo}
          onCancel={handleOtCancel}
        />
      );
    case "ot-prompt-reason":
      return (
        <OtPromptReason
          otTriggerTime={otTriggerTime}
          reason={step.reason}
          onReasonChange={handleOtReasonChange}
          onSubmit={handleOtReasonSubmit}
          onBack={handleOtBack}
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
          otOutcome={step.result.otOutcome}
          onDone={handleDone}
        />
      );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// OT prompt screens
// ──────────────────────────────────────────────────────────────────────────

function OtPromptChoice({
  otTriggerTime,
  onYes,
  onNo,
  onCancel,
}: {
  otTriggerTime: string;
  onYes(): void;
  onNo(): void;
  onCancel(): void;
}) {
  // Computed at render time. Won't tick on its own — the user is on the
  // screen for a few seconds at most before tapping a choice.
  const nowClock = formatIstClock(new Date());
  const triggerClock = format24To12(otTriggerTime);

  return (
    <div>
      <header className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onCancel}
          className="w-9 h-9 -ml-1 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-600"
          aria-label="Back to camera"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-semibold text-gray-900">Overtime?</h1>
        <span className="w-9" aria-hidden />
      </header>

      <OtCallout
        primary={`It's ${nowClock}`}
        secondary={`Past depot hours (${triggerClock})`}
      />

      <h2 className="text-[18px] font-semibold text-gray-900 mb-1">
        Were you doing overtime work?
      </h2>
      <p className="text-[14px] text-gray-500 mb-5">
        Tell us so your hours get counted correctly.
      </p>

      <div className="flex flex-col gap-3 mb-4">
        <button
          type="button"
          onClick={onYes}
          className="w-full h-14 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[16px] font-semibold transition-colors"
        >
          Yes, claim OT
        </button>
        <button
          type="button"
          onClick={onNo}
          className="w-full h-14 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-900 text-[16px] font-semibold transition-colors"
        >
          No, just clocking out
        </button>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={onCancel}
          className="text-[14px] text-gray-500 hover:text-gray-700"
        >
          Cancel and go back
        </button>
      </div>
    </div>
  );
}

function OtPromptReason({
  otTriggerTime,
  reason,
  onReasonChange,
  onSubmit,
  onBack,
}: {
  otTriggerTime: string;
  reason: string;
  onReasonChange(text: string): void;
  onSubmit(): void;
  onBack(): void;
}) {
  const nowClock = formatIstClock(new Date());
  const triggerMin = parseTimeToMin(otTriggerTime);
  const nowMin = istMinutesSinceMidnight(new Date());
  const otMinSoFar = Math.max(0, nowMin - triggerMin);

  const charCount = reason.length;
  const trimmedLen = reason.trim().length;
  const canSubmit = trimmedLen >= REASON_MIN_LEN;
  const counterClass = charCount > 180 ? "text-amber-600" : "text-gray-400";

  return (
    <div>
      <header className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="w-9 h-9 -ml-1 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-600"
          aria-label="Back to OT choice"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-semibold text-gray-900">OT Reason</h1>
        <span className="w-9" aria-hidden />
      </header>

      <OtCallout
        primary={`It's ${nowClock}`}
        secondary={`${otMinSoFar} min overtime so far`}
      />

      <h2 className="text-[18px] font-semibold text-gray-900 mb-3">
        Why were you working late?
      </h2>

      <textarea
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        maxLength={REASON_MAX_LEN}
        rows={4}
        placeholder="Brief reason"
        className="w-full border border-gray-300 rounded-lg p-3 text-[16px] text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 focus:outline-none resize-none mb-1"
      />

      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-[12px] text-gray-500 flex-1 leading-snug">
          Examples: Late dealer delivery, inventory count, urgent dispatch
        </p>
        <span className={`text-[12px] tabular-nums shrink-0 ${counterClass}`}>
          {charCount}/{REASON_MAX_LEN}
        </span>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="w-full h-14 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[16px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-teal-600 mb-3"
      >
        Submit OT claim
      </button>

      <div className="text-center">
        <button
          type="button"
          onClick={onBack}
          className="text-[14px] text-gray-500 hover:text-gray-700"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function OtCallout({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-5 flex items-center gap-2">
      <Clock className="w-[18px] h-[18px] text-amber-600 shrink-0" />
      <div className="flex flex-col">
        <span className="text-[14px] font-medium text-amber-900 tabular-nums">
          {primary}
        </span>
        <span className="text-[12px] text-amber-700 tabular-nums">{secondary}</span>
      </div>
    </div>
  );
}
