"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Role { id: number; name: string; }

export interface UserRowForEdit {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  role: Role;
}

interface EditUserSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRowForEdit | null;
  roles: Role[];
  onUpdated: (user: UserRowForEdit) => void;
}

export function EditUserSheet({ open, onOpenChange, user, roles, onUpdated }: EditUserSheetProps) {
  const [form, setForm] = useState({ name: "", email: "", roleId: "", password: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && user) {
      setForm({
        name: user.name,
        email: user.email,
        roleId: user.role.id.toString(),
        password: "",
        confirmPassword: "",
      });
      setFieldErrors({});
    }
  }, [open, user]);

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    if (!form.email.trim()) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email.";
    if (!form.roleId) errs.roleId = "Role is required.";
    if (form.password) {
      if (form.password.length < 8) errs.password = "Minimum 8 characters.";
      if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match.";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !validate()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        roleId: parseInt(form.roleId, 10),
      };
      if (form.password) body.password = form.password;

      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ email: "Email already in use." });
        } else {
          toast.error(data.error ?? "Failed to update user.");
        }
        return;
      }
      toast.success(`${data.name} updated.`);
      onUpdated(data);
      onOpenChange(false);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit User</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="oa-sheet-form flex flex-col gap-5 px-6 pb-0">
          <div className="space-y-1.5">
            <Label htmlFor="eu-name">Name</Label>
            <Input id="eu-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-email">Email</Label>
            <Input id="eu-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-role">Role</Label>
            <Select value={form.roleId} onValueChange={(v) => set("roleId", v ?? "")}>
              <SelectTrigger id="eu-role">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.roleId && <p className="text-xs text-destructive">{fieldErrors.roleId}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-password">New Password <span className="text-gray-400 text-xs font-normal">(leave blank to keep current)</span></Label>
            <Input id="eu-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
            {fieldErrors.password && <p className="text-xs text-destructive">{fieldErrors.password}</p>}
          </div>
          {form.password && (
            <div className="space-y-1.5">
              <Label htmlFor="eu-confirm">Confirm New Password</Label>
              <Input id="eu-confirm" type="password" value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} />
              {fieldErrors.confirmPassword && (
                <p className="text-xs text-destructive">{fieldErrors.confirmPassword}</p>
              )}
            </div>
          )}
          <div className="sticky bottom-0 bg-white border-t border-[#e5e7eb] -mx-6 px-6 py-4 flex gap-3 mt-6">
            <Button type="button" variant="outline" className="flex-1 h-10 text-sm border-[#e5e7eb] text-gray-700 hover:bg-gray-50 rounded-lg oa-btn-ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" className="flex-1 h-10 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold oa-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
