// scripts/check-so-resolver.ts — READ-ONLY smoke test for lib/sales-officer/resolve.ts.
//
//   npx tsx --tsconfig tsconfig.json scripts/check-so-resolver.ts
//
// 1. Every sales_officer_aliases."rawExample" resolves to its own row's
//    salesOfficerId (the live so_alias_key does the keying — this proves the
//    resolver's join, not a TS copy of the key).
// 2. Names that must NOT resolve: the three depot mailboxes (shown as
//    "Telecaller" by the caller), empty, digits only, and a name skipped on
//    purpose in the prefill.
// SELECTs only. Exit code 1 on any FAIL.

import { prisma } from "@/lib/prisma";
import { resolveSoNames } from "@/lib/sales-officer/resolve";

const MUST_NOT_MATCH = ["Surat Akzonobel", "Surat Depot", "Surat Order", "", "12345", "Dhanraj Shah"];

async function main() {
  const aliases = await prisma.salesOfficerAlias.findMany({
    where: { rawExample: { not: null } },
    select: { rawExample: true, salesOfficerId: true },
    orderBy: { id: "asc" },
  });

  const resolved = await resolveSoNames(aliases.map((a) => a.rawExample as string));
  let pass = 0;
  const fails: string[] = [];
  for (const a of aliases) {
    const raw = a.rawExample as string;
    const got = resolved.get(raw);
    if (got && got.salesOfficerId === a.salesOfficerId) pass += 1;
    else fails.push(`  FAIL ${JSON.stringify(raw)} → expected #${a.salesOfficerId}, got ${got ? `#${got.salesOfficerId}` : "no match"}`);
  }
  console.log(`aliases: ${pass}/${aliases.length} PASS`);

  const none = await resolveSoNames(MUST_NOT_MATCH);
  let nonePass = 0;
  for (const raw of MUST_NOT_MATCH) {
    const got = none.get(raw);
    if (!got) nonePass += 1;
    else fails.push(`  FAIL ${JSON.stringify(raw)} → expected no match, got #${got.salesOfficerId} ${got.name}`);
  }
  console.log(`no-match: ${nonePass}/${MUST_NOT_MATCH.length} PASS`);

  const empty = await resolveSoNames([]);
  console.log(`empty input → ${empty.size === 0 ? "empty Map PASS" : "FAIL"}`);
  if (empty.size !== 0) fails.push("  FAIL empty input returned entries");

  // A sample of what a screen would show.
  const sample = Array.from(resolved.entries()).slice(0, 5).map(([raw, r]) => `${raw} → ${r.displayName}${r.phone ? ` (${r.phone})` : ""}`);
  console.log(`sample: ${sample.join(" · ")}`);

  if (fails.length > 0) {
    console.log(fails.join("\n"));
    console.log(`RESULT: FAIL (${fails.length})`);
    process.exitCode = 1;
  } else {
    console.log("RESULT: PASS");
  }
}

main().finally(() => prisma.$disconnect());
