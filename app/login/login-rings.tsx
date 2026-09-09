// The orbit rings behind the login panel. Decorative only — aria-hidden.
//
// 🔴 The corner light is NOT in here. It is a CSS radial-gradient on the panel
// element itself. An SVG gradient is trapped in its viewBox and gets sliced by
// preserveAspectRatio, which is what put a visible hard edge on the panel the
// first time round (rebrand draft §6, and §8's "any glow belongs to the element").
//
// Geometry: the ring centre sits at 705,683 — the panel's own BOTTOM-RIGHT
// corner — and `xMaxYMax slice` pins that corner to the panel's corner at every
// size. Because `slice` covers, the visible slab of the viewBox is never larger
// than 705 x 683, so the furthest visible point from the centre is at most
// sqrt(705² + 683²) ≈ 982. The outermost radius is 1010, which is why the arcs
// run off every edge instead of stopping in mid-air at a short viewport.
//
// Rotation is a CSS animation, not <animateTransform>. SMIL cannot be switched
// off by a media query and prefers-reduced-motion has to render these static.
import * as React from "react";

const CX = 705;
const CY = 683;

/** r, guide opacity, arc stroke width, gradient, dash, gap, dash start, duration, direction */
const RINGS = [
  { r: 175,  guide: 0.26,  w: 2.4, grad: "a", dash: 330,  gap: 770,  offset: -550,  dur: "34s",  dir: "cw"  },
  { r: 300,  guide: 0.22,  w: 2.1, grad: "b", dash: 565,  gap: 1320, offset: -1169, dur: "58s",  dir: "ccw" },
  { r: 445,  guide: 0.185, w: 1.8, grad: "a", dash: 839,  gap: 1957, offset: -1510, dur: "80s",  dir: "cw"  },
  { r: 610,  guide: 0.15,  w: 1.6, grad: "b", dash: 1150, gap: 2683, offset: -2530, dur: "104s", dir: "ccw" },
  { r: 800,  guide: 0.115, w: 1.35, grad: "a", dash: 1508, gap: 3519, offset: -2614, dur: "132s", dir: "cw"  },
  { r: 1010, guide: 0.085, w: 1.2, grad: "b", dash: 1904, gap: 4443, offset: -4443, dur: "162s", dir: "ccw" },
] as const;

/** A light point riding a ring, parked mid-way through the visible quadrant (225°). */
function ridePoint(r: number) {
  const k = 0.70710678;
  return { cx: CX - r * k, cy: CY - r * k };
}

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

      {/* Travelling arcs. */}
      <g fill="none" strokeLinecap="round">
        {RINGS.map((ring, i) => {
          const point = i < 2 ? ridePoint(ring.r) : null;
          return (
            <g
              key={`a${ring.r}`}
              className={`orbit-ring orbit-ring-${ring.dir}`}
              style={{ animationDuration: ring.dur }}
            >
              <circle
                cx={CX}
                cy={CY}
                r={ring.r}
                stroke={`url(#orbit-arc-${ring.grad})`}
                strokeWidth={ring.w}
                strokeDasharray={`${ring.dash} ${ring.gap}`}
                strokeDashoffset={ring.offset}
              />
              {point && (
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r={i === 0 ? 3.2 : 2.8}
                  fill={i === 0 ? "#FFFFFF" : "#EDE9FE"}
                  opacity={i === 0 ? 0.85 : 0.8}
                  stroke="none"
                />
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
