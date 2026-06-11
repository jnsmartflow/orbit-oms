"use client";

import { useEffect, useRef, useState } from "react";

// ── /po opening screen ────────────────────────────────────────────────────
// Full-screen teal Orbit splash shown on app open. Purely presentational and
// self-timed: it fades the mark + wordmark in on mount, stays up until BOTH a
// minimum hold (~1000ms) has elapsed AND `ready` (catalog loaded) is true, then
// fades the whole overlay out and calls onDone.
//
// PURE VISUAL — by contract this component must NOT:
//   • pushState / touch history,
//   • read or write --vvh,
//   • register focus / keyboard listeners.
// CSS transitions only (§22 — no visualViewport / translateY / scroll math).
// position:fixed inset-0 escapes <main>'s overflow-hidden + --vvh height and
// full-bleeds over the status-bar area; pointer-events:none lets taps fall
// through while it dismisses.

const MIN_HOLD_MS = 1000; // minimum time the splash stays up after mount
const FADE_OUT_MS = 400;  // overlay opacity 1→0 duration
const ENTER_MS    = 500;  // mark + wordmark fade/scale-in duration

export default function SplashScreen({
  ready,
  onDone,
}: {
  ready: boolean;
  onDone: () => void;
}) {
  const [enter, setEnter]     = useState(false); // content faded/scaled in
  const [held, setHeld]       = useState(false); // min-hold elapsed
  const [leaving, setLeaving] = useState(false); // overlay fading out
  const [reduced, setReduced] = useState(false); // prefers-reduced-motion
  const doneRef = useRef(false);

  // One-time reads on mount: kick off the content fade-in (next frame so the
  // opacity transition runs), start the min-hold timer, and snapshot the
  // reduced-motion preference. matchMedia is a read, not an event listener.
  useEffect(() => {
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const raf = requestAnimationFrame(() => setEnter(true));
    const hold = setTimeout(() => setHeld(true), MIN_HOLD_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hold);
    };
  }, []);

  // Begin the fade-out once the min-hold has elapsed AND the catalog is ready.
  // (dataLoading always resolves — fetch .finally — so `ready` always flips.)
  useEffect(() => {
    if (held && ready) setLeaving(true);
  }, [held, ready]);

  // onDone fires on the overlay's fade-out transitionend; this timer is the
  // guaranteed fallback so onDone always fires even if transitionend is missed.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(finish, FADE_OUT_MS + 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }

  return (
    <div
      aria-hidden="true"
      onTransitionEnd={(e) => {
        // Only the overlay's OWN opacity fade-out should end the splash — ignore
        // the content cluster's bubbled fade-in transitionend.
        if (leaving && e.target === e.currentTarget && e.propertyName === "opacity") {
          finish();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647, // above the Orbit bar, footers, and every overlay
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Approved launch-image gradient: top #0e988b → #0d9488 → bottom #0b8579.
        background: "linear-gradient(180deg, #0e988b 0%, #0d9488 50%, #0b8579 100%)",
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_OUT_MS}ms ease-out`,
      }}
    >
      {/* Very-soft white radial glow behind the mark. */}
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Centred cluster: real Orbit mark + "Orbit" wordmark. Fades in on mount
          (opacity 0→1) with a subtle scale (0.96→1); scale is dropped under
          prefers-reduced-motion (simple fade kept). */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: enter ? 1 : 0,
          transform: enter || reduced ? "scale(1)" : "scale(0.96)",
          transition: reduced
            ? `opacity ${ENTER_MS}ms ease-out`
            : `opacity ${ENTER_MS}ms ease-out, transform ${ENTER_MS}ms ease-out`,
        }}
      >
        {/* Orbit mark — geometry from public/icon-source.svg, white on teal.
            viewBox 22 at 112px → ring r7 renders ~71px diameter. */}
        <svg width="112" height="112" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="#fff" strokeWidth="1.6" />
          <circle cx="11" cy="11" r="2.2" fill="#fff" />
          <circle cx="18" cy="11" r="2" fill="#fff" />
        </svg>
        <div
          style={{
            color: "#fff",
            fontWeight: 600,
            fontSize: 34,
            lineHeight: 1,
            marginTop: 14,
            letterSpacing: "-0.5px",
          }}
        >
          Orbit
        </div>
      </div>
    </div>
  );
}
