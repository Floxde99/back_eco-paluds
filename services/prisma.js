const { PrismaClient } = require("../generated/prisma/client");

let prisma;

if (process.env.NODE_ENV === 'production') {
  // En production, créer une seule instance
  prisma = new PrismaClient();
} else {
  // En développement, utiliser global pour éviter les reconnexions lors du hot reload
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      log: process.env.LOG_LEVEL === 'debug' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error']
    });
  }
  prisma = global.prisma;
}

module.exports = prisma;
