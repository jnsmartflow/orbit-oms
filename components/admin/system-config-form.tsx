"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

// ── Config metadata ────────────────────────────────────────────────────────────

type FieldType = "time" | "integer" | "boolean";

interface ConfigMeta {
  label: string;
  description: string;
  type: FieldType;
  section: "timing" | "planning";
}

const CONFIG_META: Record<string, ConfigMeta> = {
  dispatch_cutoff_time: {
    label: "Dispatch Cutoff Time",
    description: "Daily cutoff for same-day slot assignment (HH:MM format).",
    type: "time",
    section: "timing",
  },
  soft_lock_minutes_before_cutoff: {
    label: "Soft Lock (minutes before cutoff)",
    description: "Minutes before cutoff when a draft plan transitions to soft lock.",
    type: "integer",
    section: "timing",
  },
  hard_lock_minutes_before_cutoff: {
    label: "Hard Lock (minutes before cutoff)",
    description: "Minutes before cutoff when a soft-locked plan transitions to hard lock.",
    type: "integer",
    section: "timing",
  },
  ready_escalation_minutes: {
    label: "Ready Escalation (minutes)",
    description: "Minutes after material is ready before an escalation alert fires.",
    type: "integer",
    section: "planning",
  },
  upgrade_small_overflow_pct: {
    label: "Overflow Upgrade Threshold (%)",
    description: "Maximum overflow percentage before a vehicle upgrade is suggested.",
    type: "integer",
    section: "planning",
  },
  upgrade_max_dealer_combo: {
    label: "Max Dealer Combination",
    description: "Maximum number of dealers in a concentration check for split suggestions.",
    type: "integer",
    section: "planning",
  },
  aging_priority_days: {
    label: "Aging Priority Days",
    description: "Days before an order automatically gains tier-3 priority.",
    type: "integer",
    section: "planning",
  },
  aging_alert_days: {
    label: "Aging Alert Days",
    description: "Days before an aging order triggers an escalation alert.",
    type: "integer",
    section: "planning",
  },
  change_queue_urgent_alert: {
    label: "Urgent Orders Bypass Change Queue",
    description: "When enabled, urgent orders skip the change queue and are actioned immediately.",
    type: "boolean",
    section: "planning",
  },
};

// ── Validation ─────────────────────────────────────────────────────────────────

function validateSection(
  keys: string[],
  values: Record<string, string>
): string | null {
  for (const key of keys) {
    const meta = CONFIG_META[key];
    const val = values[key] ?? "";
    if (meta.type === "time") {
      if (!/^\d{2}:\d{2}$/.test(val)) {
        return `"${meta.label}" must be in HH:MM format (e.g. 10:30).`;
      }
    } else if (meta.type === "integer") {
      const n = Number(val);
      if (!Number.isInteger(n) || n <= 0) {
        return `"${meta.label}" must be a positive integer.`;
      }
    }
    // boolean handled by Switch — value is always "true" or "false"
  }
  return null;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConfigRow {
  id: number;
  key: string;
  value: string;
}

interface SystemConfigFormProps {
  initialRows: ConfigRow[];
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SystemConfigForm({ initialRows }: SystemConfigFormProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(initialRows.map((r) => [r.key, r.value]))
  );
  const [saving, setSaving] = useState<"timing" | "planning" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const timingKeys = Object.entries(CONFIG_META)
    .filter(([, m]) => m.section === "timing")
    .map(([k]) => k);

  const planningKeys = Object.entries(CONFIG_META)
    .filter(([, m]) => m.section === "planning")
    .map(([k]) => k);

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSave(section: "timing" | "planning") {
    const keys = section === "timing" ? timingKeys : planningKeys;
    const validationError = validateSection(keys, values);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(section);
    try {
      const res = await fetch("/api/admin/system-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: keys.map((key) => ({ key, value: values[key] })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save configuration.");
        return;
      }

      toast.success("Configuration saved.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  function renderField(key: string) {
    const meta = CONFIG_META[key];
    if (!meta) return null;
    const value = values[key] ?? "";

    if (meta.type === "boolean") {
      return (
        <div key={key} className="flex items-start justify-between gap-4 py-3 border-b last:border-0">
          <div className="flex-1">
            <Label className="text-sm font-medium text-slate-900">{meta.label}</Label>
            <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
          </div>
          <Switch
            checked={value === "true"}
            onCheckedChange={(checked) => handleChange(key, checked ? "true" : "false")}
          />
        </div>
      );
    }

    return (
      <div key={key} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start py-3 border-b last:border-0">
        <div className="sm:col-span-2">
          <Label htmlFor={key} className="text-sm font-medium text-slate-900">
            {meta.label}
          </Label>
          <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
        </div>
        <Input
          id={key}
          value={value}
          onChange={(e) => handleChange(key, e.target.value)}
          placeholder={meta.type === "time" ? "HH:MM" : "0"}
          className="sm:mt-1"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Timing & Slots */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Timing &amp; Slots</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">{timingKeys.map(renderField)}</div>
          <div className="flex justify-end">
            <Button
              onClick={() => handleSave("timing")}
              disabled={saving === "timing"}
              size="sm"
            >
              {saving === "timing" ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Planning Rules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Planning Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">{planningKeys.map(renderField)}</div>
          <div className="flex justify-end">
            <Button
              onClick={() => handleSave("planning")}
              disabled={saving === "planning"}
              size="sm"
            >
              {saving === "planning" ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
