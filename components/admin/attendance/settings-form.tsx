"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { AttendancePageHeader } from "./attendance-page-header";
import { SettingsSection } from "./settings-section";
import {
  SettingsConfirmModal,
  type SettingsConfirmKind,
} from "./settings-confirm-modal";
import { SettingsToast, type SettingsToastKind } from "./settings-toast";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

// Mirrors buildSettingsResponse() in the API route (lines ~519-547).
export interface SettingsResponse {
  scope: string;
  roleSlug: string | null;
  rolloutStage: string;
  workStartTime: string;
  workEndTime: string;
  lateGraceMinutes: number;
  halfDayThresholdMinutes: number;
  checkInWindowStart: string;
  checkInWindowEnd: string;
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadiusMeters: number;
  requirePhoto: boolean;
  requireLocation: boolean;
  photoRetentionDays: number;
  photoMaxWidthPx: number;
  photoJpegQuality: number;
  dpdpConsentVersion: string;
  depotWorkingMinutes: number;
  otTriggerTime: string;
  otMonthlyGraceLimit: number;
  otPromptEnabled: boolean;
  updatedAt: string;
  updatedById: number | null;
  updatedByName: string | null;
}

// Editable column union — must stay in sync with EDITABLE_KEYS in the API
// route (lines ~38-59). The PATCH handler silently drops unknown keys, so
// extra additions here would be no-ops, but missing ones would block edits.
const EDITABLE_KEYS = [
  "rolloutStage",
  "workStartTime",
  "workEndTime",
  "checkInWindowStart",
  "checkInWindowEnd",
  "otTriggerTime",
  "lateGraceMinutes",
  "halfDayThresholdMinutes",
  "geofenceRadiusMeters",
  "photoRetentionDays",
  "photoMaxWidthPx",
  "photoJpegQuality",
  "depotWorkingMinutes",
  "otMonthlyGraceLimit",
  "geofenceLat",
  "geofenceLng",
  "requirePhoto",
  "requireLocation",
  "otPromptEnabled",
  "dpdpConsentVersion",
] as const;

type EditableKey = (typeof EDITABLE_KEYS)[number];

const ROLLOUT_STAGES = ["OFF", "TEST_USERS_ONLY", "ALL_USERS"] as const;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DPDP_VERSION_REGEX = /^v\d+\.\d+$/;

interface SettingsFormProps {
  initial: SettingsResponse;
  otPendingCount: number;
}

// Sections that own cross-field invariants. Keys map to error slot IDs
// passed to SettingsSection's `sectionError`.
type SectionId = "hours" | "ot";

interface SaveResponse {
  ok: true;
  settings: SettingsResponse;
  willForceReconsent?: true;
  rolloutActivated?: true;
}

