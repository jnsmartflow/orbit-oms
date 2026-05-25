// components/admin/contact-card.tsx
// Phase 3b — unified contact-card visual (per multi-SO mockup).
//
// Renders both manual and auto-linked contacts in the same shell.
// Variant is controlled by the `linkedSO` prop:
//   linkedSO === null → manual:
//      gray avatar, all inputs editable, role dropdown,
//      Primary checkbox interactive, immediate remove
//   linkedSO !== null → auto-linked (synced from sales_officer_master):
//      role-tinted avatar (teal/blue/amber per Primary/Backup/Junior),
//      name + phone read-only (refreshed by Stage D on save),
//      email stays editable, role chip locked to "Sales Officer",
//      Primary checkbox auto-checked for PRIMARY, disabled for others,
//      remove handler typically opens the dismissal confirm modal

"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2, X } from "lucide-react";
import type {
  ContactDraft,
  ContactRoleOption,
  SalesOfficerRole,
} from "@/components/admin/customer-sheet";
import { SO_ROLE_AVATAR_CLASSES, SO_ROLE_LABELS } from "@/components/admin/customer-sheet";

interface LinkedSOInfo {
  name:  string;
  phone: string | null;
  role:  SalesOfficerRole;
}

interface ContactCardProps {
  contact:       ContactDraft;
  contactRoles:  ContactRoleOption[];
  linkedSO:      LinkedSOInfo | null;
  onUpdate:      (field: keyof ContactDraft, value: string | boolean) => void;
  onSetPrimary:  () => void;
  onRemove:      () => void;
  // Controls the ✕ button on AUTO contacts only. Manual contacts always
  // remove immediately. 'modal' (default) = onRemove fires (admin form opens
  // dismissal dialog). 'disabled' = ✕ is non-interactive with a tooltip
  // (missing-customer sheet — auto-contacts are drafts, removed via SO list).
  autoRemoveBehavior?: "modal" | "disabled";
}

function getInitials(name: string): string {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}

export function ContactCard({
  contact,
  contactRoles,
  linkedSO,
  onUpdate,
  onSetPrimary,
  onRemove,
  autoRemoveBehavior = "modal",
}: ContactCardProps) {
  const isAuto = linkedSO !== null;
  const autoRemoveDisabled = isAuto && autoRemoveBehavior === "disabled";

  // Display name: for auto, prefer the SO master name over whatever's
  // currently on the contact row (refresh semantics).
  const displayName  = isAuto ? linkedSO.name             : contact.name;
  const displayPhone = isAuto ? (linkedSO.phone ?? "")    : contact.phone;
  const initials     = getInitials(displayName);
  const role         = linkedSO?.role ?? null;

  const avatarClass = role
    ? SO_ROLE_AVATAR_CLASSES[role]
    : "bg-gray-100 text-gray-700";

  // For auto contacts, the Primary SO's contact is force-checked by backend
  // Stage E on every save. UI shows it checked + disabled to match that
  // invariant; non-Primary auto contacts show unchecked + disabled.
  const isPrimaryCheckboxDisabled = isAuto;
  const isPrimaryCheckboxChecked  = isAuto ? role === "PRIMARY" : contact.isPrimary;

  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-white space-y-2">
      {/* Row 1 — avatar + name + phone + remove */}
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full ${avatarClass} flex items-center justify-center text-[13px] font-bold flex-shrink-0`}>
          {initials}
        </div>
        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
          <input
            type="text"
            className={
              isAuto
                ? "h-[32px] px-2.5 text-[12.5px] border border-gray-200 rounded-md bg-gray-50 text-gray-700 cursor-not-allowed truncate"
                : "h-[32px] px-2.5 text-[12.5px] border border-gray-200 rounded-md bg-white text-gray-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
            }
            value={displayName}
            placeholder="Contact name"
            readOnly={isAuto}
            onChange={isAuto ? undefined : (e) => onUpdate("name", e.target.value)}
          />
          <input
            type="text"
            className={
              isAuto
                ? `h-[32px] px-2.5 text-[12.5px] border border-gray-200 rounded-md bg-gray-50 cursor-not-allowed font-mono ${displayPhone ? "text-gray-700" : "text-gray-400 italic"}`
                : "h-[32px] px-2.5 text-[12.5px] border border-gray-200 rounded-md bg-white text-gray-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 font-mono"
            }
            value={isAuto && !displayPhone ? "—" : displayPhone}
            placeholder="Phone"
            readOnly={isAuto}
            onChange={isAuto ? undefined : (e) => onUpdate("phone", e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={autoRemoveDisabled ? undefined : onRemove}
          disabled={autoRemoveDisabled}
          className={
            autoRemoveDisabled
              ? "w-7 h-7 rounded-md flex items-center justify-center text-gray-200 cursor-not-allowed flex-shrink-0"
              : "w-7 h-7 rounded-md flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
          }
          title={
            autoRemoveDisabled
              ? "Remove via Sales Officers tab"
              : isAuto
                ? "Delete this auto-contact? It won't come back unless you re-add the SO above."
                : "Remove contact"
          }
          aria-label="Remove contact"
        >
          <X size={14} />
        </button>
      </div>

      {/* Row 2 — email + role */}
      <div className="flex items-center gap-2 pl-11">
        <input
          type="email"
          className="flex-1 h-[32px] px-2.5 text-[12.5px] border border-gray-200 rounded-md bg-white text-gray-900 placeholder:text-gray-300 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
          value={contact.email}
          placeholder={isAuto ? "Email (optional — operator can add)" : "Email"}
          onChange={(e) => onUpdate("email", e.target.value)}
        />
        {isAuto ? (
          <span className="text-[11px] font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5 flex-shrink-0">
            Sales Officer
          </span>
        ) : (
          <Select
            value={contact.contactRoleId || "none"}
            onValueChange={(v) => onUpdate("contactRoleId", !v || v === "none" ? "" : v)}
          >
            <SelectTrigger className="h-[32px] w-[150px] text-[12px] border-gray-200 flex-shrink-0">
              <SelectValue placeholder="Role (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No role</SelectItem>
              {contactRoles.map((r) => (
                <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Row 3 — badge (auto only) + primary checkbox */}
      <div className="flex items-center justify-between pl-11">
        {isAuto && role ? (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
            <Link2 size={10} />
            Auto · {SO_ROLE_LABELS[role]} SO
          </span>
        ) : (
          <span />
        )}
        <label
          className={
            isPrimaryCheckboxDisabled
              ? "flex items-center gap-2 text-[12px] text-gray-400 cursor-not-allowed select-none"
              : "flex items-center gap-2 text-[12px] text-gray-700 cursor-pointer select-none"
          }
        >
          <input
            type="checkbox"
            className="accent-teal-600 w-3.5 h-3.5"
            checked={isPrimaryCheckboxChecked}
            disabled={isPrimaryCheckboxDisabled}
            onChange={() => {
              if (isPrimaryCheckboxDisabled) return;
              // Manual + auto-Primary checkbox toggle goes through onSetPrimary,
              // which mirrors the existing single-primary semantics.
              onSetPrimary();
            }}
          />
          Primary contact
        </label>
      </div>
    </div>
  );
}
