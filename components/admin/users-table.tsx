"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddUserSheet } from "./add-user-sheet";
import { ResetPasswordDialog } from "./reset-password-dialog";

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

interface UsersTableProps {
  initialUsers: UserRow[];
  roles: Role[];
  currentUserId: number;
}

export function UsersTable({ initialUsers, roles, currentUserId }: UsersTableProps) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: number; name: string } | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  function handleCreated(user: UserRow) {
    setUsers((prev) => [...prev, user]);
  }

  async function handleToggleActive(user: UserRow) {
    if (user.id === currentUserId) {
      toast.error("You cannot deactivate your own account.");
      return;
    }
    setTogglingId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to update user.");
        return;
      }
      const updated: UserRow = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success(`${updated.name} ${updated.isActive ? "activated" : "deactivated"}.`);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Users</h1>
        <Button size="sm" onClick={() => setSheetOpen(true)}>
          + Add User
        </Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                  No users found.
                </TableCell>
              </TableRow>
            )}
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="text-slate-600">{user.email}</TableCell>
                <TableCell>
                  <span className="capitalize text-sm">{user.role.name}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={user.isActive ? "default" : "secondary"}>
                    {user.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-500 text-sm">
                  {new Date(user.createdAt).toLocaleDateString("en-IN", {
                    day: "2-digit", month: "short", year: "numeric",
                  })}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={togglingId === user.id || user.id === currentUserId}
                      onClick={() => handleToggleActive(user)}
                    >
                      {user.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setResetTarget({ id: user.id, name: user.name })}
                    >
                      Reset Password
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddUserSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        roles={roles}
        onCreated={handleCreated}
      />

      <ResetPasswordDialog
        open={!!resetTarget}
        onOpenChange={(o) => { if (!o) setResetTarget(null); }}
        userId={resetTarget?.id ?? null}
        userName={resetTarget?.name ?? ""}
      />
    </>
  );
}
