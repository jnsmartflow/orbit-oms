// lib/tint/white-shots.ts — THE ONLY PLACE the white-shot sampling numbers live.
//
// Owner decision 2026-10-02 (docs/prompts/drafts/code-discovery-2026-10-02-
// bulk-tinter-issue.md §I-1, §I-2): the TI tab's bulk buttons are three white
// shots — TINTER, WHT = the dose, every other pigment 0 — each with ONE fixed
// sampling number used for EVERY tin size. A FIXED dose, never scaled by pack
// (the depot puts the same WHT 20 on a 4 L and a 20 L tin; live history, §A).
//
// Read by the bulk route (app/api/tint/manager/ti-bulk — which re-verifies the
// recipe server-side before every request) and by the Tint Manager's bar and
// confirm dialog for their labels. Pure: no Prisma, no React.
//
// ⚠ Never retype "26-0315" / "26-0318" / "26-0319" anywhere else. Changing a
// number here is the whole change; the route's recipe check refuses a number
// whose recipe is not WHT-only at this dose, so a wrong edit fails loudly.

export const WHITE_SHOT_PIGMENT = "WHT" as const;

export const WHITE_SHOTS = [
  { dose: 5,  samplingNo: "26-0315" },
  { dose: 20, samplingNo: "26-0318" },
  { dose: 25, samplingNo: "26-0319" },
] as const;

export type WhiteShotDose = (typeof WHITE_SHOTS)[number]["dose"];

/** The white shot for a dose, or null for anything that is not one of the three. */
export function whiteShotFor(dose: unknown): (typeof WHITE_SHOTS)[number] | null {
  return WHITE_SHOTS.find((s) => s.dose === dose) ?? null;
}
