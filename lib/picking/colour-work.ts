// ── Colour work — was this bill's colour MIXED here, or did it ship as base? ──
//
// One question, asked of a bill and nothing smaller: did the tint room actually
// make a colour for it ("tint"), or is it leaving the depot in the colour it
// arrived in ("base")? It answers for the two PROJECT divisions only; every
// other division gets `null` and says nothing.
//
// 🔴 WHY THIS EXISTS AT ALL — `orders.orderType === "tint"` IS NOT THE ANSWER.
// A bill lands on the tint rail because import classified it tint, and the Tint
// Manager can then close it through "Base — No Tint" (the placeholder worker,
// lib/tint/base-operator.ts) because the whole bill is stock colour and there
// was nothing to mix. Such a bill carries `orderType: "tint"` forever, so every
// surface reading that flag calls it tinted — which is exactly the mislabelling
// this field replaces. 15 of the 108 project-division tint bills in the 14 days
// to 2026-09-17 were closed that way.
//
// ⚠ NAMED FOR THE QUESTION, NOT FOR THE TINT MODULE. `tint-*` in
// tailwind.config.ts is a SKY BLUE family (`tint.600 = #0284C7`), and a
// `tintKind` field next to it would read as "which shade of blue". The words on
// screen are TINT and BASE; the field is what they are answers to.
//
// ⚠ PURE, AND IT MUST STAY PURE — no prisma, no clock, no I/O. Both picking
// boards and four Floor surfaces import from here, several of them client
// components, and `lib/prisma.ts` constructs a client at module scope. The
// batched database side lives next door in ./colour-work-query.ts. Same split,
// and the same reason, as lib/article-tag-parse.ts vs lib/article-tag.ts.

/**
 * What the badge says.
 *
 * `null` is a THIRD real answer and never a missing value: the division does not
 * carry this signal, or a project-division tint bill has not been finished yet
 * and nobody can honestly say which it will be.
 */
export type ColourWork = "tint" | "base";

/**
 * The two PROJECT divisions — Decorative Projects (74) and Retail Offtake (77).
 *
 * 🔴 THE ONE COPY OF THESE TWO CODES. `isSmuBadged` in
 * components/picking/card-atoms.tsx delegates to the gate below rather than
 * keeping its own list, and `SMU_BADGE_STYLE` there is typed on
 * `ProjectSmuCode`, so a code added here without a colour is a COMPILE error
 * rather than a badge that silently renders nothing.
 *
 * Why only these two: Deco Retail (70) is ~78% of a live board, so a word on it
 * would bury the ones worth reading — the identical reasoning that keeps `0d`
 * off AgeBadge. Distributor (76) and the parked `Deco` (10) do not tint.
 */
export const PROJECT_SMU_CODES = ["74", "77"] as const;

export type ProjectSmuCode = (typeof PROJECT_SMU_CODES)[number];

/** Does this SMU code carry the project-division signals (badge, colour work)? */
export function isProjectSmu(code: string | null): code is ProjectSmuCode {
  return code !== null && (PROJECT_SMU_CODES as readonly string[]).includes(code);
}

/**
 * THE CLASSIFIER. One rule, every surface — the batched loader next door feeds
 * it, and it is the only place the four answers are decided.
 *
 * ⚠ `finishedByRealOperator` WINS over `finishedByBaseOperator`. The two are
 * mutually exclusive in live data (SELECT 2026-09-17: all 15 bypassed bills
 * carry a base row and nothing else), but Undo → re-assign → real completion
 * can legitimately leave both behind, and in that case the paint WAS mixed.
 * Deciding it here rather than in a caller is what stops two surfaces
 * disagreeing about one bill.
 */
export function resolveColourWork(input: {
  /** The SAP division code, e.g. "74" — `orders.smu` resolved through SMU_CODE_BY_NAME. */
  smuCode: string | null;
  /** `orders.orderType` — "tint" | "non_tint". */
  orderType: string;
  /** A finished whole-OBD or split assignment owned by a REAL operator. */
  finishedByRealOperator: boolean;
  /** A finished whole-OBD assignment owned by the Base — No Tint placeholder. */
  finishedByBaseOperator: boolean;
}): ColourWork | null {
  if (!isProjectSmu(input.smuCode)) return null;
  // Never classified tint at import ⇒ nothing was ever going to be mixed.
  if (input.orderType !== "tint") return "base";
  if (input.finishedByRealOperator) return "tint";
  if (input.finishedByBaseOperator) return "base";
  // A tint bill still in the tint room. Deliberately NOT "tint": the shades do
  // not exist yet, and such a bill is not on a picking board anyway (it reaches
  // one only once a done route advances its stage).
  return null;
}
