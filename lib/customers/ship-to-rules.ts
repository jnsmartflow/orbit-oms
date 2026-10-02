// lib/customers/ship-to-rules.ts — the Tint Manager "Add ship-to" form's rules
// (2026-10-02). PURE: the form (components/tint/manager/add-ship-to-sheet.tsx)
// and POST /api/tint/manager/ship-to/create both import it, so the button and
// the server refuse exactly the same things. The admin Customers form does NOT
// use these — its rules are unchanged.
//
// Every field is mandatory:
//   - site address: trimmed, at least 10 characters;
//   - area: picked;
//   - sales person: picked, AND has a phone in sales_officer_master;
//   - receivers: at least one row with BOTH a name (trimmed, 2+ characters) and
//     a 10-digit Indian mobile (6–9 first digit, after removing spaces, dashes
//     and a leading +91 / 91 / 0). A partly filled extra row needs both fields;
//     a fully empty extra row is ignored.

export const MIN_ADDRESS = 10;
export const MIN_RECEIVER_NAME = 2;
export const PHONE_HINT = "Enter a 10-digit mobile number";
export const SO_NO_PHONE = "No phone in master for this sales officer — ask admin to add it";

/** "+91 98250-11223" → "9825011223"; null when it is not a valid mobile. */
export function normalizeMobile(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/[\s\-()]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export interface ReceiverInput { name: string; phone: string }

export interface ReceiverCheck {
  /** Rows to save (both fields valid), phone normalised. */
  rows:   Array<{ name: string; phone: string }>;
  /** Per input row: which field is wrong (for the red hints). */
  errors: Array<{ name: boolean; phone: boolean }>;
  /** First problem, as a footer sentence; null when fine. */
  message: string | null;
}

export function checkReceivers(input: ReceiverInput[]): ReceiverCheck {
  const rows: ReceiverCheck["rows"] = [];
  const errors: ReceiverCheck["errors"] = [];
  let message: string | null = null;
  input.forEach((r, i) => {
    const name = r.name.trim();
    const phoneRaw = r.phone.trim();
    const empty = name === "" && phoneRaw === "";
    // The FIRST row is always required; an extra row only when partly filled.
    if (empty && i > 0) { errors.push({ name: false, phone: false }); return; }
    const nameBad = name.length < MIN_RECEIVER_NAME;
    const phone = normalizeMobile(phoneRaw);
    const phoneBad = phone === null;
    errors.push({ name: nameBad, phone: phoneBad });
    if (!nameBad && !phoneBad) rows.push({ name, phone: phone as string });
    else if (message === null) {
      message = nameBad
        ? (i === 0 ? "Add the receiver's name to save." : "Add a name for every receiver row (or clear it).")
        : (i === 0 ? "Add the receiver's 10-digit mobile to save." : "Add a 10-digit mobile for every receiver row (or clear it).");
    }
  });
  if (rows.length === 0 && message === null) message = "Add a receiver with name and mobile to save.";
  return { rows, errors, message };
}

export interface ShipToFormInput {
  name:          string;
  address:       string;
  hasArea:       boolean;
  hasSo:         boolean;
  soPhone:       string | null | undefined;
  receivers:     ReceiverInput[];
}

/** The first missing / wrong thing, as the footer sentence — null when savable. */
export function firstShipToProblem(f: ShipToFormInput): string | null {
  if (f.name.trim() === "") return "Add the ship-to name to save.";
  if (f.address.trim().length < MIN_ADDRESS) return f.address.trim() === "" ? "Add site address to save." : `Site address needs at least ${MIN_ADDRESS} characters.`;
  if (!f.hasArea) return "Pick an area to save.";
  if (!f.hasSo) return "Pick a sales person to save.";
  if (!f.soPhone || f.soPhone.trim() === "") return "This sales officer has no phone in master — pick another or ask admin.";
  return checkReceivers(f.receivers).message;
}
