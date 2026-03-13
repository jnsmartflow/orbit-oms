"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DeliveryType {
  id: number;
  name: string;
}

interface CutoffSlot {
  id: number;
  deliveryTypeId: number;
  deliveryType: DeliveryType;
  slotNumber: number;
  label: string;
  cutoffTime: string;
  isDefaultForType: boolean;
  isActive: boolean;
}

interface DispatchCutoffsFormProps {
  initialSlots: CutoffSlot[];
  deliveryTypes: DeliveryType[];
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DispatchCutoffsForm({ initialSlots, deliveryTypes }: DispatchCutoffsFormProps) {
  const [slots, setSlots] = useState<CutoffSlot[]>(initialSlots);
  const [saving, setSaving] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // New slot form state
  const [newDeliveryTypeId, setNewDeliveryTypeId] = useState<string>("");
  const [newLabel, setNewLabel] = useState("");
  const [newCutoffTime, setNewCutoffTime] = useState("");
  const [adding, setAdding] = useState(false);

  // Group slots by delivery type
  const grouped = deliveryTypes.map((dt) => ({
    deliveryType: dt,
    slots: slots
      .filter((s) => s.deliveryTypeId === dt.id)
      .sort((a, b) => a.slotNumber - b.slotNumber),
  }));

  // ── Inline save (label + cutoffTime) ────────────────────────────────────────
  async function handleSaveSlot(slot: CutoffSlot, label: string, cutoffTime: string) {
    if (!/^\d{2}:\d{2}$/.test(cutoffTime)) {
      toast.error(`"${label}" cutoff time must be in HH:MM format (e.g. 10:30).`);
      return;
    }
    setSaving(slot.id);
    try {
      const res = await fetch(`/api/admin/dispatch-cutoffs/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, cutoffTime }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save.");
        return;
      }
      const updated = await res.json();
      setSlots((prev) => prev.map((s) => (s.id === slot.id ? updated : s)));
      toast.success("Slot saved.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  // ── Toggle isActive ──────────────────────────────────────────────────────────
  async function handleToggleActive(slot: CutoffSlot, value: boolean) {
    try {
      const res = await fetch(`/api/admin/dispatch-cutoffs/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: value }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to update.");
        return;
      }
      const updated = await res.json();
      setSlots((prev) => prev.map((s) => (s.id === slot.id ? updated : s)));
      toast.success(value ? "Slot enabled." : "Slot disabled.");
    } catch {
      toast.error("Network error. Please try again.");
    }
  }

