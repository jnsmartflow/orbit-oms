// The orbit rings behind the login panel. Decorative only — aria-hidden.
//
// 🔴 The corner light is NOT in here. It is a CSS radial-gradient on the panel
// element itself. An SVG gradient is trapped in its viewBox and gets sliced by
// preserveAspectRatio, which is what put a visible hard edge on the panel the
// first time round (rebrand draft §6, and §8's "any glow belongs to the element").
//
// 🔴 THE viewBox IS 700x512 AND ITS ASPECT RATIO IS LOAD-BEARING. Do not
// "correct" it to the panel's proportions. Under `slice` the scale is
// max(panelW/vbW, panelH/vbH), so the viewBox's ASPECT is what decides how large
// the rings render and how much of the set lands on the panel. A previous cut
// derived 705x683 from the panel's own proportions, believing that was the
// precise thing to do: it shrank every ring, dragged four extra curves onto the
// panel and made the whole layer read as clutter. These numbers are the
// reference file's — docs/mockups/rebrand/orbit-login-rings-edge.html — and they
// are the design, not an approximation of it.
//
// The far ring (r=820) is mostly or entirely off-panel at most window sizes, and
// that is FINE and deliberate. The set looks right with it there and a ring that
// contributes nothing also costs nothing. It is not a bug to be optimised out.
//
// Rotation is a CSS animation rather than SMIL <animateTransform>. That is the
// ONE departure from the reference and it buys prefers-reduced-motion, which
// SMIL cannot honour: a media query can switch a CSS animation off and cannot
// touch an <animateTransform>. The motion is otherwise identical — the group
// turns, and the arcs' gradients turn with it exactly as they do in the mockup.
import * as React from "react";

const CX = 700;
const CY = 512;

/** r · guide opacity · arc width · gradient · dasharray · lap · direction ·
 *  resting angle (see below) · light-point radius (0 = none) */
const RINGS = [
  { r: 150, guide: 0.2,   w: 2.4, grad: "a", dash: "230 713",  dur: "30s",  dir: "cw",  rest: 166, dot: 3.2 },
  { r: 262, guide: 0.17,  w: 2,   grad: "b", dash: "360 1286", dur: "52s",  dir: "ccw", rest: 199, dot: 2.8 },
  { r: 388, guide: 0.145, w: 1.7, grad: "a", dash: "500 1938", dur: "72s",  dir: "cw",  rest: 181, dot: 0 },
  { r: 524, guide: 0.12,  w: 1.5, grad: "b", dash: "620 2672", dur: "94s",  dir: "ccw", rest: 211, dot: 0 },
  { r: 668, guide: 0.095, w: 1.3, grad: "a", dash: "760 3437", dur: "122s", dir: "cw",  rest: 192, dot: 0 },
  { r: 820, guide: 0.07,  w: 1.2, grad: "b", dash: "900 4252", dur: "150s", dir: "ccw", rest: 204, dot: 0 },
] as const;

export function LoginRings() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="absolute inset-0 z-[1] block h-full w-full"
      viewBox="0 0 700 512"
      preserveAspectRatio="xMaxYMax slice"
    >
      <defs>
        {/* The reference's `ra` and `rb`, stop for stop. Only the ids are
            namespaced — `ra` / `rb` are too generic to put in an app page. */}
        <linearGradient id="orbit-arc-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#EDE9FE" stopOpacity="0" />
          <stop offset="45%" stopColor="#EDE9FE" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#EDE9FE" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="orbit-arc-b" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C4B5FD" stopOpacity="0" />
          <stop offset="50%" stopColor="#C4B5FD" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#C4B5FD" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Guide circles — the geometry reads as complete even when every bright arc is elsewhere. */}
      <g fill="none" stroke="#EDE9FE" strokeWidth="1">
        {RINGS.map((ring) => (
          <circle key={`g${ring.r}`} cx={CX} cy={CY} r={ring.r} strokeOpacity={ring.guide} />
        ))}
      </g>

      {/* Travelling arcs. Each group turns as a whole, gradient and light point
          with it, exactly as the mockup's <animateTransform> does. */}
      <g fill="none" strokeLinecap="round">
        {RINGS.map((ring) => (
          <g
            key={`a${ring.r}`}
            className={`orbit-ring orbit-ring-${ring.dir}`}
            style={
              {
                animationDuration: ring.dur,
                // Where the group parks when prefers-reduced-motion switches the
                // animation off. The reference has no reduced-motion state to be
                // faithful to, and at a flat 0° every arc sits off the panel —
                // a reduced-motion visitor would get guide circles and nothing
                // else. These angles put each arc on the panel, spread across
                // the quadrant. Read ONLY inside the reduced-motion block.
                "--orbit-rest": `${ring.rest}deg`,
              } as React.CSSProperties
            }
          >
            <circle
              cx={CX}
              cy={CY}
              r={ring.r}
              stroke={`url(#orbit-arc-${ring.grad})`}
              strokeWidth={ring.w}
              strokeDasharray={ring.dash}
            />
            {ring.dot > 0 && (
              <circle
                cx={CX}
                cy={CY - ring.r}
                r={ring.dot}
                fill={ring.grad === "a" ? "#FFFFFF" : "#EDE9FE"}
                opacity={ring.grad === "a" ? 0.85 : 0.8}
                stroke="none"
              />
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}
