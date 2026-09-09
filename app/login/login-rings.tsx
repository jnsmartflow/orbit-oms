// The orbit rings behind the login panel. Decorative only — aria-hidden.
//
// 🔴 The corner light is NOT in here. It is a CSS radial-gradient on the panel
// element itself. An SVG gradient is trapped in its viewBox and gets sliced by
// preserveAspectRatio, which is what put a visible hard edge on the panel the
// first time round (rebrand draft §6, and §8's "any glow belongs to the element").
//
// GEOMETRY. The ring centre is 705,683 — the panel's own BOTTOM-RIGHT corner —
// and `xMaxYMax slice` pins that corner to the panel's corner at every size.
// Because `slice` COVERS, the visible slab of the viewBox is never larger than
// 705 x 683, so no point on the panel is ever further than
// sqrt(705² + 683²) ≈ 982 units from the centre.
//
// 🔴 THAT NUMBER IS A CEILING, NOT A TARGET. A radius ABOVE it is not "big
// enough to reach every edge" — it is entirely OUTSIDE the panel and draws
// nothing at all, guide circle included. The first cut of this file used 1010
// for exactly that mistaken reason and shipped a ring that never rendered a
// pixel at any viewport. The outermost radius is now 820, which is on the panel
// at every size that matters.
//
// MOTION. Nothing rotates. The circles are STATIC and only the dash travels,
// via stroke-dashoffset. That is what makes the light hold still while the arc
// slides through it: each ring's gradient is anchored in user space to that
// ring's own on-panel quadrant, so it cannot move, and the arc brightens as it
// crosses the middle of the panel and dims towards the edges.
//   A rotation would defeat this. An SVG gradient is resolved in the user space
// of the element that REFERENCES it, so a transform on the ancestor group turns
// the gradient WITH the shape and the brightness never moves relative to the
// stroke. `gradientUnits="userSpaceOnUse"` does not change that — only not
// rotating does. SMIL <animateTransform> has the identical property, so it is
// not a way out of it either.
//
// Travel is a CSS animation, so prefers-reduced-motion can switch it off. Each
// arc's resting stroke-dashoffset attribute puts it exactly where its negative
// animation-delay would have, so the static frame is a composed one and not
// whatever the keyframes happened to start on.
import * as React from "react";

const CX = 705;
const CY = 683;

// Every ring carries pathLength="360", so one path unit is one DEGREE on every
// radius: the dash numbers below are shared by all six, and the on-panel
// quadrant is always path 0 to 90. The dash is 108 of 360, i.e. 30% of a circle.
const DASH = 108;
const GAP = 360 - DASH;

const FAMILY = {
  // Arc colour, its opacity across the middle of the quadrant, and its opacity
  // where it meets the panel edge. The edge value is deliberately NOT zero — the
  // arcs are meant to run off the edges, not evaporate before they reach them.
  a: { stroke: "#EDE9FE", peak: 0.85, edge: 0.28, dot: "#FFFFFF", dotOpacity: 0.85 },
  b: { stroke: "#C4B5FD", peak: 0.7, edge: 0.22, dot: "#EDE9FE", dotOpacity: 0.8 },
} as const;

/** r · guide opacity · arc width · colour family · seconds per lap · resting dash
 *  position in degrees · travel direction · light-point radius (0 = none) */
const RINGS = [
  { r: 175, guide: 0.26, w: 2.4, fam: "a", dur: 24, phase: 330, dir: "cw", dot: 3.2 },
  { r: 300, guide: 0.22, w: 2.1, fam: "b", dur: 34, phase: 20, dir: "ccw", dot: 2.8 },
  { r: 445, guide: 0.185, w: 1.8, fam: "a", dur: 46, phase: 300, dir: "cw", dot: 0 },
  { r: 610, guide: 0.15, w: 1.6, fam: "b", dur: 58, phase: 40, dir: "ccw", dot: 0 },
  { r: 720, guide: 0.115, w: 1.35, fam: "a", dur: 72, phase: 340, dir: "cw", dot: 0 },
  { r: 820, guide: 0.085, w: 1.2, fam: "b", dur: 88, phase: 350, dir: "ccw", dot: 0 },
] as const;

/** The circle as a path STARTING at 180° (due left of the centre) and running
 *  clockwise, so with pathLength="360" a path unit is a degree measured from the
 *  panel's bottom edge and the on-panel quadrant is exactly 0 → 90. Drawn as a
 *  path rather than a <circle> because pathLength on a bare circle was broken in
 *  older Safari, and the office is on iPhones. */
