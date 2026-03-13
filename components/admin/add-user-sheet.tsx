"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Role {
  id: number;
  name: string;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  role: Role;
}

interface AddUserSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  onCreated: (user: UserRow) => void;
}

const EMPTY = { name: "", email: "", password: "", confirmPassword: "", roleId: "" };

export function AddUserSheet({ open, onOpenChange, roles, onCreated }: AddUserSheetProps) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Default to first non-admin role
  const defaultRoleId = (roles.find((r) => r.name !== "admin") ?? roles[0])?.id.toString() ?? "";

  function set(key: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    if (!form.email.trim()) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email.";
    if (!form.password) errs.password = "Password is required.";
    else if (form.password.length < 8) errs.password = "Minimum 8 characters.";
    if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match.";
    if (!form.roleId) errs.roleId = "Role is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          roleId: parseInt(form.roleId, 10),
          password: form.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ email: "Email already in use." });
        } else {
          toast.error("Failed to create user.");
        }
        return;
      }
      toast.success(`User ${data.name} created.`);
      onCreated(data);
      setForm(EMPTY);
      onOpenChange(false);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const effectiveRoleId = form.roleId || defaultRoleId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add User</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Name</Label>
            <Input id="u-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">Role</Label>
            <Select value={effectiveRoleId} onValueChange={(v) => set("roleId", v ?? "")}>
              <SelectTrigger id="u-role">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id.toString()}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.roleId && <p className="text-xs text-destructive">{fieldErrors.roleId}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-password">Password</Label>
            <Input id="u-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
            {fieldErrors.password && <p className="text-xs text-destructive">{fieldErrors.password}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-confirm">Confirm Password</Label>
            <Input id="u-confirm" type="password" value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} />
            {fieldErrors.confirmPassword && <p className="text-xs text-destructive">{fieldErrors.confirmPassword}</p>}
          </div>
          <SheetFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create User"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
