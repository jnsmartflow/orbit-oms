  import { PrismaClient } from "@prisma/client";
  import bcrypt from "bcryptjs";

  const prisma = new PrismaClient();

  async function main() {
    const email = "admin@orbitoms.com";
    const plainPassword = "Admin@123";

    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) {
      console.error(`❌ User ${email} not found.`);
      process.exit(1);
    }

    const hash = await bcrypt.hash(plainPassword, 10);
    await prisma.users.update({ where: { email }, data: { password: hash } });

    console.log(`✅ Password updated for ${email}`);
  }

  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
