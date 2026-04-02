"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Tabs } from "@base-ui/react/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ActionKey } from "@/lib/permissions";

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLES_CONFIG = [
  { slug: "admin",            label: "Admin",          color: "#4338ca" },
  { slug: "dispatcher",       label: "Dispatcher",     color: "#dc2626" },
  { slug: "support",          label: "Support",        color: "#7c3aed" },
  { slug: "tint_manager",     label: "Tint Mgr",       color: "#d97706" },
  { slug: "tint_operator",    label: "Tint Op",        color: "#c2410c" },
  { slug: "floor_supervisor", label: "Floor Sup",      color: "#16a34a" },
  { slug: "picker",           label: "Picker",         color: "#0f766e" },
] as const;

const SECTIONS = ["Admin Panel", "Master Data", "Operations"] as const;

const PAGES_CONFIG = [
  // Admin Panel
  { key: "dashboard",     label: "Dashboard",      path: "/admin",               section: "Admin Panel" },
  { key: "users",         label: "Users",          path: "/admin/users",         section: "Admin Panel" },
  { key: "system_config", label: "System Config",  path: "/admin/system-config", section: "Admin Panel" },
  { key: "permissions",   label: "Permissions",    path: "/admin/permissions",   section: "Admin Panel" },
  // Master Data
  { key: "customers",     label: "Customers",      path: "/admin/customers",     section: "Master Data" },
  { key: "skus",          label: "SKUs",           path: "/admin/skus",          section: "Master Data" },
  { key: "routes_areas",  label: "Routes & Areas", path: "/admin/routes",        section: "Master Data" },
  { key: "vehicles",      label: "Vehicles",       path: "/admin/vehicles",      section: "Master Data" },
  // Operations
  { key: "import_obd",    label: "Import OBD",     path: "/import",              section: "Operations" },
  { key: "support_queue", label: "Support Queue",  path: "/support",             section: "Operations" },
  { key: "tint_manager",  label: "Tint Manager",   path: "/tint/manager",        section: "Operations" },
  { key: "tint_operator", label: "Tint Operator",  path: "/tint/operator",       section: "Operations" },
  { key: "dispatcher",    label: "Dispatcher",     path: "/dispatcher",          section: "Operations" },
  { key: "warehouse",     label: "Warehouse",      path: "/warehouse",           section: "Operations" },
] as const;

const ACTIONS: { key: ActionKey; label: string; short: string }[] = [
  { key: "canView",   label: "View",   short: "V" },
  { key: "canImport", label: "Import", short: "I" },
  { key: "canExport", label: "Export", short: "X" },
  { key: "canEdit",   label: "Edit",   short: "E" },
  { key: "canDelete", label: "Delete", short: "D" },
];

const NA_IMPORT = new Set([
  "dashboard", "system_config", "permissions",
  "tint_manager", "tint_operator", "dispatcher", "warehouse",
]);

const NA_DELETE = new Set([
  "dashboard", "tint_operator", "dispatcher", "warehouse",
]);

