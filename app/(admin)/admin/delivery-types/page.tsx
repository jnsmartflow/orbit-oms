import { prisma } from "@/lib/prisma";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = 'force-dynamic';

export default async function DeliveryTypesPage() {
  const types = await prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Delivery Types</h1>
        <p className="text-sm text-slate-500 mt-1">Read-only. Seeded at setup — Local and Upcountry.</p>
      </div>
      <div className="rounded-md border bg-white max-w-sm">
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
                <TableCell className="text-slate-400">{t.id}</TableCell>
                <TableCell className="font-medium">{t.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
