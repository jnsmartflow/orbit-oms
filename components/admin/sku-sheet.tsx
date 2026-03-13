"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const CONTAINER_TYPES = ["tin", "drum", "carton", "bag"] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export interface SkuRow {
  id: number;
  skuCode: string;
  skuName: string;
  packSize: string;
  containerType: string;
  unitsPerCarton: number | null;
  grossWeightPerUnit: number;
  isActive: boolean;
}

interface SkuSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SkuRow | null;
  onSaved: (sku: SkuRow) => void;
}

const EMPTY = {
  skuCode: "",
  skuName: "",
  packSize: "",
  containerType: "tin" as ContainerType,
  unitsPerCarton: "",
  grossWeightPerUnit: "",
  isActive: true,
};

function buildForm(editing: SkuRow | null) {
  if (!editing) return EMPTY;
  return {
    skuCode: editing.skuCode,
    skuName: editing.skuName,
    packSize: editing.packSize,
    containerType: editing.containerType as ContainerType,
    unitsPerCarton: editing.unitsPerCarton?.toString() ?? "",
    grossWeightPerUnit: editing.grossWeightPerUnit.toString(),
    isActive: editing.isActive,
  };
}

export function SkuSheet({ open, onOpenChange, editing, onSaved }: SkuSheetProps) {
  const [form, setForm] = useState(buildForm(editing));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(buildForm(editing));
      setFieldErrors({});
    }
  }, [open, editing]);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.skuCode.trim()) errs.skuCode = "SKU code is required.";
    if (!form.skuName.trim()) errs.skuName = "SKU name is required.";
    if (!form.grossWeightPerUnit) {
      errs.grossWeightPerUnit = "Gross weight is required.";
    } else if (isNaN(parseFloat(form.grossWeightPerUnit)) || parseFloat(form.grossWeightPerUnit) <= 0) {
      errs.grossWeightPerUnit = "Must be a positive number.";
    }
    if (form.unitsPerCarton && (isNaN(parseInt(form.unitsPerCarton, 10)) || parseInt(form.unitsPerCarton, 10) <= 0)) {
      errs.unitsPerCarton = "Must be a positive integer.";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);

    const body = {
      skuCode: form.skuCode.trim().toUpperCase(),
      skuName: form.skuName.trim(),
      packSize: form.packSize.trim(),
      containerType: form.containerType,
      unitsPerCarton: form.unitsPerCarton ? parseInt(form.unitsPerCarton, 10) : null,
      grossWeightPerUnit: parseFloat(form.grossWeightPerUnit),
      isActive: form.isActive,
    };

    try {
      const url = editing ? `/api/admin/skus/${editing.id}` : "/api/admin/skus";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ skuCode: "SKU code already exists." });
        } else {
          toast.error(data.error ?? "Failed to save.");
        }
        return;
      }
      toast.success(editing ? "SKU updated." : `SKU "${data.skuCode}" created.`);
      onSaved(data);
      onOpenChange(false);
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit SKU" : "Add SKU"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sku-code">SKU Code</Label>
              <Input
                id="sku-code"
                value={form.skuCode}
                onChange={(e) => setField("skuCode", e.target.value.toUpperCase())}
                placeholder="e.g. APX-4L-TIN"
              />
              {fieldErrors.skuCode && <p className="text-xs text-destructive">{fieldErrors.skuCode}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sku-pack">Pack Size</Label>
              <Input
                id="sku-pack"
                value={form.packSize}
                onChange={(e) => setField("packSize", e.target.value)}
                placeholder="e.g. 4L, 20L"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sku-name">SKU Name</Label>
            <Input
              id="sku-name"
              value={form.skuName}
              onChange={(e) => setField("skuName", e.target.value)}
            />
            {fieldErrors.skuName && <p className="text-xs text-destructive">{fieldErrors.skuName}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sku-container">Container Type</Label>
              <Select
                value={form.containerType}
                onValueChange={(v) => setField("containerType", v as ContainerType)}
              >
                <SelectTrigger id="sku-container">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTAINER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sku-units">
                Units / Carton
                <span className="ml-1 text-slate-400 font-normal text-xs">(optional)</span>
              </Label>
              <Input
                id="sku-units"
                type="number"
                min="1"
                step="1"
                value={form.unitsPerCarton}
                onChange={(e) => setField("unitsPerCarton", e.target.value)}
                placeholder={form.containerType === "drum" ? "N/A for drums" : ""}
                disabled={form.containerType === "drum"}
              />
              {fieldErrors.unitsPerCarton && (
                <p className="text-xs text-destructive">{fieldErrors.unitsPerCarton}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sku-weight">Gross Weight per Unit (kg)</Label>
            <Input
              id="sku-weight"
              type="number"
              min="0"
              step="any"
              value={form.grossWeightPerUnit}
              onChange={(e) => setField("grossWeightPerUnit", e.target.value)}
              placeholder="e.g. 4.5"
            />
            {fieldErrors.grossWeightPerUnit && (
              <p className="text-xs text-destructive">{fieldErrors.grossWeightPerUnit}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setField("isActive", v)}
            />
            <Label className="cursor-pointer">Active</Label>
          </div>

          <SheetFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create SKU"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
