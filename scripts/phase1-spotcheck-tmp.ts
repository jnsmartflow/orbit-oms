import { PrismaClient } from "@prisma/client";

const p = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  log: ["error"],
});

async function main(): Promise<void> {
  // 1. Total active rows
  const activeCount = await p.mo_order_form_index.count({ where: { isActive: true } });
  console.log(`1. activeCount = ${activeCount}`);

  // 2. LUXURIO family
  const luxurio = await p.mo_order_form_index.findMany({
    where:   { family: "LUXURIO" },
    orderBy: { sortOrder: "asc" },
    select:  { subProduct: true, baseColour: true, displayName: true, productType: true },
  });
  console.log(`2. LUXURIO row count = ${luxurio.length}`);
  for (const r of luxurio) {
    console.log(`     ${r.subProduct} | ${r.baseColour ?? "<null>"} | ${r.productType} | ${r.displayName}`);
  }

  // 3. PROMISE umbrella cross-list
  const promiseUmbrella = await p.mo_order_form_index.count({ where: { family: "PROMISE" } });
  console.log(`3. PROMISE umbrella count = ${promiseUmbrella}`);

  // 4. STAINER tinterTypes
  const stainerByTinterType = await p.mo_order_form_index.groupBy({
    by:     ["tinterType"],
    where:  { family: "STAINER" },
    _count: true,
  });
  console.log(`4. STAINER tinterTypes (${stainerByTinterType.length} distinct):`);
  for (const g of stainerByTinterType) {
    console.log(`     ${g.tinterType ?? "<null>"} : ${g._count} rows`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { void p.$disconnect(); });
