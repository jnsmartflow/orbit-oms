import { prisma } from "@/lib/prisma";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = 'force-dynamic';

export default async function DeliveryTypesPage() {
  const types = await prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-bold" style={{ color: 'var(--navy)' }}>Delivery Types</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
          Read-only. Seeded at setup — Local and Upcountry.
        </p>
      </div>
      <div className="oa-table max-w-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-gray-400">{t.id}</TableCell>
                <TableCell className="font-medium">{t.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
