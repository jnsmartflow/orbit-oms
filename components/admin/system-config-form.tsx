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
  soft_lock_minutes_before_cutoff: {
    label: "Soft Lock (minutes before cutoff)",
    description: "Plan enters soft-lock, approval queue opens.",
    type: "integer",
    section: "timing",
  },
  hard_lock_minutes_before_cutoff: {
    label: "Hard Lock (minutes before cutoff)",
    description: "New orders auto-routed to next slot.",
    type: "integer",
    section: "timing",
  },
  ready_escalation_minutes: {
    label: "Escalation Timer (minutes)",
    description: "Fires if dispatcher hasn't acted after material ready.",
    type: "integer",
    section: "timing",
  },
  slot_morning_cutoff: {
    label: "Morning Slot Cutoff",
    description: "Orders received before this time are assigned to Morning slot.",
    type: "time",
    section: "timing",
  },
  slot_afternoon_cutoff: {
    label: "Afternoon Slot Cutoff",
    description: "Orders received before this time are assigned to Afternoon slot.",
    type: "time",
    section: "timing",
  },
  slot_evening_cutoff: {
    label: "Evening Slot Cutoff",
    description: "Orders received before this time are assigned to Evening slot.",
    type: "time",
    section: "timing",
  },
  upgrade_small_overflow_pct: {
    label: "Overflow Upgrade Threshold (%)",
    description: "Max overflow before upgrade suggested over bump.",
    type: "integer",
    section: "planning",
  },
  upgrade_max_dealer_combo: {
    label: "Max Dealer Combo (split check)",
    description: "Dealers checked for concentration before split.",
    type: "integer",
    section: "planning",
  },
  aging_priority_days: {
    label: "Aging Priority Days",
    description: "Days before order elevates to tier-3 priority.",
    type: "integer",
    section: "planning",
  },
  aging_alert_days: {
    label: "Aging Alert Days",
    description: "Days before escalation alert fires.",
    type: "integer",
    section: "planning",
  },
  change_queue_urgent_alert: {
    label: "Urgent Hold Alert",
    description: "Show prominent notification for Urgent orders on Hold.",
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
            <Label className="text-sm font-medium text-gray-900">{meta.label}</Label>
            <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
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
          <Label htmlFor={key} className="text-sm font-medium text-gray-900">
            {meta.label}
          </Label>
          <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
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
      {/* Timing & Locks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Timing &amp; Locks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">{timingKeys.map(renderField)}</div>
          <div className="flex justify-end">
            <Button
              onClick={() => handleSave("timing")}
              disabled={saving === "timing"}
              size="sm"
              className="oa-btn-primary"
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
              className="oa-btn-primary"
            >
              {saving === "planning" ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