function ringPath(r: number) {
  return `M${CX - r} ${CY}A${r} ${r} 0 1 1 ${CX + r} ${CY}A${r} ${r} 0 1 1 ${CX - r} ${CY}Z`;
}

/** Where the dash sits with the travel switched off. */
const restOffset = (phase: number) => (360 - phase) % 360;

/** Negative delay that starts the travel already at `phase`, so the animated
 *  first frame and the reduced-motion frame are the same picture. */
function startDelay(dur: number, phase: number, dir: "cw" | "ccw") {
  const t = dir === "cw" ? (dur * phase) / 360 : (dur * (360 - phase)) / 360;
  return `-${Math.round(t * 1000) / 1000}s`;
}

/** The light point rides the LEADING end of its arc — the end the travel pushes
 *  forward — so it reads as the head of the trail. It used to sit at the arc's
 *  midpoint, which under the old rotating gradient was the single dimmest part
 *  of the arc it was meant to be lighting. */
const dotPhase = (phase: number, dir: "cw" | "ccw") =>
  dir === "cw" ? (phase + DASH) % 360 : phase;

export function LoginRings() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="absolute inset-0 z-[1] block h-full w-full"
      viewBox="0 0 705 683"
      preserveAspectRatio="xMaxYMax slice"
    >
      <defs>
        {/* One gradient per ring, anchored in USER SPACE to the two ends of that
            ring's on-panel quadrant: 180°, which lies on the panel's bottom edge,
            to 270°, which lies on its right edge. The light therefore cannot
            move, and because the quadrant maps onto the gradient's whole 0→1 the
            arc is already dark by the time it leaves the panel. */}
        {RINGS.map((ring) => {
          const f = FAMILY[ring.fam];
          return (
            <linearGradient
              key={`grad${ring.r}`}
              id={`orbit-arc-${ring.r}`}
              gradientUnits="userSpaceOnUse"
              x1={CX - ring.r}
              y1={CY}
              x2={CX}
              y2={CY - ring.r}
            >
              <stop offset="0%" stopColor={f.stroke} stopOpacity={f.edge} />
              <stop offset="22%" stopColor={f.stroke} stopOpacity={f.peak} />
              <stop offset="78%" stopColor={f.stroke} stopOpacity={f.peak} />
              <stop offset="100%" stopColor={f.stroke} stopOpacity={f.edge} />
            </linearGradient>
          );
        })}
      </defs>

      {/* Guide circles — the geometry reads as complete even when every bright arc is elsewhere. */}
      <g fill="none" stroke="#EDE9FE" strokeWidth="1">
        {RINGS.map((ring) => (
          <circle key={`g${ring.r}`} cx={CX} cy={CY} r={ring.r} strokeOpacity={ring.guide} />
        ))}
      </g>

      {/* Travelling arcs. The paths never move; the dash does. */}
      <g fill="none" strokeLinecap="round">
        {RINGS.map((ring) => {
          const d = ringPath(ring.r);
          const f = FAMILY[ring.fam];
          return (
            <React.Fragment key={`a${ring.r}`}>
              <path
                className={`orbit-arc orbit-arc-${ring.dir}`}
                d={d}
                pathLength={360}
                stroke={`url(#orbit-arc-${ring.r})`}
                strokeWidth={ring.w}
                strokeDasharray={`${DASH} ${GAP}`}
                strokeDashoffset={restOffset(ring.phase)}
                style={{
                  animationDuration: `${ring.dur}s`,
                  animationDelay: startDelay(ring.dur, ring.phase, ring.dir),
                }}
              />
              {ring.dot > 0 && (
                <path
                  className={`orbit-arc orbit-arc-${ring.dir}`}
                  d={d}
                  pathLength={360}
                  stroke={f.dot}
                  strokeOpacity={f.dotOpacity}
                  strokeWidth={ring.dot * 2}
                  strokeDasharray="0.1 359.9"
                  strokeDashoffset={restOffset(dotPhase(ring.phase, ring.dir))}
                  style={{
                    animationDuration: `${ring.dur}s`,
                    animationDelay: startDelay(
                      ring.dur,
                      dotPhase(ring.phase, ring.dir),
                      ring.dir
                    ),
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </g>
    </svg>
  );
}
