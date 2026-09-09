"use client";

import { useEffect, useRef, useState } from "react";
import { OrbitWordmark } from "@/components/shared/orbit-wordmark";

// ── /po opening screen ────────────────────────────────────────────────────
// Full-screen violet Orbit splash shown on app open. Purely presentational and
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
        // 🔴 THE TWO END STOPS WERE STILL TEAL. The bulk conversion swapped the
        // middle stop to violet and left #0e988b and #0b8579 standing, so the first
        // screen a picker saw on opening /po faded teal → violet → teal — the old
        // identity, on the one surface that exists to announce the new one.
        //
        // It carried a comment calling it the "approved launch-image gradient". That
        // approval was given for a teal product and does not survive the rebrand, so
        // the word is gone with the colour rather than left to vouch for a value
        // nobody signed off. Owner ruling 2026-09-09.
        //
        // The three stops are brand.700 → brand.600 → brand.900, which is what the
        // rebrand spec §6 gives the LOGIN PANEL (#43168B is listed there as "login
        // panel background only"). ⚠ The login page does not use them YET — the §6
        // rebuild has not run and app/login/page.tsx is still a #f9fafb page with a
        // brand-600 tile. The splash gets there first on purpose; when login is
        // rebuilt the two will match rather than needing a third decision.
        background: "linear-gradient(180deg, #6D28D9 0%, #7C3AED 50%, #43168B 100%)",
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
        {/* The wordmark, white on the violet gradient. No tile: the whole splash
            screen already IS the tile the user tapped to get here. */}
        <OrbitWordmark height={44} className="text-white" />
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