  // ── Set default slot for delivery type ──────────────────────────────────────
  async function handleSetDefault(slot: CutoffSlot) {
    try {
      const res = await fetch(`/api/admin/dispatch-cutoffs/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefaultForType: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to set default.");
        return;
      }
      // Update local state — set this slot as default, remove from others in same delivery type
      setSlots((prev) =>
        prev.map((s) => ({
          ...s,
          isDefaultForType:
            s.deliveryTypeId === slot.deliveryTypeId ? s.id === slot.id : s.isDefaultForType,
        }))
      );
      toast.success(`${slot.label} set as default for ${slot.deliveryType.name}.`);
    } catch {
      toast.error("Network error. Please try again.");
    }
  }

  // ── Add new slot ─────────────────────────────────────────────────────────────
  async function handleAddSlot() {
    if (!newDeliveryTypeId) { toast.error("Please select a delivery type."); return; }
    if (!newLabel.trim())   { toast.error("Please enter a label."); return; }
    if (!/^\d{2}:\d{2}$/.test(newCutoffTime)) {
      toast.error("Cutoff time must be in HH:MM format (e.g. 10:30).");
      return;
    }

    const dtId = parseInt(newDeliveryTypeId);
    const existingSlots = slots.filter((s) => s.deliveryTypeId === dtId);
    const nextSlotNumber = existingSlots.length > 0
      ? Math.max(...existingSlots.map((s) => s.slotNumber)) + 1
      : 1;

    setAdding(true);
    try {
      const res = await fetch("/api/admin/dispatch-cutoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryTypeId: dtId,
          slotNumber: nextSlotNumber,
          label: newLabel.trim(),
          cutoffTime: newCutoffTime,
          isDefaultForType: false,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to add slot.");
        return;
      }
      const created = await res.json();
      setSlots((prev) => [...prev, created]);
      toast.success("New slot added.");
      setAddOpen(false);
      setNewDeliveryTypeId("");
      setNewLabel("");
      setNewCutoffTime("");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  // ── Render a single slot row ─────────────────────────────────────────────────
  function SlotRow({ slot }: { slot: CutoffSlot }) {
    const [label, setLabel] = useState(slot.label);
    const [cutoffTime, setCutoffTime] = useState(slot.cutoffTime);
    const isDirty = label !== slot.label || cutoffTime !== slot.cutoffTime;

    return (
      <div className="flex items-center gap-3 py-3 border-b last:border-0">
        <span className="w-8 text-center text-xs font-semibold text-slate-400">
          S{slot.slotNumber}
        </span>

        <div className="flex-1">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Morning"
            className="h-8 text-sm"
          />
        </div>

        <div className="w-28">
          <Input
            value={cutoffTime}
            onChange={(e) => setCutoffTime(e.target.value)}
            placeholder="HH:MM"
            className="h-8 text-sm font-mono"
          />
        </div>

        <div className="w-24 flex justify-center">
          {slot.isDefaultForType ? (
            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-300">
              ★ Default
            </Badge>
          ) : (
            <button
              onClick={() => handleSetDefault(slot)}
              className="text-xs text-slate-400 hover:text-blue-600 underline underline-offset-2"
            >
              Set default
            </button>
          )}
        </div>

        <div className="w-28 flex justify-center">
          <button
            onClick={() => handleToggleActive(slot, !slot.isActive)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              slot.isActive
                ? "bg-green-50 text-green-700 border-green-300 hover:bg-green-100"
                : "bg-red-50 text-red-600 border-red-300 hover:bg-red-100"
            }`}
          >
            {slot.isActive ? "● Active" : "○ Inactive"}
          </button>
        </div>

        <Button
          size="sm"
          disabled={!isDirty || saving === slot.id}
          onClick={() => handleSaveSlot(slot, label, cutoffTime)}
          className="w-16 text-xs"
        >
          {saving === slot.id ? "..." : "Save"}
        </Button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Column headers */}
      <div className="flex items-center gap-4 px-0 text-xs font-medium text-slate-400 uppercase tracking-wide">
        <span className="w-8 text-center">#</span>
        <span className="flex-1">Label</span>
        <span className="w-28">Cutoff Time</span>
        <span className="w-20 text-center">Default</span>
        <span className="w-28">Status</span>
        <span className="w-16"></span>
      </div>

      {grouped.map(({ deliveryType, slots: dtSlots }) => (
        <Card key={deliveryType.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{deliveryType.name} Delivery</span>
              <span className="text-xs font-normal text-slate-400">
                {dtSlots.filter((s) => s.isActive).length} of {dtSlots.length} slots active
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dtSlots.length === 0 ? (
              <p className="text-sm text-slate-400 py-3">No slots configured yet. Add one below.</p>
            ) : (
              dtSlots.map((slot) => <SlotRow key={slot.id} slot={slot} />)
            )}
          </CardContent>
        </Card>
      ))}

      {/* Add new slot button */}
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" />
          Add Slot
        </Button>
      </div>

      {/* Add slot dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Cutoff Slot</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">Delivery Type</Label>
              <Select value={newDeliveryTypeId} onValueChange={(v) => setNewDeliveryTypeId(v ?? "")}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select delivery type" />
                </SelectTrigger>
                <SelectContent>
                  {deliveryTypes.map((dt) => (
                    <SelectItem key={dt.id} value={String(dt.id)}>
                      {dt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium">Label</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Morning, Afternoon, Night"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Cutoff Time (HH:MM)</Label>
              <Input
                className="mt-1 font-mono"
                placeholder="e.g. 10:30"
                value={newCutoffTime}
                onChange={(e) => setNewCutoffTime(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddSlot} disabled={adding}>
              {adding ? "Adding..." : "Add Slot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
