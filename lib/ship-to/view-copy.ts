// lib/ship-to/view-copy.ts
//
// CLIENT ONLY. Open one dealer / SO challan copy in a new tab: GET
// /api/ship-to/copy/[id] mints a 300 s signed URL (never stored), then the tab
// goes there. Shared by the ship-to modal and the 📎 pin, so both open a copy
// the same way.
//
// ⚠ THE TAB IS OPENED BEFORE THE AWAIT. A window.open after a fetch is no
// longer "in" the click, and popup blockers stop it.
//
// A caller that must await something ELSE first (the 📎 pin reads the list to
// learn the id) opens the tab itself inside the click and passes it in.
//
// Returns null when the copy opened, or the message to show.

export async function openShipToCopy(copyId: number, preOpened?: Window | null): Promise<string | null> {
  const w = preOpened !== undefined ? preOpened : window.open("", "_blank");
  try {
    const res = await fetch(`/api/ship-to/copy/${copyId}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { signedUrl?: string; error?: string } | null;
    if (!res.ok || !body?.signedUrl) throw new Error(body?.error ?? "Could not open the copy");
    if (w) w.location.href = body.signedUrl;
    else window.open(body.signedUrl, "_blank");
    return null;
  } catch (e) {
    w?.close();
    return e instanceof Error ? e.message : "Could not open the copy";
  }
}
