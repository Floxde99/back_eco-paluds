(async () => {
  try {
    const { PrismaClient } = require('../generated/prisma/client');
    const prisma = new PrismaClient();
    await prisma.$connect();
    const count = await prisma.user.count();
    console.log('DB OK count', count);
    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    console.error('DB ERR', e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  }
})();
