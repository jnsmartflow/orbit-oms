import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { isSoPageOpen } from "@/lib/so-auth/lock";
import { getSoSession } from "@/lib/so-auth/session";
import SoBoard from "./_board/po-v2-page";
import { SoLabLogin } from "./so-lab-login";

export const dynamic = "force-dynamic";

// /so-lab (C.2a, 2026-10-01): ONE URL, and the SERVER decides what it shows.
//   staff lock (repeated here because a layout and its page render in
//   parallel — the page must not read a session the layout is about to refuse)
//   → getSoSession() → no session: the OTP login screen
//                    → session:    the /po2 board fork, as that SO.
// Login success and Log out both end in window.location.reload(), so the
// client never guesses who is logged in.
export default async function SoLabPage() {
  if (!(await isSoPageOpen())) {
    const session = await auth();
    requireSuperuser(session);
  }

  const so = await getSoSession();
  if (!so) return <SoLabLogin />;

  return <SoBoard so={{ id: so.salesOfficerId, name: so.name, email: so.email }} />;
}
