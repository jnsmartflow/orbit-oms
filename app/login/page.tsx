import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROLE_REDIRECTS } from "@/lib/rbac";
import { LoginForm } from "./login-form";
import { OrbitWordmark } from "@/components/shared/orbit-wordmark";

export const dynamic = 'force-dynamic';

// 🔴 THE PANEL CARRIES NO DRAWN ELEMENT, AND THAT IS A DECISION — NOT A GAP TO FILL.
// Eleven variations of a graphic were tried on this panel over one session on
// 2026-09-09: orbit arcs, ellipses, a node network, streaks, a depot scene. Every
// one of them held together at mockup size and fell apart at full-screen size. The
// arcs got furthest and shipped for a day (login-rings.tsx, removed 2026-09-09;
// recoverable from git history). Do not reintroduce a graphic here without new
// evidence that it survives a 1920-wide panel.
//
// What carries the panel instead is the brand ramp, plus a grain layer.
//
// 🔴 THE PANEL AND THE APP ICON DELIBERATELY USE DIFFERENT RAMPS. Do not
// "reconcile" them back to one set of numbers — that is a fix somebody will
// reach for and it is wrong. The icon is SQUARE, so its light falls off over a
// short distance; the panel is WIDE, and the same stops stretched across it put
// the light stop over a third of the surface and washed the corner out. Same
// intent, different geometry, so different numbers: the panel's light is two
// steps darker (#7A55E8), its ending shape is 105% rather than 125% so the light
// stays in its corner, and brand.600 arrives at 30% rather than 34% so the brand
// colour holds more of the surface. Both sets are tabulated in CLAUDE_UI.md §12.1.
const PANEL_GRADIENT =
  "radial-gradient(105% 105% at 10% 2%, " +
  "#7A55E8 0%, #7846E2 14%, #7C3AED 30%, #6428C4 66%, #4C1D95 100%)";

// 🔴 The grain is the only reason the panel does not read as a flat CSS gradient.
// Keep it. Tiled 140px fractal noise at .12 — enough to break the banding, not
// enough to be seen as texture.
const PANEL_GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Greeting and date are computed on the server in IST — everyone who signs in is
 *  at the Surat depot, and a server value renders identically on both sides, so
 *  there is no hydration mismatch and no one-frame flash of an empty heading. */
function istGreeting() {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(now);
  return { greeting, date };
}

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.role) {
    redirect(ROLE_REDIRECTS[session.user.role] ?? "/unauthorized");
  }

  const { greeting, date } = istGreeting();

  return (
    <main className="flex min-h-screen flex-col md:flex-row">
      {/* Brand panel — a band across the top on a phone, the left side from md up. */}
      <section
        className="relative isolate flex min-h-[236px] flex-[1.15] flex-col justify-center overflow-hidden px-7 py-12 sm:px-10 md:min-h-screen md:px-[58px] md:py-14"
        style={{ backgroundImage: PANEL_GRADIENT }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ backgroundImage: PANEL_GRAIN, opacity: 0.12 }}
        />

        <div className="relative z-[3]">
          {/* 45px is INK height, not a font size. The wordmark's viewBox is cut
              tight to the letters (769 units of a 1000-unit em), so a height of
              H reads as roughly H ÷ 0.769 of type — 45 here lands on the ~58px
              the mockup sets and the 60px of rebrand draft §6. An earlier cut
              passed 66, which optically was ~86px type and a third too big. */}
          <OrbitWordmark
            height={45}
            className="orbit-rise h-[30px] w-auto text-white sm:h-[38px] md:h-[45px]"
          />
          <span className="orbit-accent orbit-draw mt-5 block rounded-sm bg-brand-400 md:mt-[26px]" />
          <p
            className="orbit-rise mt-4 whitespace-nowrap text-[15px] font-semibold leading-tight tracking-[-0.018em] text-brand-200 sm:text-[18px] md:text-[24px]"
            style={{ animationDelay: "0.18s" }}
          >
            Taking efficiency into new <span className="text-white">orbit</span>
          </p>
        </div>
      </section>

      {/* Form side. */}
      <section className="flex flex-1 items-center justify-center bg-white px-6 py-12 sm:px-10">
        <div className="w-full max-w-[330px]">
          <LoginForm greeting={greeting} dateLabel={date} />
        </div>
      </section>
    </main>
  );
}
