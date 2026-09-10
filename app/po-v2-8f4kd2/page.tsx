import { redirect } from "next/navigation";

// ── THE OLD ADDRESS, KEPT ALIVE AS A REDIRECT ──────────────────────────────
//
// v2 lived at /po-v2-8f4kd2 while it was a hidden test address. It is live at
// /po2 now, and this exists so that nobody who typed, bookmarked or INSTALLED
// the old one is dropped. A salesman with the old shortcut on his home screen
// keeps working through the switchover instead of getting a 404 on a phone in
// a shop, which is the one place nobody can debug it for him.
//
// ⚠ THIS IS DELIBERATELY UNLIKE /order. That address was RETIRED in July 2026
// and PARKED with NO redirect (archive/2026-07-order/, and the note in
// middleware.ts's PUBLIC_PATHS), because it had no successor to point at and
// a redirect would have implied one. /po-v2-8f4kd2 has a successor, so it
// gets a redirect. The two are not inconsistent; they are the same rule
// applied to opposite facts.
//
// ⚠ THE INSTALLED PWA IS NOT RESCUED BY THIS, only the address is. /po2's
// manifest `id` is "/po2", so it is a DIFFERENT app to a browser: an old
// shortcut redirects into the new page but stays a separate installed icon.
// That is why the rollout instruction is to delete the old app first.
//
// ⚠ REMOVE THIS once the team has moved. Parked on ROADMAP.md under
// `/po2` as a P3, so it does not sit here forever being the reason nobody
// notices the old address is still in circulation.
//
// A SERVER redirect, permanent: nothing here renders, so there is no client
// bundle, no flash of an empty page and no second navigation.
export const dynamic = "force-dynamic";

export default function Page(): never {
  redirect("/po2");
}