function isNA(pageKey: string, action: ActionKey): boolean {
  if (action === "canImport") return NA_IMPORT.has(pageKey);
  if (action === "canDelete") return NA_DELETE.has(pageKey);
  return false;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type PermValues = {
  canView:   boolean;
  canImport: boolean;
  canExport: boolean;
  canEdit:   boolean;
  canDelete: boolean;
};

type PermRow = {
  id:       number;
  roleSlug: string;
  pageKey:  string;
} & PermValues;

type PermState = Record<string, PermValues>;

const ALL_FALSE: PermValues = {
  canView: false, canImport: false, canExport: false, canEdit: false, canDelete: false,
};
const ALL_TRUE: PermValues = {
  canView: true,  canImport: true,  canExport: true,  canEdit: true,  canDelete: true,
};

function makeKey(roleSlug: string, pageKey: string): string {
  return `${roleSlug}::${pageKey}`;
}

function initState(initialPerms: PermRow[]): PermState {
  const state: PermState = {};
  for (const role of ROLES_CONFIG) {
    for (const page of PAGES_CONFIG) {
      state[makeKey(role.slug, page.key)] =
        role.slug === "admin" ? { ...ALL_TRUE } : { ...ALL_FALSE };
    }
  }
  for (const perm of initialPerms) {
    if (perm.roleSlug === "admin") continue;
    const key = makeKey(perm.roleSlug, perm.pageKey);
    if (key in state) {
      state[key] = {
        canView:   perm.canView,
        canImport: perm.canImport,
        canExport: perm.canExport,
        canEdit:   perm.canEdit,
        canDelete: perm.canDelete,
      };
    }
  }
  return state;
}

// ── By Role Tab ────────────────────────────────────────────────────────────────

interface MatrixProps {
  getPerms: (roleSlug: string, pageKey: string) => PermValues;
  toggle:   (roleSlug: string, pageKey: string, action: ActionKey) => void;
}

interface ByRoleProps extends MatrixProps {
  selectedRole:    string;
  setSelectedRole: (slug: string) => void;
  getViewCount:    (roleSlug: string) => number;
}

function ByRoleTab({
  getPerms,
  toggle,
  selectedRole,
  setSelectedRole,
  getViewCount,
}: ByRoleProps) {
  const roleConfig =
    ROLES_CONFIG.find((r) => r.slug === selectedRole) ?? ROLES_CONFIG[0];

  return (
    <div className="flex gap-4" style={{ minHeight: "520px" }}>
      {/* Role list */}
      <div className="w-52 shrink-0 border border-gray-200 rounded-lg overflow-hidden self-start">
        {ROLES_CONFIG.map((role) => {
          const count      = getViewCount(role.slug);
          const isSelected = role.slug === selectedRole;
          return (
            <button
              key={role.slug}
              type="button"
              onClick={() => setSelectedRole(role.slug)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-gray-100 last:border-b-0",
                isSelected
                  ? "bg-teal-50 text-teal-700 font-semibold"
                  : "hover:bg-gray-50 text-gray-600"
              )}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: role.color }}
              />
              <span className="flex-1 text-[13px]">{role.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                {count}
              </Badge>
            </button>
          );
        })}
      </div>

      {/* Permission grid for selected role */}
      <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden">
        {/* Role header */}
        <div
          className="flex items-center gap-2 px-4 py-3 border-b border-gray-200"
          style={{ background: `${roleConfig.color}15` }}
        >
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: roleConfig.color }}
          />
          <span
            className="font-semibold text-sm"
            style={{ color: roleConfig.color }}
          >
            {roleConfig.label}
          </span>
          <span className="text-xs text-gray-500 ml-1">permissions</span>
        </div>

        {/* Column labels */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
          <span className="w-52 shrink-0 text-[11px] font-medium text-gray-500">
            Page
          </span>
          {ACTIONS.map((a) => (
            <span
              key={a.key}
              className="w-14 text-center text-[11px] font-medium text-gray-500"
            >
              {a.label}
            </span>
          ))}
        </div>

        {/* Sections + pages */}
        {SECTIONS.map((section) => {
          const pages   = PAGES_CONFIG.filter((p) => p.section === section);
          const isAdmin = selectedRole === "admin";
          return (
            <div key={section}>
              <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-gray-50/70 border-b border-gray-100">
                {section}
              </div>
              {pages.map((page) => (
                <div
                  key={page.key}
                  className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50"
                >
                  <div className="w-52 shrink-0">
                    <div className="text-[13px] font-medium text-gray-700">
                      {page.label}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">
                      {page.path}
                    </div>
                  </div>
                  {ACTIONS.map((action) => {
                    const na    = isNA(page.key, action.key);
                    const value = getPerms(selectedRole, page.key)[action.key];
                    return (
                      <div key={action.key} className="w-14 flex justify-center">
                        {na ? (
                          <span className="text-gray-300 text-xs">—</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isAdmin}
                            onClick={() =>
                              toggle(selectedRole, page.key, action.key)
                            }
                            className={cn(
                              "h-6 px-2 text-xs w-12 transition-colors",
                              value && !isAdmin
                                ? "bg-teal-600 text-white border-teal-600 hover:bg-teal-700"
                                : isAdmin && value
                                ? "bg-gray-100 text-gray-500 border-gray-200"
                                : ""
                            )}
                          >
                            {action.label}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── By Page Tab ────────────────────────────────────────────────────────────────

function ByPageTab({ getPerms, toggle }: MatrixProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {PAGES_CONFIG.map((page) => (
        <div
          key={page.key}
          className="border border-gray-200 rounded-lg overflow-hidden"
        >
          {/* Card header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-gray-700">
                {page.label}
              </div>
              <div className="text-[10px] font-mono text-gray-400 mt-0.5">
                {page.path}
              </div>
            </div>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
              {page.section}
            </Badge>
          </div>

          {/* Role rows */}
          {ROLES_CONFIG.map((role) => {
            const isAdmin = role.slug === "admin";
            return (
              <div
                key={role.slug}
                className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: role.color }}
                />
                <span className="text-[12px] font-medium text-gray-600 w-20 shrink-0">
                  {role.label}
                </span>
                <div className="flex gap-1 flex-wrap">
                  {ACTIONS.map((action) => {
                    const na    = isNA(page.key, action.key);
                    const value = getPerms(role.slug, page.key)[action.key];
                    if (na) {
                      return (
                        <span
                          key={action.key}
                          className="inline-flex items-center justify-center text-gray-300 text-[10px] w-9"
                        >
                          —
                        </span>
                      );
                    }
                    return (
                      <Button
                        key={action.key}
                        size="xs"
                        variant="outline"
                        disabled={isAdmin}
                        onClick={() => toggle(role.slug, page.key, action.key)}
                        className={cn(
                          "h-5 px-1.5 text-[10px] w-9 transition-colors",
                          value && !isAdmin
                            ? "bg-teal-600 text-white border-teal-600 hover:bg-teal-700"
                            : isAdmin && value
                            ? "bg-gray-100 text-gray-500 border-gray-200"
                            : ""
                        )}
                      >
                        {action.short}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  initialPerms: PermRow[];
}

export function PermissionsManager({ initialPerms }: Props) {
  const [state, setState]           = useState<PermState>(() => initState(initialPerms));
  const [isDirty, setIsDirty]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>(ROLES_CONFIG[0].slug);

  function getPerms(roleSlug: string, pageKey: string): PermValues {
    return state[makeKey(roleSlug, pageKey)] ?? { ...ALL_FALSE };
  }

  function toggle(roleSlug: string, pageKey: string, action: ActionKey) {
    if (roleSlug === "admin" || isNA(pageKey, action)) return;
    setState((prev) => {
      const key     = makeKey(roleSlug, pageKey);
      const current = prev[key] ?? { ...ALL_FALSE };
      return { ...prev, [key]: { ...current, [action]: !current[action] } };
    });
    setIsDirty(true);
  }

  function getViewCount(roleSlug: string): number {
    return PAGES_CONFIG.filter((p) => getPerms(roleSlug, p.key).canView).length;
  }

  async function handleSave() {
    const updates = ROLES_CONFIG.filter((r) => r.slug !== "admin").flatMap((r) =>
      PAGES_CONFIG.map((p) => ({
        roleSlug: r.slug,
        pageKey:  p.key,
        ...getPerms(r.slug, p.key),
      }))
    );

    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        toast.error(data.error ?? "Failed to save permissions.");
        return;
      }
      toast.success("Permissions saved.");
      setIsDirty(false);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-teal-700">Permissions</h1>
        <Button
          size="sm"
          className="oa-btn-primary"
          disabled={!isDirty || saving}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs.Root defaultValue="by-role">
        <Tabs.List className="flex border-b border-gray-200 mb-5">
          {(
            [
              { value: "by-role", label: "By Role" },
              { value: "by-page", label: "By Page" },
            ] as const
          ).map((tab) => (
            <Tabs.Tab
              key={tab.value}
              value={tab.value}
              className="px-4 py-2.5 text-[13px] font-medium text-gray-500 border-b-2 border-transparent -mb-px transition-colors hover:text-gray-800 outline-none data-[active]:border-teal-600 data-[active]:text-teal-700 data-[active]:font-semibold"
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="by-role">
          <ByRoleTab
            getPerms={getPerms}
            toggle={toggle}
            selectedRole={selectedRole}
            setSelectedRole={setSelectedRole}
            getViewCount={getViewCount}
          />
        </Tabs.Panel>

        <Tabs.Panel value="by-page">
          <ByPageTab getPerms={getPerms} toggle={toggle} />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}
