"use client";

interface CascadeBadgeProps {
  originalSlotName: string;
}

export function CascadeBadge({ originalSlotName }: CascadeBadgeProps) {
  return (
    <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
      ⏩ from {originalSlotName}
    </span>
  );
}

export function shouldShowCascadeBadge(
  slotId: number | null,
  originalSlotId: number | null,
): boolean {
  return slotId !== null && originalSlotId !== null && slotId !== originalSlotId;
}

export function getOriginalSlotName(
  originalSlotId: number | null,
  slots: { id: number; name: string }[],
): string | null {
  if (!originalSlotId) return null;
  return slots.find((s) => s.id === originalSlotId)?.name ?? null;
}
