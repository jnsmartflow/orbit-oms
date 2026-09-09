import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROLE_REDIRECTS } from "@/lib/rbac";
import { LoginForm } from "./login-form";
import { LoginRings } from "./login-rings";
import { OrbitWordmark } from "@/components/shared/orbit-wordmark";

export const dynamic = 'force-dynamic';

// The corner light is a CSS gradient ON THE PANEL, never inside the rings SVG —
// an SVG gradient is bounded by its viewBox and gets sliced, which is what made
// a visible hard edge across the panel the first time this was tried.
const PANEL_LIGHT =
  "radial-gradient(82% 100% at 100% 100%, " +
  "rgba(154,124,246,0.55) 0%, " +
  "rgba(124,58,237,0.30) 34%, " +
  "rgba(88,28,135,0.12) 62%, " +
  "rgba(67,22,139,0) 84%)";

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
        style={{ backgroundColor: "#43168B", backgroundImage: PANEL_LIGHT }}
      >
        <LoginRings />

        <div className="relative z-[3]">
          {/* 45px is INK height, not a font size. The wordmark's viewBox is cut
              tight to the letters (769 units of a 1000-unit em), so a height of
              H reads as roughly H ÷ 0.769 of type — 45 here lands on the ~58px
              the mockup sets and the 60px of rebrand draft §6. The first cut
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
