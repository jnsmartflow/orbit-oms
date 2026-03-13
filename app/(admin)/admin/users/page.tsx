import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { UsersTable } from "@/components/admin/users-table";

export default async function UsersPage() {
  const session = await auth();

  const [users, roles] = await Promise.all([
    prisma.users.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.role_master.findMany({
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    }),
  ]);

  const currentUserId = parseInt(session!.user.id, 10);

  return (
    <UsersTable
      initialUsers={users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      }))}
      roles={roles}
      currentUserId={currentUserId}
    />
  );
}
