import { prisma } from "@/lib/prisma";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const roles = await prisma.role_master.findMany({ orderBy: { name: "asc" } });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-bold" style={{ color: 'var(--navy)' }}>Roles</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
          Read-only. Seeded at setup — 7 system roles.
        </p>
      </div>
      <div className="oa-table max-w-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-gray-400 text-sm">{r.description ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
