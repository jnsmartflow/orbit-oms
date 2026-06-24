// Inclusive cutoffs — 10:30 is Morning, not Afternoon.
// This is the deliberate change from old resolveSlot().

// ── Cutoffs type + defaults (IST minutes since midnight) ─────────────────────

export interface SlotCutoffs {
  morning: number;     // default 630  = 10:30
  afternoon: number;   // default 750  = 12:30
  evening: number;     // default 1020 = 17:00
  lateEvening: number; // default 1200 = 20:00
}

export const DEFAULT_SLOT_CUTOFFS: SlotCutoffs = {
  morning:     630,
  afternoon:   750,
  evening:     1020,
  lateEvening: 1200,
};

// ── Slot ids — real slot_master primary keys, do not change without a DB migration ──

export const SLOT_MORNING      = 1; // Morning
export const SLOT_AFTERNOON    = 2; // Afternoon
export const SLOT_EVENING      = 3; // Evening
export const SLOT_LATE_EVENING = 7; // Late Evening  (id 7 — not sequential; 5/6 were taken)
export const SLOT_NIGHT        = 4; // Night

// ── IST minutes conversion ────────────────────────────────────────────────────

/** Returns IST minutes since midnight (0–1439) for a given Date. */
export function istMinutes(date: Date): number {
  const [h, m] = date
    .toLocaleString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .split(":")
    .map(Number);
  return h * 60 + m;
}

// ── Internal boundary ─────────────────────────────────────────────────────────

// Returns a slot index (0=Morning … 4=Night). Both public functions go through
// this so id and name can never disagree.
function slotIndex(
  mins: number,
  cutoffs: SlotCutoffs,
): 0 | 1 | 2 | 3 | 4 {
  if (mins <= cutoffs.morning)     return 0;
  if (mins <= cutoffs.afternoon)   return 1;
  if (mins <= cutoffs.evening)     return 2;
  if (mins <= cutoffs.lateEvening) return 3;
  return 4;
}

const SLOT_IDS = [
  SLOT_MORNING,
  SLOT_AFTERNOON,
  SLOT_EVENING,
  SLOT_LATE_EVENING,
  SLOT_NIGHT,
] as const;

const SLOT_NAMES = [
  "Morning",
  "Afternoon",
  "Evening",
  "Late Evening",
  "Night",
] as const;

export type ArrivalSlotName = typeof SLOT_NAMES[number];

// ── Public API ────────────────────────────────────────────────────────────────

/** Resolves a Date to the arrival slot_master id using inclusive cutoffs. */
export function resolveArrivalSlotId(
  date: Date,
  cutoffs: SlotCutoffs = DEFAULT_SLOT_CUTOFFS,
): number {
  return SLOT_IDS[slotIndex(istMinutes(date), cutoffs)];
}

/** Resolves a Date to the arrival slot name using inclusive cutoffs. */
export function resolveArrivalSlotName(
  date: Date,
  cutoffs: SlotCutoffs = DEFAULT_SLOT_CUTOFFS,
): ArrivalSlotName {
  return SLOT_NAMES[slotIndex(istMinutes(date), cutoffs)];
}
