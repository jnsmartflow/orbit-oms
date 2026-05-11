import { PrismaClient } from "@prisma/client";

const p = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  log: ["error"],
});

async function main(): Promise<void> {
  const total = await p.mo_order_form_index.count();
  console.log(`1. Total row count: ${total}`);

  const byFamily = await p.mo_order_form_index.groupBy({
    by:     ["family"],
    _count: true,
    orderBy: { family: "asc" },
  });
  console.log(`2. Family breakdown (${byFamily.length} families):`);
  for (const g of byFamily) {
    console.log(`     ${g.family}: ${g._count}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { void p.$disconnect(); });