interface ErrorResponse {
  errors?: Array<{ field: string; message: string }>;
  error?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export function SettingsForm({ initial, otPendingCount }: SettingsFormProps) {
  const [formValues, setFormValues] = useState<SettingsResponse>(initial);
  const [originalValues, setOriginalValues] = useState<SettingsResponse>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sectionErrors, setSectionErrors] = useState<Record<SectionId, string>>(
    { hours: "", ot: "" },
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<SettingsConfirmKind | null>(
    null,
  );
  const [toast, setToast] = useState<
    null | { kind: SettingsToastKind; message: string }
  >(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Refs for scroll-to-first-error on submit failure.
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  const changedKeys = useMemo<EditableKey[]>(() => {
    const out: EditableKey[] = [];
    for (const k of EDITABLE_KEYS) {
      if (!isEqual(formValues[k], originalValues[k])) out.push(k);
    }
    return out;
  }, [formValues, originalValues]);

  const isDirty = changedKeys.length > 0;

  // Cross-field validation runs on any time-field change. Section errors
  // are independent of per-field errors so a valid HH:MM format can still
  // trigger a section banner (e.g. end before start, both well-formed).
  useEffect(() => {
    const errs: Record<SectionId, string> = { hours: "", ot: "" };
    if (
      TIME_REGEX.test(formValues.workStartTime) &&
      TIME_REGEX.test(formValues.workEndTime) &&
      parseTimeToMin(formValues.workEndTime) <=
        parseTimeToMin(formValues.workStartTime)
    ) {
      errs.hours = "Work end time must be after work start time.";
    } else if (
      TIME_REGEX.test(formValues.checkInWindowStart) &&
      TIME_REGEX.test(formValues.checkInWindowEnd) &&
      parseTimeToMin(formValues.checkInWindowEnd) <=
        parseTimeToMin(formValues.checkInWindowStart)
    ) {
      errs.hours = "Check-in window end must be after window start.";
    }
    if (
      TIME_REGEX.test(formValues.otTriggerTime) &&
      TIME_REGEX.test(formValues.workStartTime) &&
      parseTimeToMin(formValues.otTriggerTime) <
        parseTimeToMin(formValues.workStartTime)
    ) {
      errs.ot = "OT trigger time must not precede work start time.";
    }
    setSectionErrors(errs);
  }, [
    formValues.workStartTime,
    formValues.workEndTime,
    formValues.checkInWindowStart,
    formValues.checkInWindowEnd,
    formValues.otTriggerTime,
  ]);

  const setValue = useCallback(
    function setValue<K extends EditableKey>(
      key: K,
      value: SettingsResponse[K],
    ) {
      setFormValues((prev) => ({ ...prev, [key]: value }));
      // Clear stale field error on edit; will re-validate on blur.
      setFieldErrors((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [],
  );

  function handleBlur(key: EditableKey) {
    const err = validateField(key, formValues[key]);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[key] = err;
      else delete next[key];
      return next;
    });
  }

  function handleDiscard() {
    setFormValues(originalValues);
    setFieldErrors({});
    setSectionErrors({ hours: "", ot: "" });
    setGeoError(null);
  }

  // ── OT kill switch toggle interception ───────────────────────────────────
  // Going OFF requires confirmation. Going ON is unguarded — re-enabling
  // the prompt is recoverable, disabling it isn't (until next save).
  function handleOtPromptToggle() {
    if (formValues.otPromptEnabled) {
      setPendingConfirm("killswitch");
    } else {
      setValue("otPromptEnabled", true);
    }
  }

  function handleForceReconsent() {
    setPendingConfirm("reconsent");
  }

  function handleConfirm() {
    if (pendingConfirm === "killswitch") {
      setValue("otPromptEnabled", false);
    } else if (pendingConfirm === "reconsent") {
      setValue(
        "dpdpConsentVersion",
        bumpDpdpVersion(formValues.dpdpConsentVersion),
      );
    }
    setPendingConfirm(null);
  }

  // ── Geolocation ──────────────────────────────────────────────────────────
  function handleUseCurrentLocation() {
    setGeoError(null);
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGeoError("Geolocation not available in this browser.");
      return;
    }
    if (!window.isSecureContext) {
      setGeoError("Geolocation requires HTTPS or localhost.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValue("geofenceLat", round7(pos.coords.latitude));
        setValue("geofenceLng", round7(pos.coords.longitude));
      },
      () => {
        setGeoError("Location permission denied.");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (isSubmitting || !isDirty) return;

    // Final per-field validation pass — replaces any stale fieldErrors
    // and ensures we don't ship invalid values past blur-only checks.
    const finalFieldErrors: Record<string, string> = {};
    for (const k of EDITABLE_KEYS) {
      const err = validateField(k, formValues[k]);
      if (err) finalFieldErrors[k] = err;
    }
    setFieldErrors(finalFieldErrors);
    const hasFieldErrors = Object.keys(finalFieldErrors).length > 0;
    const hasSectionErrors = Boolean(sectionErrors.hours || sectionErrors.ot);
    if (hasFieldErrors || hasSectionErrors) {
      // Scroll to first errored field.
      const firstKey = EDITABLE_KEYS.find((k) => k in finalFieldErrors);
      if (firstKey) {
        fieldRefs.current[firstKey]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      setToast({
        kind: "error",
        message: "Couldn't save — check fields highlighted in red.",
      });
      return;
    }

    setIsSubmitting(true);
    setToast(null);

    const body: Partial<Record<EditableKey, SettingsResponse[EditableKey]>> = {};
    for (const k of changedKeys) {
      body[k] = formValues[k];
    }

    try {
      const res = await fetch("/api/admin/attendance/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = (await res.json()) as SaveResponse;
        setOriginalValues(data.settings);
        setFormValues(data.settings);
        setFieldErrors({});
        if (data.willForceReconsent) {
          setToast({
            kind: "reconsent",
            message:
              "Re-consent triggered — all users will be signed out on next login.",
          });
        } else if (data.rolloutActivated) {
          setToast({
            kind: "rollout",
            message: "Rollout activated — attendance is now visible to test users.",
          });
        } else {
          setToast({ kind: "success", message: "Settings saved." });
        }
        return;
      }

      // Non-OK responses
      let errBody: ErrorResponse = {};
      try {
        errBody = (await res.json()) as ErrorResponse;
      } catch {
        // Ignore parse failures — generic message below.
      }

      if (res.status === 400 && errBody.errors && errBody.errors.length > 0) {
        const next: Record<string, string> = {};
        for (const e of errBody.errors) {
          if (e.field === "_") continue; // surfaced via toast
          next[e.field] = e.message;
        }
        setFieldErrors(next);
        const firstKey = EDITABLE_KEYS.find((k) => k in next);
        if (firstKey) {
          fieldRefs.current[firstKey]?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
        setToast({
          kind: "error",
          message: "Couldn't save — check fields highlighted in red.",
        });
        return;
      }

      if (res.status === 401 || res.status === 403) {
        setToast({
          kind: "error",
          message: "Session expired — refresh and re-login.",
        });
        return;
      }

      setToast({
        kind: "error",
        message: errBody.error ?? "Server error — try again.",
      });
    } catch {
      setToast({
        kind: "error",
        message: "Network error — please check your connection.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function registerRef(key: EditableKey) {
    return (el: HTMLElement | null) => {
      fieldRefs.current[key] = el;
    };
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-w-[1100px]">
      <AttendancePageHeader
        activeTab={null}
        otPendingCount={otPendingCount}
        showWorkflowSwitcher={false}
        titleOverride="Attendance · Settings"
      >
        {/* Strip 2 left — dirty count (or empty when clean) */}
        {isDirty ? (
          <span className="text-xs text-amber-700 tabular-nums">
            {changedKeys.length} field{changedKeys.length === 1 ? "" : "s"} changed
          </span>
        ) : (
          <span className="text-xs text-gray-400">No changes</span>
        )}
        {/* Strip 2 right — Discard + Save */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={!isDirty || isSubmitting}
            className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isDirty || isSubmitting}
            className={
              isDirty
                ? "bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
                : "bg-gray-200 text-gray-400 text-xs font-medium px-3 py-1.5 rounded-md cursor-not-allowed"
            }
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </AttendancePageHeader>

      <div className="max-w-3xl mx-auto p-6 pb-24">
      {/* SECTION 1 — Rollout */}
      <SettingsSection
        title="Rollout"
        helper="Controls who sees attendance"
      >
        <div className="mb-5">
          <span className="block text-[12px] font-medium text-gray-700 mb-2">
            Rollout stage
          </span>
          <div className="flex flex-wrap gap-5">
            {(
              [
                { value: "OFF", label: "Off (no one)" },
                { value: "TEST_USERS_ONLY", label: "Test users only" },
                { value: "ALL_USERS", label: "All users" },
              ] as const
            ).map((opt) => {
              const isOn = formValues.rolloutStage === opt.value;
              return (
                <label
                  key={opt.value}
                  className="inline-flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="rolloutStage"
                    value={opt.value}
                    checked={isOn}
                    onChange={() => setValue("rolloutStage", opt.value)}
                    className="sr-only"
                  />
                  <span
                    className={`w-4 h-4 rounded-full border-2 inline-flex items-center justify-center ${
                      isOn ? "border-gray-900" : "border-gray-300"
                    }`}
                  >
                    {isOn && (
                      <span className="w-2 h-2 rounded-full bg-gray-900" />
                    )}
                  </span>
                  <span
                    className={`text-[13px] ${
                      isOn ? "text-gray-900 font-medium" : "text-gray-700"
                    }`}
                  >
                    {opt.label}
                  </span>
                </label>
              );
            })}
          </div>
          {fieldErrors.rolloutStage && (
            <p className="text-[11px] text-red-600 mt-1.5">
              {fieldErrors.rolloutStage}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="dpdpConsentVersion"
            className="block text-[12px] font-medium text-gray-700 mb-1"
          >
            DPDP consent version
          </label>
          <div className="flex gap-2 items-start">
            <input
              id="dpdpConsentVersion"
              ref={registerRef("dpdpConsentVersion")}
              type="text"
              value={formValues.dpdpConsentVersion}
              onChange={(e) => setValue("dpdpConsentVersion", e.target.value)}
              onBlur={() => handleBlur("dpdpConsentVersion")}
              placeholder="vN.N"
              aria-invalid={Boolean(fieldErrors.dpdpConsentVersion)}
              className={inputClass(
                "w-32 font-mono",
                Boolean(fieldErrors.dpdpConsentVersion),
              )}
            />
            <button
              type="button"
              onClick={handleForceReconsent}
              className="h-9 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[12px] font-medium rounded-md"
            >
              Force re-consent
            </button>
          </div>
          {fieldErrors.dpdpConsentVersion && (
            <p className="text-[11px] text-red-600 mt-1">
              {fieldErrors.dpdpConsentVersion}
            </p>
          )}
          <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
            Bumping this version forces every user to re-consent on next login.
          </p>
        </div>
      </SettingsSection>

      {/* SECTION 2 — Work hours */}
      <SettingsSection title="Work hours" sectionError={sectionErrors.hours || null}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TimeFieldEl
            id="workStartTime"
            label="Work start time"
            value={formValues.workStartTime}
            onChange={(v) => setValue("workStartTime", v)}
            onBlur={() => handleBlur("workStartTime")}
            error={fieldErrors.workStartTime}
            registerRef={registerRef("workStartTime")}
          />
          <TimeFieldEl
            id="workEndTime"
            label="Work end time"
            value={formValues.workEndTime}
            onChange={(v) => setValue("workEndTime", v)}
            onBlur={() => handleBlur("workEndTime")}
            error={fieldErrors.workEndTime}
            registerRef={registerRef("workEndTime")}
          />
          <TimeFieldEl
            id="checkInWindowStart"
            label="Check-in window start"
            value={formValues.checkInWindowStart}
            onChange={(v) => setValue("checkInWindowStart", v)}
            onBlur={() => handleBlur("checkInWindowStart")}
            error={fieldErrors.checkInWindowStart}
            registerRef={registerRef("checkInWindowStart")}
          />
          <TimeFieldEl
            id="checkInWindowEnd"
            label="Check-in window end"
            value={formValues.checkInWindowEnd}
            onChange={(v) => setValue("checkInWindowEnd", v)}
            onBlur={() => handleBlur("checkInWindowEnd")}
            error={fieldErrors.checkInWindowEnd}
            registerRef={registerRef("checkInWindowEnd")}
          />
          <NumberFieldEl
            id="lateGraceMinutes"
            label="Late grace minutes"
            suffix="min"
            value={formValues.lateGraceMinutes}
            onChange={(v) => setValue("lateGraceMinutes", v)}
            onBlur={() => handleBlur("lateGraceMinutes")}
            error={fieldErrors.lateGraceMinutes}
            registerRef={registerRef("lateGraceMinutes")}
          />
        </div>
      </SettingsSection>

      {/* SECTION 3 — Geofence */}
      <SettingsSection title="Geofence">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
          <NumberFieldEl
            id="geofenceLat"
            label="Latitude"
            value={formValues.geofenceLat}
            step={0.0000001}
            mono
            onChange={(v) => setValue("geofenceLat", v)}
            onBlur={() => handleBlur("geofenceLat")}
            error={fieldErrors.geofenceLat}
            registerRef={registerRef("geofenceLat")}
          />
          <NumberFieldEl
            id="geofenceLng"
            label="Longitude"
            value={formValues.geofenceLng}
            step={0.0000001}
            mono
            onChange={(v) => setValue("geofenceLng", v)}
            onBlur={() => handleBlur("geofenceLng")}
            error={fieldErrors.geofenceLng}
            registerRef={registerRef("geofenceLng")}
          />
          <NumberFieldEl
            id="geofenceRadiusMeters"
            label="Radius (m)"
            suffix="m"
            value={formValues.geofenceRadiusMeters}
            onChange={(v) => setValue("geofenceRadiusMeters", v)}
            onBlur={() => handleBlur("geofenceRadiusMeters")}
            error={fieldErrors.geofenceRadiusMeters}
            registerRef={registerRef("geofenceRadiusMeters")}
          />
        </div>
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          className="h-8 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5"
        >
          <MapPin className="w-3 h-3" />
          Use my current location
        </button>
        {geoError && (
          <p className="text-[11px] text-red-600 mt-2">
            {geoError} <span className="text-gray-500">Enable in browser settings.</span>
          </p>
        )}
        <p className="text-[11px] text-gray-500 mt-2 leading-snug">
          Current value ≈ Surat city centre. Update with actual depot coords.
        </p>
      </SettingsSection>

      {/* SECTION 4 — Photo policy */}
      <SettingsSection title="Photo policy">
        <ToggleRow
          label="Require photo on check-in/out"
          value={formValues.requirePhoto}
          onChange={(v) => setValue("requirePhoto", v)}
        />
        <ToggleRow
          label="Require GPS location"
          value={formValues.requireLocation}
          onChange={(v) => setValue("requireLocation", v)}
          isLast
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumberFieldEl
            id="photoMaxWidthPx"
            label="Max photo width (px)"
            value={formValues.photoMaxWidthPx}
            onChange={(v) => setValue("photoMaxWidthPx", v)}
            onBlur={() => handleBlur("photoMaxWidthPx")}
            error={fieldErrors.photoMaxWidthPx}
            registerRef={registerRef("photoMaxWidthPx")}
          />
          <NumberFieldEl
            id="photoJpegQuality"
            label="JPEG quality (30-95)"
            value={formValues.photoJpegQuality}
            onChange={(v) => setValue("photoJpegQuality", v)}
            onBlur={() => handleBlur("photoJpegQuality")}
            error={fieldErrors.photoJpegQuality}
            registerRef={registerRef("photoJpegQuality")}
          />
          <NumberFieldEl
            id="photoRetentionDays"
            label="Retention (days)"
            value={formValues.photoRetentionDays}
            onChange={(v) => setValue("photoRetentionDays", v)}
            onBlur={() => handleBlur("photoRetentionDays")}
            error={fieldErrors.photoRetentionDays}
            registerRef={registerRef("photoRetentionDays")}
          />
        </div>
      </SettingsSection>

      {/* SECTION 5 — OT policy */}
      <SettingsSection title="OT policy" sectionError={sectionErrors.ot || null}>
        <div className="flex items-start justify-between gap-4 py-2 mb-4 border-b border-gray-100">
          <div>
            <p className="text-[13px] text-gray-900 font-medium">
              Enable OT claim prompt on check-out
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
              When off, all post-cut-off check-outs auto-credit without
              prompting. Kill switch.
            </p>
          </div>
          <Toggle
            value={formValues.otPromptEnabled}
            onClick={handleOtPromptToggle}
            label="Toggle OT claim prompt"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <TimeFieldEl
            id="otTriggerTime"
            label="OT trigger time"
            value={formValues.otTriggerTime}
            onChange={(v) => setValue("otTriggerTime", v)}
            onBlur={() => handleBlur("otTriggerTime")}
            error={fieldErrors.otTriggerTime}
            registerRef={registerRef("otTriggerTime")}
          />
          <NumberFieldEl
            id="depotWorkingMinutes"
            label="Depot working minutes"
            suffix="min"
            value={formValues.depotWorkingMinutes}
            onChange={(v) => setValue("depotWorkingMinutes", v)}
            onBlur={() => handleBlur("depotWorkingMinutes")}
            error={fieldErrors.depotWorkingMinutes}
            registerRef={registerRef("depotWorkingMinutes")}
          />
          <NumberFieldEl
            id="otMonthlyGraceLimit"
            label="Monthly grace limit"
            suffix="days"
            value={formValues.otMonthlyGraceLimit}
            onChange={(v) => setValue("otMonthlyGraceLimit", v)}
            onBlur={() => handleBlur("otMonthlyGraceLimit")}
            error={fieldErrors.otMonthlyGraceLimit}
            registerRef={registerRef("otMonthlyGraceLimit")}
          />
        </div>
      </SettingsSection>

      {/* SECTION 6 — Thresholds */}
      <SettingsSection title="Thresholds">
        <div className="max-w-[220px]">
          <NumberFieldEl
            id="halfDayThresholdMinutes"
            label="Half-day threshold"
            suffix="min"
            value={formValues.halfDayThresholdMinutes}
            onChange={(v) => setValue("halfDayThresholdMinutes", v)}
            onBlur={() => handleBlur("halfDayThresholdMinutes")}
            error={fieldErrors.halfDayThresholdMinutes}
            registerRef={registerRef("halfDayThresholdMinutes")}
          />
        </div>
      </SettingsSection>

      </div>

      {pendingConfirm && (
        <SettingsConfirmModal
          kind={pendingConfirm}
          onConfirm={handleConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {toast && (
        <SettingsToast
          kind={toast.kind}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Field sub-components
// ────────────────────────────────────────────────────────────────────────

function TimeFieldEl({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  registerRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange(v: string): void;
  onBlur(): void;
  error?: string;
  registerRef(el: HTMLElement | null): void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[12px] font-medium text-gray-700 mb-1"
      >
        {label}
      </label>
      <input
        id={id}
        ref={registerRef}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        className={inputClass("w-full tabular-nums", Boolean(error))}
      />
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function NumberFieldEl({
  id,
  label,
  value,
  onChange,
  onBlur,
  suffix,
  error,
  step,
  mono,
  registerRef,
}: {
  id: string;
  label: string;
  value: number;
  onChange(v: number): void;
  onBlur(): void;
  suffix?: string;
  error?: string;
  step?: number;
  mono?: boolean;
  registerRef(el: HTMLElement | null): void;
}) {
  // Show empty when value is NaN so the user can clear-and-retype without
  // seeing "NaN" in the input. Validation catches the empty/NaN at blur.
  const display = Number.isFinite(value) ? String(value) : "";
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[12px] font-medium text-gray-700 mb-1"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={registerRef}
          type="number"
          step={step}
          value={display}
          onChange={(e) => {
            const raw = e.target.value;
            const n = raw === "" ? Number.NaN : Number(raw);
            onChange(n);
          }}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          className={inputClass(
            `w-full text-right tabular-nums ${suffix ? suffixPadding(suffix) : ""} ${
              mono ? "font-mono" : ""
            }`,
            Boolean(error),
          )}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  isLast,
}: {
  label: string;
  value: boolean;
  onChange(v: boolean): void;
  isLast?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-2 ${
        isLast ? "mb-3" : "border-b border-gray-100"
      }`}
    >
      <span className="text-[13px] text-gray-900 font-medium">{label}</span>
      <Toggle
        value={value}
        onClick={() => onChange(!value)}
        label={`Toggle ${label}`}
      />
    </div>
  );
}

function Toggle({
  value,
  onClick,
  label,
}: {
  value: boolean;
  onClick(): void;
  label: string;
}) {
  // One-teal audit: redesign moves toggle ON colour to gray-900 to match
  // the page's Save-changes button (also gray-900). No teal on this page;
  // the active sub-nav tab is the page's only teal element when present,
  // and Settings hides the sub-nav entirely.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
        value ? "bg-gray-900" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          value ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function inputClass(extra: string, isError: boolean): string {
  const base =
    "border rounded-md px-3 py-2 text-[13px] text-gray-900 focus:ring-2 focus:outline-none";
  const palette = isError
    ? "border-red-500 bg-red-50/40 focus:border-red-500 focus:ring-red-100"
    : "border-gray-300 focus:border-gray-900 focus:ring-gray-100";
  return `${base} ${palette} ${extra}`;
}

function suffixPadding(suffix: string): string {
  // Roughly proportional to suffix length so the value never collides
  // with the right-edge label.
  if (suffix.length <= 1) return "pr-8";
  if (suffix.length <= 3) return "pr-12";
  return "pr-14";
}

function parseTimeToMin(time24: string): number {
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  return h * 60 + m;
}

function bumpDpdpVersion(current: string): string {
  const m = current.match(/^v(\d+)\.(\d+)$/);
  if (!m) return current;
  const major = parseInt(m[1] ?? "0", 10);
  const minor = parseInt(m[2] ?? "0", 10);
  return `v${major}.${minor + 1}`;
}

function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

function isEqual(a: unknown, b: unknown): boolean {
  // Numbers handled separately so NaN === NaN reads as equal here (a NaN
  // input from the user is "no real change" until they fix it).
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return a === b;
  }
  return a === b;
}

function validateField(key: EditableKey, value: unknown): string | null {
  switch (key) {
    case "rolloutStage":
      if (typeof value !== "string") return "Pick a stage";
      if (!ROLLOUT_STAGES.includes(value as (typeof ROLLOUT_STAGES)[number])) {
        return "Pick a stage";
      }
      return null;
    case "workStartTime":
    case "workEndTime":
    case "checkInWindowStart":
    case "checkInWindowEnd":
    case "otTriggerTime":
      if (typeof value !== "string" || !TIME_REGEX.test(value)) {
        return "Use HH:MM 24-hour format";
      }
      return null;
    case "lateGraceMinutes":
      return validateInt(value, 0, 120);
    case "halfDayThresholdMinutes":
      return validateInt(value, 60, 480);
    case "geofenceRadiusMeters":
      return validateInt(value, 10, 5000);
    case "photoRetentionDays":
      return validateInt(value, 7, 730);
    case "photoMaxWidthPx":
      return validateInt(value, 240, 1920);
    case "photoJpegQuality":
      return validateInt(value, 30, 95);
    case "depotWorkingMinutes":
      return validateInt(value, 60, 720);
    case "otMonthlyGraceLimit":
      return validateInt(value, 0, 30);
    case "geofenceLat":
      return validateDecimal(value, -90, 90);
    case "geofenceLng":
      return validateDecimal(value, -180, 180);
    case "requirePhoto":
    case "requireLocation":
    case "otPromptEnabled":
      return typeof value === "boolean" ? null : "Must be true or false";
    case "dpdpConsentVersion":
      if (typeof value !== "string") return "Required";
      if (value.length === 0 || value.length > 32) return "1–32 characters";
      if (!DPDP_VERSION_REGEX.test(value)) return "Pattern: vN.N (e.g. v1.0)";
      return null;
  }
  // Exhaustiveness — TS will flag missing cases above.
  const _exhaustive: never = key;
  return _exhaustive;
}

function validateInt(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Required";
  if (!Number.isInteger(value)) return "Must be a whole number";
  if (value < min || value > max) return `Must be between ${min} and ${max}`;
  return null;
}

function validateDecimal(
  value: unknown,
  min: number,
  max: number,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Required";
  if (value < min || value > max) return `Must be between ${min} and ${max}`;
  return null;
}

